import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { Db, Queryable } from '../db/db';
import { loadTripPassengers } from './trip-passengers';

/** Tối đa phụ xe trên một chuyến. */
export const MAX_ASSISTANTS_PER_TRIP = 5;

const assignSchema = z
  .object({ userIds: z.array(z.string().uuid()).max(MAX_ASSISTANTS_PER_TRIP) })
  .strict()
  .refine((v) => new Set(v.userIds.map((x) => x.toLowerCase())).size === v.userIds.length, {
    message: 'Danh sách phụ xe bị trùng.',
    path: ['userIds'],
  });

/** Chuyến phụ xe được xem: từ 1 ngày trước tới các chuyến sắp chạy. */
const ASSIGNED_LOOKBACK_MS = 24 * 3600 * 1000;
const ASSIGNED_LIMIT = 100;

/** Điều kiện tài khoản phụ xe còn dùng được (đang hoạt động, chưa lưu trữ). */
const ACTIVE_ASSISTANT_SQL = `u.role = 'ASSISTANT' AND u.status = 'ACTIVE' AND u.archived_at IS NULL`;

export interface AssistantRef {
  id: string;
  fullName: string;
  phone: string;
}

/**
 * Phân công phụ xe theo chuyến. OWNER/Điều hành (`trip.write`) gán; phụ xe (`trip.assigned.read`) chỉ đọc chuyến của
 * mình. Mọi truy vấn của phụ xe đều lọc theo `user_id` của phiên ở máy chủ, không tin tham số từ giao diện.
 */
@Injectable()
export class TripAssistantsService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** Phụ xe đang hoạt động của nhà xe — để chọn khi phân công. */
  async candidates(operatorId: string): Promise<AssistantRef[]> {
    if (!isUuid(operatorId)) return [];
    const { rows } = await this.db.query<{ id: string; full_name: string; phone: string }>(
      `SELECT u.id, u.full_name, u.phone FROM users u
       WHERE u.operator_id = $1 AND ${ACTIVE_ASSISTANT_SQL}
       ORDER BY u.full_name, u.id`,
      [operatorId],
    );
    return rows.map(toRef);
  }

  /** Phụ xe đã giao cho chuyến (kể cả tài khoản đã khóa, để người phân công thấy và gỡ). */
  async listForTrip(operatorId: string, tripId: string) {
    await this.assertTrip(this.db, operatorId, tripId);
    const { rows } = await this.db.query<{ id: string; full_name: string; phone: string; active: boolean; assigned_at: Date }>(
      `SELECT u.id, u.full_name, u.phone, (${ACTIVE_ASSISTANT_SQL}) AS active, ta.assigned_at
       FROM trip_assistants ta JOIN users u ON u.id = ta.user_id
       WHERE ta.trip_id = $1 AND ta.operator_id = $2
       ORDER BY ta.assigned_at, u.id`,
      [tripId, operatorId],
    );
    return rows.map((r) => ({ ...toRef(r), active: r.active, assignedAt: r.assigned_at.toISOString() }));
  }

  /**
   * Đặt lại toàn bộ danh sách phụ xe của chuyến (thay thế). Khóa dòng chuyến để hai yêu cầu đồng thời chạy lần lượt;
   * chỉ nhận phụ xe đang hoạt động cùng nhà xe. Trả về danh sách mới và phần thêm/bớt để ghi nhật ký.
   */
  async setForTrip(operatorId: string, tripId: string, input: unknown, actorId: string | null) {
    const { userIds } = assignSchema.parse(input);
    const wanted = userIds.map((x) => x.toLowerCase());
    const diff = await this.db.tx(async (c) => {
      const trip = await this.assertTrip(c, operatorId, tripId, true);
      if (trip.status === 'CANCELLED') throw new DomainError('VALIDATION_FAILED', 'Chuyến đã hủy, không phân công phụ xe.');
      if (wanted.length) {
        const { rows } = await c.query<{ id: string }>(
          `SELECT u.id FROM users u WHERE u.id = ANY($1::uuid[]) AND u.operator_id = $2 AND ${ACTIVE_ASSISTANT_SQL}
           FOR SHARE`,
          [wanted, operatorId],
        );
        if (rows.length !== wanted.length)
          throw new DomainError('VALIDATION_FAILED', 'Chỉ phân công được phụ xe đang hoạt động của nhà xe.');
      }
      const { rows: before } = await c.query<{ user_id: string }>(
        'SELECT user_id FROM trip_assistants WHERE trip_id = $1',
        [tripId],
      );
      const current = new Set(before.map((r) => r.user_id));
      const removed = [...current].filter((id) => !wanted.includes(id));
      const added = wanted.filter((id) => !current.has(id));
      if (removed.length)
        await c.query('DELETE FROM trip_assistants WHERE trip_id = $1 AND user_id = ANY($2::uuid[])', [tripId, removed]);
      for (const id of added)
        await c.query(
          `INSERT INTO trip_assistants (operator_id, trip_id, user_id, assigned_by, assigned_at)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [operatorId, tripId, id, actorId, this.clock.now()],
        );
      return { added, removed };
    });
    return { assistants: await this.listForTrip(operatorId, tripId), ...diff };
  }

  /** Chuyến được giao cho phụ xe đang đăng nhập (lọc theo `userId` của phiên). */
  async assignedTrips(operatorId: string, userId: string) {
    if (!isUuid(operatorId) || !isUuid(userId)) return [];
    const since = new Date(this.clock.now().getTime() - ASSIGNED_LOOKBACK_MS);
    const { rows } = await this.db.query<{
      id: string; name: string; status: string; depart_at: Date; contact_phone: string | null;
      route_code: string; origin: string; destination: string; vehicle_code: string; vehicle_name: string;
      plate_number: string | null; passengers: number; seats: number;
    }>(
      `SELECT t.id, t.name, t.status, t.depart_at, t.contact_phone, r.code AS route_code, r.origin, r.destination,
              v.code AS vehicle_code, v.name AS vehicle_name, v.plate_number,
              (SELECT COUNT(DISTINCT b.id)::int FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
                WHERE bi.trip_id = t.id AND b.status IN ('CONFIRMED', 'COMPLETED')) AS passengers,
              (SELECT COUNT(*)::int FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
                WHERE bi.trip_id = t.id AND b.status IN ('CONFIRMED', 'COMPLETED')) AS seats
       FROM trip_assistants ta
       JOIN users u ON u.id = ta.user_id
       JOIN trips t ON t.id = ta.trip_id AND t.operator_id = ta.operator_id
       JOIN routes r ON r.id = t.route_id JOIN vehicles v ON v.id = t.vehicle_id
       WHERE ta.user_id = $1 AND ta.operator_id = $2 AND ${ACTIVE_ASSISTANT_SQL}
         AND t.status <> 'CANCELLED' AND t.depart_at >= $3
       ORDER BY t.depart_at, t.id LIMIT ${ASSIGNED_LIMIT}`,
      [userId, operatorId, since],
    );
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      departAt: t.depart_at.toISOString(),
      contactPhone: t.contact_phone,
      route: { code: t.route_code, origin: t.origin, destination: t.destination },
      vehicle: { code: t.vehicle_code, name: t.vehicle_name, plateNumber: t.plate_number },
      bookingCount: t.passengers,
      seatCount: t.seats,
    }));
  }

  /**
   * Danh sách khách của một chuyến được giao. Chuyến không được giao cho người này trả 404 như chuyến không tồn tại,
   * để không dò được chuyến của người khác. Chỉ đơn đã xác nhận/hoàn tất (không lộ đơn đang giữ chỗ).
   */
  async passengers(operatorId: string, userId: string, tripId: string) {
    if (!isUuid(operatorId) || !isUuid(userId) || !isUuid(tripId)) throw notFound('chuyến');
    const { rows: own } = await this.db.query<{ ok: number }>(
      `SELECT 1 AS ok FROM trip_assistants ta JOIN users u ON u.id = ta.user_id
       WHERE ta.trip_id = $1 AND ta.user_id = $2 AND ta.operator_id = $3 AND ${ACTIVE_ASSISTANT_SQL}`,
      [tripId, userId, operatorId],
    );
    if (!own[0]) throw notFound('chuyến');
    const r = await loadTripPassengers(this.db, operatorId, tripId, 'confirmed', this.clock.now());
    // Giữ nguyên hợp đồng cũ của phụ xe: không thêm kênh bán, giờ tạo đơn, hạn giữ chỗ hay số đơn đang giữ.
    return {
      trip: r.trip,
      bookings: r.bookings.map(({ channel: _c, contactErased: _e, holdUntil: _h, createdAt: _t, ...b }) => b),
      summary: r.summary,
      fetchedAt: r.fetchedAt,
    };
  }

  /**
   * Danh sách khách của một chuyến cho nhân viên nhà xe (`booking.read`): mặc định gồm cả đơn đang giữ chỗ còn hạn;
   * `all` thêm đơn hết hạn/đã hủy. Chuyến của nhà xe khác trả 404.
   */
  async tripPassengers(operatorId: string, tripId: string, scope: 'active' | 'all') {
    if (!isUuid(operatorId) || !isUuid(tripId)) throw notFound('chuyến');
    return loadTripPassengers(this.db, operatorId, tripId, scope, this.clock.now());
  }

  private async assertTrip(q: Queryable, operatorId: string, tripId: string, lock = false) {
    if (!isUuid(operatorId) || !isUuid(tripId)) throw notFound('chuyến');
    const { rows } = await q.query<{ id: string; status: string }>(
      `SELECT id, status FROM trips WHERE id = $1 AND operator_id = $2${lock ? ' FOR UPDATE' : ''}`,
      [tripId, operatorId],
    );
    if (!rows[0]) throw notFound('chuyến');
    return rows[0];
  }
}

function toRef(r: { id: string; full_name: string; phone: string }): AssistantRef {
  return { id: r.id, fullName: r.full_name, phone: r.phone };
}
