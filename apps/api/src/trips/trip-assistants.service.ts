import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { Db, Queryable } from '../db/db';

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
    const trip = await this.tripSummary(operatorId, tripId);
    const { rows } = await this.db.query<{
      id: string; code: string; status: string; contact_name: string; contact_phone: string; passenger_note: string | null;
      total_amount: number; paid_amount: number; payment_status: string;
      seat_code: string; floor: string; occupancy: number; infant_count: number;
    }>(
      `SELECT b.id, b.code, b.status, b.contact_name, b.contact_phone, b.passenger_note, b.total_amount, b.paid_amount,
              b.payment_status, bi.seat_code, ts.floor, bi.occupancy, bi.infant_count
       FROM booking_items bi
       JOIN bookings b ON b.id = bi.booking_id
       JOIN trip_seats ts ON ts.trip_id = bi.trip_id AND ts.seat_code = bi.seat_code
       WHERE bi.trip_id = $1 AND b.operator_id = $2 AND b.status IN ('CONFIRMED', 'COMPLETED')
       ORDER BY ts.floor, length(bi.seat_code), bi.seat_code, b.code`,
      [tripId, operatorId],
    );
    const byBooking = new Map<string, {
      code: string; status: string; contactName: string; contactPhone: string; note: string | null;
      totalAmount: number; paidAmount: number; dueAmount: number; paymentStatus: string;
      seats: { code: string; floor: string; occupancy: number; infantCount: number }[];
    }>();
    for (const r of rows) {
      let b = byBooking.get(r.id);
      if (!b) {
        b = {
          code: r.code, status: r.status, contactName: r.contact_name, contactPhone: r.contact_phone, note: r.passenger_note,
          totalAmount: r.total_amount, paidAmount: r.paid_amount, dueAmount: Math.max(r.total_amount - r.paid_amount, 0),
          paymentStatus: r.payment_status, seats: [],
        };
        byBooking.set(r.id, b);
      }
      b.seats.push({ code: r.seat_code, floor: r.floor, occupancy: r.occupancy, infantCount: r.infant_count });
    }
    const bookings = [...byBooking.values()];
    return {
      trip,
      bookings,
      summary: {
        bookings: bookings.length,
        seats: rows.length,
        people: rows.reduce((n, r) => n + r.occupancy, 0),
        infants: rows.reduce((n, r) => n + r.infant_count, 0),
        dueAmount: bookings.reduce((n, b) => n + b.dueAmount, 0),
      },
      fetchedAt: this.clock.now().toISOString(),
    };
  }

  /** Tóm tắt chuyến (tuyến, xe) cho trang danh sách khách. */
  private async tripSummary(operatorId: string, tripId: string) {
    const { rows } = await this.db.query<{
      id: string; name: string; status: string; depart_at: Date; contact_phone: string | null;
      route_code: string; origin: string; destination: string; vehicle_code: string; vehicle_name: string; plate_number: string | null;
    }>(
      `SELECT t.id, t.name, t.status, t.depart_at, t.contact_phone, r.code AS route_code, r.origin, r.destination,
              v.code AS vehicle_code, v.name AS vehicle_name, v.plate_number
       FROM trips t JOIN routes r ON r.id = t.route_id JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.id = $1 AND t.operator_id = $2`,
      [tripId, operatorId],
    );
    const t = rows[0];
    if (!t) throw notFound('chuyến');
    return {
      id: t.id, name: t.name, status: t.status, departAt: t.depart_at.toISOString(), contactPhone: t.contact_phone,
      route: { code: t.route_code, origin: t.origin, destination: t.destination },
      vehicle: { code: t.vehicle_code, name: t.vehicle_name, plateNumber: t.plate_number },
    };
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
