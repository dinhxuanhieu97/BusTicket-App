import { Injectable } from '@nestjs/common';
import { AbuseConfig } from '../abuse/abuse-config';
import { PhoneVerificationService } from '../abuse/phone-verification.service';
import { clientKey } from '../abuse/client-ip';
import { RateLimiter } from '../abuse/rate-limiter';
import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { bookingAccessToken, bookingCode, verifyBookingAccessToken } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { normalizeVnPhone } from '../common/phone';
import { Db, isPgError, PG_UNIQUE_VIOLATION, Queryable } from '../db/db';
import { OperatorsService } from '../operators/operators.service';
import { SEAT_CODE } from '../seat-layouts/layout-parser';
import { amountDueNow, depositAmount, fixedUnitDeposit, priceItems } from './pricing';
import { TokenSecret } from './token-secret';

export { TokenSecret };

const holdItems = z
      .array(
        z
          .object({
            seatCode: z.string().regex(SEAT_CODE),
            occupancy: z.number().int().min(1).max(2).default(1),
            infantCount: z.number().int().min(0).max(2).default(0),
          })
          .strict(),
      )
      .min(1)
      .max(20);
type Leg = { tripId: string; items: z.output<typeof holdItems> };

export const createHoldSchema = z
  .object({
    tripId: z.string().uuid(),
    contactName: z.string().trim().min(1).max(120),
    contactPhone: z.string().min(1).max(30),
    note: z.string().trim().max(500).optional(),
    items: holdItems,
    returnLeg: z.object({ tripId: z.string().uuid(), items: holdItems }).strict().optional(),
  })
  .strict();
export type CreateHoldInput = z.input<typeof createHoldSchema>;

export interface BookingView {
  code: string;
  status: string;
  tripId: string;
  tripContacts: { tripId: string; phone: string }[];
  /** Hạn thanh toán khách thấy. */
  holdExpiresAt: string | null;
  /** Lúc nhả chỗ thật (hạn thanh toán + ân hạn chờ tiền ngân hàng báo chậm). */
  releaseAt: string | null;
  note?: string;
  totalAmount: number;
  /** Số tiền phải trả để xác nhận vé (cọc hoặc toàn bộ). */
  depositAmount: number;
  paidAmount: number;
  paymentStatus: string;
  /** Còn phải trả để xác nhận vé (khi đang giữ chỗ) hoặc để trả đủ (khi đã xác nhận). */
  amountDueNow: number;
  items: { tripId?: string; seatCode: string; occupancy: number; infantCount: number; unitPrice: number; infantPrice: number; lineTotal: number }[];
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
  release_at: Date | null;
  total_amount: number;
  deposit_amount: number;
  paid_amount: number;
  payment_status: string;
  request_hash: string | null;
  passenger_note: string | null;
  access_token_version: number;
}

const BOOKING_COLUMNS =
  'id, code, status, trip_id, hold_expires_at, release_at, total_amount, deposit_amount, paid_amount, payment_status, request_hash, access_token_version, passenger_note';

const MAX_CODE_ATTEMPTS = 5;

/** Ngữ cảnh yêu cầu dùng để chống lạm dụng. */
export interface HoldContext {
  /** IP người gửi (đã xử lý proxy tin cậy ở tầng HTTP). */
  ip?: string;
  /** Token "đã xác thực SĐT" (header `X-Phone-Token`), bắt buộc khi nhà xe bật `requirePhoneOtp`. */
  phoneToken?: string;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly db: Db,
    private readonly operators: OperatorsService,
    private readonly clock: Clock,
    private readonly tokenSecret: TokenSecret,
    private readonly limiter: RateLimiter,
    private readonly abuse: AbuseConfig,
    private readonly phones: PhoneVerificationService,
  ) {}

  /**
   * Tạo đơn giữ chỗ cho các chỗ/phòng của cả hành trình — thành công toàn bộ hoặc không giữ gì
   * (AC-01, AC-02). Khóa các chuyến theo thứ tự ID trước khi kiểm tra tồn chỗ.
   */
  async createHold(input: CreateHoldInput, idempotencyKey: string, ctx: HoldContext = {}): Promise<HoldResult> {
    const data = createHoldSchema.parse(input);
    const key = idempotencyKey.trim();
    if (!/^[\w-]{8,100}$/.test(key)) {
      throw new DomainError('VALIDATION_FAILED', 'Idempotency-Key phải dài 8–100 ký tự (chữ, số, "-", "_").');
    }
    const phone = normalizeVnPhone(data.contactPhone);
    const legs = [{ tripId: data.tripId, items: data.items }, ...(data.returnLeg ? [data.returnLeg] : [])];
    for (const leg of legs) {
      leg.items.sort((a,b) => a.seatCode.localeCompare(b.seatCode));
      if (new Set(leg.items.map(i => i.seatCode)).size !== leg.items.length)
        throw new DomainError('VALIDATION_FAILED', 'Một chỗ chỉ được chọn một lần trên cùng chuyến.');
    }
    const items = data.items;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ tripId: data.tripId, name: data.contactName, phone, items, ...(data.returnLeg ? { returnLeg: data.returnLeg } : {}), ...(data.note ? { note: data.note } : {}) }))
      .digest('hex');

    const { rows: tripOps } = await this.db.query<{ operator_id: string }>('SELECT operator_id FROM trips WHERE id = $1', [data.tripId]);
    const operatorId = tripOps[0]?.operator_id;
    // Gửi lại đúng yêu cầu cũ (mạng chập chờn) → trả đơn đã giữ, không tính vào giới hạn tần suất.
    if (operatorId) {
      const existing = await this.findByKey(this.db, operatorId, key);
      if (existing) return this.replay(existing, requestHash);
    }
    // Giới hạn tần suất (ngoài transaction, để bộ đếm không bị ROLLBACK khi yêu cầu thất bại).
    const busy = 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
    const source = clientKey(ctx.ip);
    if (source) await this.limiter.consume(`booking-ip:${source}`, this.abuse.bookingsPerIpPerMinute, 60, busy);
    if (operatorId) {
      await this.limiter.consume(`booking-phone:${operatorId}:${phone}`, this.abuse.bookingsPerPhonePerHour, 3600, busy);
    }

    try {
      return await this.db.tx((c) => this.holdInTx(c, legs, data.contactName, phone, key, requestHash, ctx, data.note));
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
    legs: Leg[],
    contactName: string,
    phone: string,
    key: string,
    requestHash: string,
    ctx: HoldContext,
    note?: string,
  ): Promise<HoldResult> {
    const tripId = legs[0]!.tripId;
    const now = this.clock.now();
    const { rows: trips } = await c.query<{
      id: string; origin: string; destination: string; operator_id: string; status: string; sales_open_at: Date; sales_close_at: Date; depart_at: Date;
    }>(
      `SELECT t.*, r.origin, r.destination FROM trips t JOIN routes r ON r.id=t.route_id
       WHERE t.id = ANY($1::uuid[]) ORDER BY t.id FOR NO KEY UPDATE OF t`, [legs.map(l => l.tripId)],
    );
    const trip = trips.find(t => t.id === tripId);
    if (!trip || trips.length !== legs.length) throw notFound('chuyến');
    const inbound = trips.find(t => t.id !== tripId);
    if (inbound && (inbound.operator_id !== trip.operator_id || inbound.origin !== trip.destination ||
        inbound.destination !== trip.origin || inbound.depart_at <= trip.depart_at))
      throw new DomainError('VALIDATION_FAILED', 'Chuyến về phải đúng tuyến ngược chiều và khởi hành sau chuyến đi.');

    const existing = await this.findByKey(c, trip.operator_id, key);
    if (existing) return this.replay(existing, requestHash);

    if (trips.some(t => t.status !== 'OPEN' || now < t.sales_open_at || now >= t.sales_close_at || now >= t.depart_at)) {
      throw new DomainError('TRIP_NOT_ON_SALE', 'Chuyến hiện không mở bán.');
    }
    const policy = await this.operators.currentPolicy(trip.operator_id, c);
    if (legs.some(l => l.items.length > policy.maxUnitsPerBooking)) {
      throw new DomainError('LIMIT_EXCEEDED', `Mỗi đơn chọn tối đa ${policy.maxUnitsPerBooking} chỗ.`, {
        max: policy.maxUnitsPerBooking,
      });
    }

    if (policy.requirePhoneOtp && !this.phones.verifyToken(ctx.phoneToken, trip.operator_id, phone)) {
      throw new DomainError('PHONE_VERIFICATION_REQUIRED', 'Vui lòng xác thực số điện thoại bằng mã OTP trước khi giữ chỗ.');
    }

    for (const t of trips) await this.expireDueHoldsForTrip(c, t.id, now);

    // Số đơn đang giữ của SĐT này trong nhà xe. Khóa theo (nhà xe, SĐT) để các yêu cầu song song
    // (kể cả ở chuyến khác) không cùng lọt qua bước đếm. Luôn khóa chuyến trước rồi mới khóa SĐT.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hold-phone:${trip.operator_id}:${phone}`]);
    const { rows: active } = await c.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM bookings
       WHERE operator_id = $1 AND contact_phone = $2 AND status = 'HOLDING' AND release_at > $3`,
      [trip.operator_id, phone, now],
    );
    if (active[0]!.n >= policy.maxActiveHoldsPerPhone) {
      throw new DomainError(
        'LIMIT_EXCEEDED',
        `Số điện thoại này đang giữ ${active[0]!.n} đơn chưa thanh toán. Vui lòng thanh toán hoặc chờ đơn cũ hết hạn.`,
        { maxActiveHoldsPerPhone: policy.maxActiveHoldsPerPhone },
      );
    }

    const pricedLegs = [];
    for (const { tripId, items } of legs) {
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
        throw new DomainError('SEAT_UNAVAILABLE', `Chỗ ${taken.join(', ')} vừa có người khác giữ hoặc không bán.`, { seats: taken, tripId });
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

      pricedLegs.push({ tripId, codes, priced });
    }
    const total = pricedLegs.reduce((sum, leg) => sum + leg.priced.total, 0);
    const fixedDeposit = policy.fixedDeposit;
    const deposit = fixedDeposit
      ? pricedLegs.flatMap(({ priced }) => priced.items)
        .reduce((sum, item) => sum + fixedUnitDeposit(item.lineTotal, item.occupancy, fixedDeposit), 0)
      : depositAmount(total, policy.depositPercent);
    const { rows: ops } = await c.query<{ code: string }>('SELECT code FROM operators WHERE id = $1', [trip.operator_id]);
    const holdExpiresAt = new Date(now.getTime() + policy.holdMinutes * 60_000);
    const releaseAt = new Date(holdExpiresAt.getTime() + policy.paymentGraceMinutes * 60_000);
    let booking: BookingRow | undefined;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !booking; attempt++) {
      const { rows } = await c.query<BookingRow>(
        `INSERT INTO bookings (operator_id, trip_id, code, status, hold_expires_at, contact_name, contact_phone,
                               total_amount, deposit_amount, policy_snapshot, idempotency_key, request_hash, created_at, updated_at, passenger_note,
                               release_at)
         VALUES ($1, $2, $3, 'HOLDING', $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13, $14)
         ON CONFLICT (code) DO NOTHING
         RETURNING ${BOOKING_COLUMNS}`,
        [trip.operator_id, tripId, bookingCode(ops[0]!.code), holdExpiresAt, contactName, phone, total,
          deposit, JSON.stringify(policy), key, requestHash, now, note || null, releaseAt],
      );
      booking = rows[0];
    }
    if (!booking) throw new Error('Could not generate a unique booking code');

    for (const { tripId, codes, priced } of pricedLegs) {
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

    }
    return { booking: await this.view(c, booking), accessToken: this.token(booking), replayed: false };
  }

  /** Giải phóng các đơn HOLDING đã quá hạn của một chuyến (gọi trong transaction đang khóa chuyến). */
  private async expireDueHoldsForTrip(c: Queryable, tripId: string, now: Date): Promise<void> {
    const { rows } = await c.query<{ id: string }>(
      `UPDATE bookings SET status = 'EXPIRED', updated_at = $2
       WHERE id IN (SELECT booking_id FROM booking_items WHERE trip_id = $1) AND status = 'HOLDING' AND release_at <= $2 RETURNING id`,
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
      `SELECT DISTINCT i.trip_id FROM bookings b JOIN booking_items i ON i.booking_id = b.id
       WHERE b.status = 'HOLDING' AND b.release_at <= $1 ORDER BY i.trip_id`,
      [now],
    );
    let count = 0;
    for (const { trip_id } of rows) {
      count += await this.db.tx(async (c) => {
        await c.query('SELECT id FROM trips WHERE id = $1 FOR NO KEY UPDATE', [trip_id]);
        const { rows: due } = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM bookings
           WHERE id IN (SELECT booking_id FROM booking_items WHERE trip_id = $1) AND status = 'HOLDING' AND release_at <= $2`,
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
      `SELECT ${BOOKING_COLUMNS}
       FROM bookings WHERE code = $1`,
      [code],
    );
    const b = rows[0];
    if (!b || !verifyBookingAccessToken(this.tokenSecret.value, b.id, b.access_token_version, accessToken)) {
      throw notFound('đơn');
    }
    return this.view(this.db, b);
  }

  /** Khôi phục liên hệ từ một đơn mà thiết bị đang giữ token. */
  async contactByCode(code: string, accessToken: string): Promise<{ name: string; phone: string }> {
    const { rows } = await this.db.query<{
      id: string; access_token_version: number; contact_name: string; contact_phone: string;
    }>(
      'SELECT id, access_token_version, contact_name, contact_phone FROM bookings WHERE code = $1',
      [code],
    );
    const booking = rows[0];
    if (!booking || !verifyBookingAccessToken(this.tokenSecret.value, booking.id, booking.access_token_version, accessToken)) {
      throw notFound('đơn');
    }
    return { name: booking.contact_name, phone: booking.contact_phone };
  }

  /**
   * Khách tự bỏ giữ chỗ (đổi ý, chọn lại chỗ khác): nhả chỗ ngay thay vì chờ hết hạn.
   * Chỉ áp dụng cho đơn đang giữ và chưa trả đồng nào; gọi lại khi đơn đã hủy/hết hạn trả về trạng thái hiện tại.
   */
  async releaseByCode(code: string, accessToken: string): Promise<BookingView> {
    const { rows } = await this.db.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE code = $1`, [code]);
    const found = rows[0];
    if (!found || !verifyBookingAccessToken(this.tokenSecret.value, found.id, found.access_token_version, accessToken)) {
      throw notFound('đơn');
    }
    return this.db.tx(async (c) => {
      // Cùng thứ tự khóa với giữ chỗ: mọi chuyến của đơn theo ID, rồi mới tới đơn.
      await c.query(
        `SELECT id FROM trips WHERE id IN (SELECT trip_id FROM booking_items WHERE booking_id = $1) ORDER BY id FOR NO KEY UPDATE`,
        [found.id],
      );
      const { rows: locked } = await c.query<BookingRow>(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = $1 FOR UPDATE`, [found.id]);
      const b = locked[0]!;
      // Token có thể vừa bị thu hồi giữa lần đọc đầu và lúc khóa.
      if (!verifyBookingAccessToken(this.tokenSecret.value, b.id, b.access_token_version, accessToken)) throw notFound('đơn');
      const now = this.clock.now();
      if (b.status === 'CANCELLED' || b.status === 'EXPIRED') return this.view(c, b);
      if (b.status !== 'HOLDING' || b.paid_amount > 0) {
        throw new DomainError('CONFLICT', 'Đơn đã nhận tiền nên không tự hủy được. Vui lòng liên hệ nhà xe.', { status: b.status });
      }
      // Luôn CANCELLED (kể cả đã quá hạn): khách chủ động bỏ đơn, tiền về muộn sau đó không được tự xác nhận lại.
      const { rows: updated } = await c.query<BookingRow>(
        `UPDATE bookings SET status = 'CANCELLED', updated_at = $2 WHERE id = $1 RETURNING ${BOOKING_COLUMNS}`,
        [b.id, now],
      );
      await c.query('UPDATE trip_seats SET booking_id = NULL WHERE booking_id = $1', [b.id]);
      return this.view(c, updated[0]!);
    });
  }

  private async findByKey(q: Queryable, operatorId: string, key: string): Promise<BookingRow | undefined> {
    const { rows } = await q.query<BookingRow>(
      `SELECT ${BOOKING_COLUMNS}
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
      trip_id: string; seat_code: string; occupancy: number; infant_count: number; unit_price: number; infant_price: number; line_total: number;
      trip_phone: string | null;
    }>(
      `SELECT i.trip_id, i.seat_code, i.occupancy, i.infant_count, i.unit_price, i.infant_price, i.line_total,
              t.contact_phone AS trip_phone
       FROM booking_items i JOIN trips t ON t.id = i.trip_id
       WHERE i.booking_id = $1 ORDER BY i.seat_code`,
      [b.id],
    );
    const roundTrip = rows.some(r => r.trip_id !== b.trip_id);
    const tripContacts = new Map<string, string>();
    for (const row of rows) {
      if (row.trip_phone) tripContacts.set(row.trip_id, row.trip_phone);
    }
    // Đơn giữ chỗ quá hạn hiển thị là EXPIRED ngay cả khi tác vụ nền chưa chạy.
    const expired = b.status === 'HOLDING' && b.release_at !== null && b.release_at <= this.clock.now();
    return {
      code: b.code,
      ...(b.passenger_note ? { note: b.passenger_note } : {}),
      status: expired ? 'EXPIRED' : b.status,
      tripId: b.trip_id,
      tripContacts: [...tripContacts].map(([tripId, phone]) => ({ tripId, phone })),
      holdExpiresAt: b.hold_expires_at ? b.hold_expires_at.toISOString() : null,
      releaseAt: b.status === 'HOLDING' && b.release_at && !expired ? b.release_at.toISOString() : null,
      totalAmount: b.total_amount,
      depositAmount: b.deposit_amount,
      paidAmount: b.paid_amount,
      paymentStatus: b.payment_status,
      amountDueNow: amountDueNow(b, this.clock.now()),
      items: rows.map((r) => ({
        ...(roundTrip ? {tripId: r.trip_id} : {}), seatCode: r.seat_code,
        occupancy: r.occupancy,
        infantCount: r.infant_count,
        unitPrice: r.unit_price,
        infantPrice: r.infant_price,
        lineTotal: r.line_total,
      })),
    };
  }
}
