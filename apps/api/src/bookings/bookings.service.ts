import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { bookingAccessToken, bookingCode, verifyBookingAccessToken } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { normalizeVnPhone } from '../common/phone';
import { Db, isPgError, PG_UNIQUE_VIOLATION, Queryable } from '../db/db';
import { OperatorsService } from '../operators/operators.service';
import { priceItems } from './pricing';
import { TokenSecret } from './token-secret';

export { TokenSecret };

export const createHoldSchema = z
  .object({
    tripId: z.string().uuid(),
    contactName: z.string().trim().min(1).max(120),
    contactPhone: z.string().min(1).max(30),
    items: z
      .array(
        z
          .object({
            seatCode: z.string().regex(/^[A-Z]\d{2}$/),
            occupancy: z.number().int().min(1).max(2).default(1),
            infantCount: z.number().int().min(0).max(2).default(0),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type CreateHoldInput = z.input<typeof createHoldSchema>;

export interface BookingView {
  code: string;
  status: string;
  tripId: string;
  holdExpiresAt: string | null;
  totalAmount: number;
  items: { seatCode: string; occupancy: number; infantCount: number; unitPrice: number; infantPrice: number; lineTotal: number }[];
}

export interface HoldResult {
  booking: BookingView;
  accessToken: string;
  /** true khi trả lại đơn đã tạo trước đó với cùng Idempotency-Key. */
  replayed: boolean;
}

interface BookingRow {
  id: string;
  code: string;
  status: string;
  trip_id: string;
  hold_expires_at: Date | null;
  total_amount: number;
  request_hash: string | null;
  access_token_version: number;
}

const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class BookingsService {
  constructor(
    private readonly db: Db,
    private readonly operators: OperatorsService,
    private readonly clock: Clock,
    private readonly tokenSecret: TokenSecret,
  ) {}

  /**
   * Tạo đơn giữ chỗ cho nhiều chỗ/phòng trên một chuyến — thành công toàn bộ hoặc không giữ gì
   * (AC-01, AC-02). Khóa hàng của chuyến để các yêu cầu cùng chuyến xếp hàng tuần tự.
   */
  async createHold(input: CreateHoldInput, idempotencyKey: string): Promise<HoldResult> {
    const data = createHoldSchema.parse(input);
    const key = idempotencyKey.trim();
    if (!/^[\w-]{8,100}$/.test(key)) {
      throw new DomainError('VALIDATION_FAILED', 'Idempotency-Key phải dài 8–100 ký tự (chữ, số, "-", "_").');
    }
    const phone = normalizeVnPhone(data.contactPhone);
    const codes = data.items.map((i) => i.seatCode);
    if (new Set(codes).size !== codes.length) {
      throw new DomainError('VALIDATION_FAILED', 'Một chỗ chỉ được chọn một lần trong đơn.');
    }
    const items = [...data.items].sort((a, b) => a.seatCode.localeCompare(b.seatCode));
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ tripId: data.tripId, name: data.contactName, phone, items }))
      .digest('hex');

    try {
      return await this.db.tx((c) => this.holdInTx(c, data.tripId, data.contactName, phone, items, key, requestHash));
    } catch (e) {
      // Cùng khóa nhưng gửi cho chuyến khác, chạy song song: ràng buộc duy nhất chặn, trả kết quả nhất quán.
      if (isPgError(e, PG_UNIQUE_VIOLATION) && e.constraint === 'bookings_operator_id_idempotency_key_key') {
        const existing = await this.findByIdempotency(data.tripId, key);
        if (existing) return this.replay(existing, requestHash);
      }
      throw e;
    }
  }

  private async holdInTx(
    c: PoolClient,
    tripId: string,
    contactName: string,
    phone: string,
    items: { seatCode: string; occupancy: number; infantCount: number }[],
    key: string,
    requestHash: string,
  ): Promise<HoldResult> {
    const now = this.clock.now();
    const { rows: trips } = await c.query<{
      id: string; operator_id: string; status: string; sales_open_at: Date; sales_close_at: Date; depart_at: Date;
    }>(
      'SELECT id, operator_id, status, sales_open_at, sales_close_at, depart_at FROM trips WHERE id = $1 FOR NO KEY UPDATE',
      [tripId],
    );
    const trip = trips[0];
    if (!trip) throw notFound('chuyến');

    const existing = await this.findByKey(c, trip.operator_id, key);
    if (existing) return this.replay(existing, requestHash);

    if (trip.status !== 'OPEN' || now < trip.sales_open_at || now >= trip.sales_close_at || now >= trip.depart_at) {
      throw new DomainError('TRIP_NOT_ON_SALE', 'Chuyến hiện không mở bán.');
    }
    const policy = await this.operators.currentPolicy(trip.operator_id, c);
    if (items.length > policy.maxUnitsPerBooking) {
      throw new DomainError('LIMIT_EXCEEDED', `Mỗi đơn chọn tối đa ${policy.maxUnitsPerBooking} chỗ.`, {
        max: policy.maxUnitsPerBooking,
      });
    }

    await this.expireDueHoldsForTrip(c, tripId, now);

    const codes = items.map((i) => i.seatCode);
    const { rows: seats } = await c.query<{ seat_code: string; floor: string; max_occupancy: number; sellable: boolean; booking_id: string | null }>(
      `SELECT seat_code, floor, max_occupancy, sellable, booking_id FROM trip_seats
       WHERE trip_id = $1 AND seat_code = ANY($2::text[]) ORDER BY seat_code`,
      [tripId, codes],
    );
    const unknown = codes.filter((code) => !seats.some((s) => s.seat_code === code));
    if (unknown.length) throw new DomainError('VALIDATION_FAILED', 'Chuyến không có một số chỗ đã chọn.', { seats: unknown });
    const taken = seats.filter((s) => !s.sellable || s.booking_id !== null).map((s) => s.seat_code);
    if (taken.length) {
      throw new DomainError('SEAT_UNAVAILABLE', `Chỗ ${taken.join(', ')} vừa có người khác giữ hoặc không bán.`, { seats: taken });
    }

    const { rows: fares } = await c.query<{ floor: string; occupancy: number; price: number }>(
      'SELECT floor, occupancy, price FROM trip_fares WHERE trip_id = $1',
      [tripId],
    );
    const priced = priceItems(
      items,
      seats.map((s) => ({ seatCode: s.seat_code, floor: s.floor, maxOccupancy: s.max_occupancy })),
      fares,
      policy.childPolicy,
    );

    const { rows: ops } = await c.query<{ code: string }>('SELECT code FROM operators WHERE id = $1', [trip.operator_id]);
    const holdExpiresAt = new Date(now.getTime() + policy.holdMinutes * 60_000);
    let booking: BookingRow | undefined;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !booking; attempt++) {
      const { rows } = await c.query<BookingRow>(
        `INSERT INTO bookings (operator_id, trip_id, code, status, hold_expires_at, contact_name, contact_phone,
                               total_amount, policy_snapshot, idempotency_key, request_hash, created_at, updated_at)
         VALUES ($1, $2, $3, 'HOLDING', $4, $5, $6, $7, $8, $9, $10, $11, $11)
         ON CONFLICT (code) DO NOTHING
         RETURNING id, code, status, trip_id, hold_expires_at, total_amount, request_hash, access_token_version`,
        [trip.operator_id, tripId, bookingCode(ops[0]!.code), holdExpiresAt, contactName, phone, priced.total,
          JSON.stringify(policy), key, requestHash, now],
      );
      booking = rows[0];
    }
    if (!booking) throw new Error('Could not generate a unique booking code');

    for (const it of priced.items) {
      await c.query(
        `INSERT INTO booking_items (booking_id, trip_id, seat_code, occupancy, infant_count, unit_price, infant_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [booking.id, tripId, it.seatCode, it.occupancy, it.infantCount, it.unitPrice, it.infantPrice, it.lineTotal],
      );
    }
    const upd = await c.query(
      `UPDATE trip_seats SET booking_id = $1 WHERE trip_id = $2 AND seat_code = ANY($3::text[]) AND booking_id IS NULL`,
      [booking.id, tripId, codes],
    );
    if (upd.rowCount !== codes.length) throw new Error('Seat inventory changed while the trip row was locked');

    return { booking: await this.view(c, booking), accessToken: this.token(booking), replayed: false };
  }

  /** Giải phóng các đơn HOLDING đã quá hạn của một chuyến (gọi trong transaction đang khóa chuyến). */
  private async expireDueHoldsForTrip(c: Queryable, tripId: string, now: Date): Promise<void> {
    const { rows } = await c.query<{ id: string }>(
      `UPDATE bookings SET status = 'EXPIRED', updated_at = $2
       WHERE trip_id = $1 AND status = 'HOLDING' AND hold_expires_at <= $2 RETURNING id`,
      [tripId, now],
    );
    if (rows.length) {
      await c.query('UPDATE trip_seats SET booking_id = NULL WHERE booking_id = ANY($1::uuid[])', [rows.map((r) => r.id)]);
    }
  }

  /**
   * Tác vụ nền: hết hạn mọi đơn giữ chỗ quá hạn. Khóa từng chuyến theo thứ tự để không
   * tranh chấp sai thứ tự với luồng giữ chỗ. Trả về số đơn đã hết hạn.
   */
  async expireDueHolds(): Promise<number> {
    const now = this.clock.now();
    const { rows } = await this.db.query<{ trip_id: string }>(
      `SELECT DISTINCT trip_id FROM bookings WHERE status = 'HOLDING' AND hold_expires_at <= $1 ORDER BY trip_id`,
      [now],
    );
    let count = 0;
    for (const { trip_id } of rows) {
      count += await this.db.tx(async (c) => {
        await c.query('SELECT id FROM trips WHERE id = $1 FOR NO KEY UPDATE', [trip_id]);
        const { rows: due } = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM bookings WHERE trip_id = $1 AND status = 'HOLDING' AND hold_expires_at <= $2`,
          [trip_id, now],
        );
        await this.expireDueHoldsForTrip(c, trip_id, now);
        return due[0]!.n;
      });
    }
    return count;
  }

  /** Xem đơn bằng mã đơn + token truy cập (không dùng mã tăng dần hay chỉ SĐT). */
  async getByCode(code: string, accessToken: string): Promise<BookingView> {
    const { rows } = await this.db.query<BookingRow>(
      `SELECT id, code, status, trip_id, hold_expires_at, total_amount, request_hash, access_token_version
       FROM bookings WHERE code = $1`,
      [code],
    );
    const b = rows[0];
    if (!b || !verifyBookingAccessToken(this.tokenSecret.value, b.id, b.access_token_version, accessToken)) {
      throw notFound('đơn');
    }
    return this.view(this.db, b);
  }

  private async findByKey(q: Queryable, operatorId: string, key: string): Promise<BookingRow | undefined> {
    const { rows } = await q.query<BookingRow>(
      `SELECT id, code, status, trip_id, hold_expires_at, total_amount, request_hash, access_token_version
       FROM bookings WHERE operator_id = $1 AND idempotency_key = $2`,
      [operatorId, key],
    );
    return rows[0];
  }

  private async findByIdempotency(tripId: string, key: string): Promise<BookingRow | undefined> {
    const { rows } = await this.db.query<{ operator_id: string }>('SELECT operator_id FROM trips WHERE id = $1', [tripId]);
    return rows[0] ? this.findByKey(this.db, rows[0].operator_id, key) : undefined;
  }

  private async replay(existing: BookingRow, requestHash: string): Promise<HoldResult> {
    if (existing.request_hash !== requestHash) {
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng cho một yêu cầu khác.');
    }
    return { booking: await this.view(this.db, existing), accessToken: this.token(existing), replayed: true };
  }

  private token(b: BookingRow): string {
    return bookingAccessToken(this.tokenSecret.value, b.id, b.access_token_version);
  }

  private async view(q: Queryable, b: BookingRow): Promise<BookingView> {
    const { rows } = await q.query<{
      seat_code: string; occupancy: number; infant_count: number; unit_price: number; infant_price: number; line_total: number;
    }>(
      `SELECT seat_code, occupancy, infant_count, unit_price, infant_price, line_total
       FROM booking_items WHERE booking_id = $1 ORDER BY seat_code`,
      [b.id],
    );
    // Đơn giữ chỗ quá hạn hiển thị là EXPIRED ngay cả khi tác vụ nền chưa chạy.
    const expired = b.status === 'HOLDING' && b.hold_expires_at !== null && b.hold_expires_at <= this.clock.now();
    return {
      code: b.code,
      status: expired ? 'EXPIRED' : b.status,
      tripId: b.trip_id,
      holdExpiresAt: b.hold_expires_at ? b.hold_expires_at.toISOString() : null,
      totalAmount: b.total_amount,
      items: rows.map((r) => ({
        seatCode: r.seat_code,
        occupancy: r.occupancy,
        infantCount: r.infant_count,
        unitPrice: r.unit_price,
        infantPrice: r.infant_price,
        lineTotal: r.line_total,
      })),
    };
  }
}
