import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.service';
import { Clock } from '../common/clock';
import { verifyTicketProof } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { Db, isPgError, PG_UNIQUE_VIOLATION, Queryable } from '../db/db';
import { SEAT_CODE } from '../seat-layouts/layout-parser';
import { TokenSecret } from './token-secret';
import { MAX_IMPORT_ROWS, wholeNumber, type PlanIssue } from './staff-bookings.service';
import { normalizeVnPhone } from '../common/phone';
import { resolveStopOrCustom, type StopPoint, type TripStops } from './stops';

const BOOKING_CODE = /^[A-Z0-9]{4,12}$/;
const PROOF = /^[A-Za-z0-9_-]{43}$/;

export const cancelSchema = z
  .object({
    reason: z.string().trim().min(3, 'Vui lòng ghi lý do hủy (ít nhất 3 ký tự).').max(300),
    /** false: không gửi tin báo hủy cho khách (ghi vào sự kiện cho worker thông báo). */
    notifyCustomer: z.boolean().default(true),
  })
  .strict();

export const boardingSchema = z
  .object({
    /** Nội dung mã QR trên vé (đường dẫn đối chiếu `.../tickets/CODE/verify?proof=...`). */
    qr: z.string().trim().max(500).optional(),
    bookingCode: z.string().trim().toUpperCase().regex(BOOKING_CODE).optional(),
    /** Bỏ trống: mọi chỗ của đơn trên chuyến này. */
    seatCodes: z.array(z.string().regex(SEAT_CODE)).min(1).max(20).optional(),
    /** false: bỏ đánh dấu (bấm nhầm). */
    boarded: z.boolean().default(true),
  })
  .strict()
  .refine((v) => Boolean(v.qr) !== Boolean(v.bookingCode), { message: 'Gửi mã QR hoặc mã vé.' });

const cell = z.union([z.string().max(500), z.number().finite(), z.boolean()]).nullable().optional();
export const boardingImportSchema = z
  .object({
    fileName: z.string().trim().max(200).optional(),
    rows: z
      .array(
        z
          .object({
            row: z.number().int().min(1).max(100_000),
            code: z.string().max(40),
            seatCode: cell,
            boarded: cell,
            collected: cell,
          })
          .strict(),
      )
      .min(1, 'File chưa có dòng nào có Mã vé.')
      .max(MAX_IMPORT_ROWS * 2, `Mỗi lần cập nhật tối đa ${MAX_IMPORT_ROWS * 2} dòng.`),
  })
  .strict();

/**
 * Sửa thông tin liên hệ/đón trả/ghi chú của đơn (nhân viên). Chỉ gửi trường cần đổi; chuỗi rỗng hoặc null ở
 * điểm đón/trả/ghi chú = xóa. Tuyến chưa có danh sách điểm đón/trả thì nhận tên gõ tự do (không có giờ đón).
 * Không đổi chỗ, chuyến hay tiền (đổi qua `BookingChangesService`, tiền thu qua sổ thu, lên xe qua `boarding`).
 */
export const bookingEditSchema = z
  .object({
    contactName: z.string().trim().min(1, 'Họ tên không được để trống.').max(120).optional(),
    contactPhone: z.string().min(1).max(30).optional(),
    pickupStop: z.string().trim().max(160).nullable().optional(),
    dropoffStop: z.string().trim().max(160).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Chưa có thông tin nào để sửa.' });

export const refundListQuery = z.object({ status: z.enum(['OPEN', 'ALL']).default('OPEN') }).strict();
export const refundResolveSchema = z
  .object({
    status: z.enum(['REFUNDED', 'WAIVED']),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

const YES = new Set(['x', 'có', 'co', '1', 'true', 'yes', 'y', 'đã', 'da', 'rồi', 'roi', '✓', '✔', 'v']);
const NO = new Set(['', '0', 'false', 'no', 'không', 'khong', 'chưa', 'chua', '-']);

/** Ô "Đã lên xe": true = đánh dấu lên xe; null = không đổi; undefined = không đọc được. */
export function boardedCell(v: string | number | boolean | null | undefined): boolean | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? true : null;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? null : undefined;
  const s = v.normalize('NFC').trim().toLocaleLowerCase('vi');
  if (YES.has(s)) return true;
  if (NO.has(s)) return null;
  return undefined;
}

/** Mã vé và proof từ nội dung QR (đường dẫn đối chiếu); chuỗi chỉ có mã vé → không có proof. */
export function parseTicketQr(raw: string): { code: string; proof: string | null } | null {
  const s = raw.trim();
  const m = /\/tickets\/([A-Z0-9]{4,12})\/verify\?(?:[^#]*&)?proof=([A-Za-z0-9_-]{43})(?:[&#]|$)/.exec(s);
  if (m) return { code: m[1]!, proof: m[2]! };
  return null;
}

interface BoardingBooking {
  id: string;
  code: string;
  status: string;
  operator_id: string;
  total_amount: number;
  deposit_amount: number;
  paid_amount: number;
  access_token_version: number;
}

/** Trạng thái lên xe của một đơn trên chuyến (trả cho dashboard/phụ xe). */
export interface BoardingView {
  code: string;
  status: string;
  contactName: string;
  dueAmount: number;
  seats: { code: string; occupancy: number; boardedAt: string | null }[];
}

/**
 * Vận hành hành khách (D3): nhân viên hủy đơn kèm khoản cần hoàn, đánh dấu lên xe (nút, QR, nhập lại file) và
 * thực thu trên xe. Khóa theo thứ tự như đặt vé: chuyến (`FOR NO KEY UPDATE`, theo ID) rồi mới tới đơn.
 */
@Injectable()
export class PassengerOpsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly tokenSecret: TokenSecret,
  ) {}

  // ---- Hủy đơn bởi nhân viên (C2) ----------------------------------------------------------------

  async cancel(actor: AuthUser, operatorId: string, code: string, input: unknown) {
    const data = cancelSchema.parse(input);
    const upper = code.trim().toUpperCase();
    if (!isUuid(operatorId) || !BOOKING_CODE.test(upper)) throw notFound('đơn');
    const found = await this.db.query<{ id: string }>('SELECT id FROM bookings WHERE operator_id = $1 AND code = $2', [operatorId, upper]);
    const id = found.rows[0]?.id;
    if (!id) throw notFound('đơn');
    return this.db.tx(async (c) => {
      await c.query(
        'SELECT id FROM trips WHERE id IN (SELECT trip_id FROM booking_items WHERE booking_id = $1) ORDER BY id FOR NO KEY UPDATE',
        [id],
      );
      const { rows } = await c.query<BoardingBooking & { release_at: Date | null; cancelled_by: string | null; cancel_reason: string | null }>(
        `SELECT id, code, status, operator_id, total_amount, deposit_amount, paid_amount, access_token_version, release_at,
                cancelled_by, cancel_reason
         FROM bookings WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const b = rows[0]!;
      const now = this.clock.now();
      if (b.status === 'CANCELLED') {
        // Gửi lại (mạng chập chờn) sau khi đã hủy: trả kết quả hiện có, không tạo khoản hoàn thứ hai.
        const refund = await this.refundOf(c, b.id);
        return { booking: { code: b.code, status: b.status, paidAmount: b.paid_amount }, refund, alreadyCancelled: true };
      }
      if (b.status === 'COMPLETED') throw new DomainError('CONFLICT', 'Chuyến của đơn đã hoàn tất, không hủy được.');
      const expired = b.status === 'EXPIRED' || (b.status === 'HOLDING' && (!b.release_at || b.release_at <= now));
      if (expired && b.paid_amount === 0) throw new DomainError('CONFLICT', 'Đơn đã hết hạn giữ chỗ, không cần hủy.');
      const { rows: boarded } = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM booking_items WHERE booking_id = $1 AND boarded_at IS NOT NULL',
        [b.id],
      );
      if (boarded[0]!.n > 0) throw new DomainError('CONFLICT', 'Khách đã lên xe: bỏ đánh dấu lên xe trước khi hủy.');

      await c.query(
        `UPDATE bookings SET status = 'CANCELLED', cancel_reason = $2, cancelled_by = $3, cancelled_at = $4,
                hold_expires_at = NULL, release_at = NULL, updated_at = $4
         WHERE id = $1`,
        [b.id, data.reason, actor.id, now],
      );
      await c.query('UPDATE trip_seats SET booking_id = NULL WHERE booking_id = $1', [b.id]);
      let refund: Awaited<ReturnType<PassengerOpsService['refundOf']>> = null;
      if (b.paid_amount > 0) {
        await c.query(
          `INSERT INTO refund_obligations (operator_id, booking_id, amount, reason, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [b.operator_id, b.id, b.paid_amount, data.reason, actor.id, now],
        );
        refund = await this.refundOf(c, b.id);
      }
      await this.outbox(c, b.operator_id, 'booking.cancelled', b.id, `booking.cancelled:${b.id}`, {
        bookingCode: b.code, by: 'STAFF', refundAmount: b.paid_amount, notifyCustomer: data.notifyCustomer,
      });
      await this.audit.record(
        {
          operatorId: b.operator_id, actorUserId: actor.id, action: 'booking.cancel_staff', entity: 'booking', entityId: b.id,
          data: { bookingCode: b.code, previousStatus: b.status, refundAmount: b.paid_amount },
        },
        c,
      );
      return { booking: { code: b.code, status: 'CANCELLED', paidAmount: b.paid_amount }, refund, alreadyCancelled: false };
    });
  }

  // ---- Sửa thông tin đơn -------------------------------------------------------------------------

  async edit(actor: AuthUser, operatorId: string, code: string, input: unknown) {
    const data = bookingEditSchema.parse(input);
    const upper = code.trim().toUpperCase();
    if (!isUuid(operatorId) || !BOOKING_CODE.test(upper)) throw notFound('đơn');
    let phone: string | undefined;
    try {
      phone = data.contactPhone === undefined ? undefined : normalizeVnPhone(data.contactPhone);
    } catch (e) {
      if (e instanceof DomainError) throw new DomainError(e.code, e.message, { field: 'contactPhone' });
      throw e;
    }
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{
        id: string; code: string; status: string; release_at: Date | null; contact_name: string; contact_phone: string;
        contact_erased_at: Date | null; passenger_note: string | null; pickup_stop: StopPoint | null; dropoff_stop: StopPoint | null;
        trip_status: string; stops: TripStops | null;
      }>(
        `SELECT b.id, b.code, b.status, b.release_at, b.contact_name, b.contact_phone, b.contact_erased_at, b.passenger_note,
                b.pickup_stop, b.dropoff_stop, t.status AS trip_status, COALESCE(t.stops_snapshot, r.stops) AS stops
         FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN routes r ON r.id = t.route_id
         WHERE b.operator_id = $1 AND b.code = $2
         FOR UPDATE OF b`,
        [operatorId, upper],
      );
      const b = rows[0];
      if (!b) throw notFound('đơn');
      const now = this.clock.now();
      const expired = b.status === 'EXPIRED' || (b.status === 'HOLDING' && (!b.release_at || b.release_at <= now));
      if (b.status === 'CANCELLED' || b.status === 'COMPLETED' || expired) {
        throw new DomainError('CONFLICT', 'Chỉ sửa được đơn đang giữ chỗ hoặc đã xác nhận.');
      }
      if (b.trip_status === 'CANCELLED') throw new DomainError('CONFLICT', 'Chuyến của đơn đã hủy.');
      if (b.contact_erased_at) throw new DomainError('CONFLICT', 'Khách đã xóa thông tin của đơn này.');

      const next = {
        contact_name: data.contactName ?? b.contact_name,
        contact_phone: phone ?? b.contact_phone,
        passenger_note: data.note === undefined ? b.passenger_note : data.note || null,
        pickup_stop: data.pickupStop === undefined ? b.pickup_stop : resolveStopOrCustom(b.stops, 'pickup', data.pickupStop),
        dropoff_stop: data.dropoffStop === undefined ? b.dropoff_stop : resolveStopOrCustom(b.stops, 'dropoff', data.dropoffStop),
      };
      // jsonb trả khóa theo thứ tự riêng của PostgreSQL: so điểm đón/trả theo từng trường, không so chuỗi JSON.
      const same = (a: string | StopPoint | null, z: string | StopPoint | null) =>
        a === null || z === null || typeof a === 'string' || typeof z === 'string'
          ? (a ?? null) === (z ?? null)
          : a.name === z.name && a.time === z.time && a.day === z.day;
      const changed = (
        [
          ['contactName', next.contact_name, b.contact_name],
          ['contactPhone', next.contact_phone, b.contact_phone],
          ['note', next.passenger_note, b.passenger_note],
          ['pickupStop', next.pickup_stop, b.pickup_stop],
          ['dropoffStop', next.dropoff_stop, b.dropoff_stop],
        ] as const
      )
        .filter(([, n, o]) => !same(n, o))
        .map(([k]) => k);
      if (changed.length) {
        await c.query(
          `UPDATE bookings SET contact_name = $2, contact_phone = $3, passenger_note = $4, pickup_stop = $5, dropoff_stop = $6,
                  updated_at = $7
           WHERE id = $1`,
          [b.id, next.contact_name, next.contact_phone, next.passenger_note, next.pickup_stop && JSON.stringify(next.pickup_stop),
            next.dropoff_stop && JSON.stringify(next.dropoff_stop), now],
        );
        // Nhật ký chỉ ghi tên trường đã đổi (không chép họ tên/SĐT vào nhật ký).
        await this.audit.record(
          { operatorId, actorUserId: actor.id, action: 'booking.edit_staff', entity: 'booking', entityId: b.id, data: { bookingCode: b.code, changed } },
          c,
        );
      }
      return {
        booking: {
          code: b.code, contactName: next.contact_name, contactPhone: next.contact_phone, note: next.passenger_note,
          pickupStop: next.pickup_stop, dropoffStop: next.dropoff_stop,
        },
        changed,
      };
    });
  }

  // ---- Khoản cần hoàn ---------------------------------------------------------------------------

  async refunds(operatorId: string, query: unknown) {
    const { status } = refundListQuery.parse(query);
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    const { rows } = await this.db.query<RefundRow>(
      `${REFUND_SELECT} WHERE r.operator_id = $1 ${status === 'OPEN' ? "AND r.status = 'OPEN'" : ''}
       ORDER BY (r.status = 'OPEN') DESC, r.created_at DESC LIMIT 200`,
      [operatorId],
    );
    return { refunds: rows.map(refundView) };
  }

  async resolveRefund(actor: AuthUser, operatorId: string, refundId: string, input: unknown) {
    const data = refundResolveSchema.parse(input);
    if (!isUuid(operatorId) || !isUuid(refundId)) throw notFound('khoản cần hoàn');
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{ id: string; status: string; booking_id: string; amount: number }>(
        'SELECT id, status, booking_id, amount FROM refund_obligations WHERE id = $1 AND operator_id = $2 FOR UPDATE',
        [refundId, operatorId],
      );
      const r = rows[0];
      if (!r) throw notFound('khoản cần hoàn');
      if (r.status !== 'OPEN') {
        if (r.status === data.status) return { refund: await this.refundById(c, r.id), replayed: true };
        throw new DomainError('CONFLICT', 'Khoản này đã được xử lý.');
      }
      const now = this.clock.now();
      await c.query(
        `UPDATE refund_obligations SET status = $2, resolved_at = $3, resolved_by = $4, resolve_note = $5 WHERE id = $1`,
        [r.id, data.status, now, actor.id, data.note ?? null],
      );
      await this.audit.record(
        {
          operatorId, actorUserId: actor.id, action: 'refund.resolve', entity: 'refund_obligation', entityId: r.id,
          data: { status: data.status, amount: r.amount },
        },
        c,
      );
      return { refund: await this.refundById(c, r.id), replayed: false };
    });
  }

  /** Khoản cần hoàn do hủy đơn (mỗi đơn tối đa một; khoản điều chỉnh khi đổi chỗ/tiền là loại ADJUST). */
  private async refundOf(q: Queryable, bookingId: string) {
    const { rows } = await q.query<RefundRow>(`${REFUND_SELECT} WHERE r.booking_id = $1 AND r.kind = 'CANCEL'`, [bookingId]);
    return rows[0] ? refundView(rows[0]) : null;
  }

  private async refundById(q: Queryable, refundId: string) {
    const { rows } = await q.query<RefundRow>(`${REFUND_SELECT} WHERE r.id = $1`, [refundId]);
    return refundView(rows[0]!);
  }

  // ---- Lên xe (C4) ------------------------------------------------------------------------------

  /**
   * Đánh dấu/bỏ đánh dấu lên xe cho các chỗ của một đơn trên chuyến. `qr`: phụ xe quét vé — proof phải khớp
   * (cùng HMAC với trang đối chiếu vé). `assignedTo`: chỉ chuyến người này được phân công (phụ xe).
   */
  async setBoarding(actor: AuthUser, operatorId: string, tripId: string, input: unknown, opts: { assignedTo?: string } = {}) {
    if (!isUuid(operatorId) || !isUuid(tripId)) throw notFound('chuyến');
    const data = boardingSchema.parse(input);
    let code = data.bookingCode;
    let proof: string | null = null;
    if (data.qr) {
      const parsed = parseTicketQr(data.qr);
      if (!parsed) throw new DomainError('VALIDATION_FAILED', 'Mã QR không phải vé của hệ thống.');
      code = parsed.code;
      proof = parsed.proof;
    }
    return this.db.tx(async (c) => {
      await this.lockTrip(c, operatorId, tripId, opts.assignedTo);
      const b = await this.lockBookingOnTrip(c, operatorId, tripId, code!);
      if (!b || (proof !== null && !PROOF.test(proof))) throw new DomainError('NOT_FOUND', `Vé ${code} không thuộc chuyến này.`);
      if (proof !== null && !verifyTicketProof(this.tokenSecret.value, b.id, b.access_token_version, proof)) {
        throw new DomainError('NOT_FOUND', 'Vé không hợp lệ hoặc đã được cấp lại.');
      }
      if (b.status !== 'CONFIRMED' && b.status !== 'COMPLETED') {
        throw new DomainError('CONFLICT', b.status === 'CANCELLED' ? `Đơn ${b.code} đã hủy.` : `Đơn ${b.code} chưa được xác nhận.`, {
          status: b.status,
        });
      }
      const { rows: items } = await c.query<{ seat_code: string }>(
        'SELECT seat_code FROM booking_items WHERE booking_id = $1 AND trip_id = $2',
        [b.id, tripId],
      );
      const own = new Set(items.map((i) => i.seat_code));
      const seats = data.seatCodes ?? [...own];
      const foreign = seats.filter((s) => !own.has(s));
      if (foreign.length) throw new DomainError('VALIDATION_FAILED', `Chỗ ${foreign.join(', ')} không thuộc đơn ${b.code}.`);
      const now = this.clock.now();
      const upd = await c.query(
        data.boarded
          ? `UPDATE booking_items SET boarded_at = $4, boarded_by = $5
             WHERE booking_id = $1 AND trip_id = $2 AND seat_code = ANY($3::text[]) AND boarded_at IS NULL`
          : `UPDATE booking_items SET boarded_at = NULL, boarded_by = NULL
             WHERE booking_id = $1 AND trip_id = $2 AND seat_code = ANY($3::text[]) AND boarded_at IS NOT NULL`,
        data.boarded ? [b.id, tripId, seats, now, actor.id] : [b.id, tripId, seats],
      );
      if (upd.rowCount) {
        await this.audit.record(
          {
            operatorId, actorUserId: actor.id, action: data.boarded ? 'booking.board' : 'booking.unboard', entity: 'booking', entityId: b.id,
            data: { bookingCode: b.code, tripId, seats, via: proof !== null ? 'QR' : 'BUTTON' },
          },
          c,
        );
      }
      return { booking: await this.boardingView(c, b.id, tripId), changed: upd.rowCount ?? 0 };
    });
  }

  // ---- Nhập lại file: lên xe + thực thu trên xe (B2) ----------------------------------------------

  /**
   * Dòng có Mã vé của file đã xuất. "Đã lên xe" có giá trị → đánh dấu chỗ đó lên xe (file không bỏ đánh dấu).
   * "Thực thu trên xe" là **tổng** tiền phụ xe đã thu của đơn: hệ thống chỉ ghi phần chênh so với số đã ghi trước
   * đó, nên nhập lại cùng file hay file đã sửa thêm không ghi tiền hai lần. `dryRun`: xem trước, không khóa, không ghi.
   */
  async importBoarding(actor: AuthUser, operatorId: string, tripId: string, input: unknown, opts: { dryRun: boolean; idempotencyKey?: string }) {
    if (!isUuid(operatorId) || !isUuid(tripId)) throw notFound('chuyến');
    const data = boardingImportSchema.parse(input);
    if (opts.dryRun) {
      return this.db.tx(async (c) => {
        await this.lockTrip(c, operatorId, tripId, undefined, false);
        const plan = await this.planBoarding(c, operatorId, tripId, data.rows, false);
        return { ok: plan.issues.length === 0, ...this.planView(plan) };
      });
    }
    const key = opts.idempotencyKey?.trim() ?? '';
    if (!/^[\w-]{8,100}$/.test(key)) {
      throw new DomainError('VALIDATION_FAILED', 'Idempotency-Key phải dài 8–100 ký tự (chữ, số, "-", "_").', { field: 'Idempotency-Key' });
    }
    const requestHash = createHash('sha256').update(JSON.stringify({ tripId, kind: 'BOARDING', rows: data.rows })).digest('hex');
    try {
      return await this.db.tx(async (c) => {
        const early = await this.replay(c, operatorId, key, requestHash);
        if (early) return early;
        await this.lockTrip(c, operatorId, tripId);
        const again = await this.replay(c, operatorId, key, requestHash);
        if (again) return again;
        const plan = await this.planBoarding(c, operatorId, tripId, data.rows, true);
        if (plan.issues.length) {
          throw new DomainError('VALIDATION_FAILED', 'File còn dòng lỗi. Chưa cập nhật dòng nào.', { issues: plan.issues });
        }
        const now = this.clock.now();
        for (const u of plan.updates) {
          if (u.boardSeats.length) {
            await c.query(
              `UPDATE booking_items SET boarded_at = $4, boarded_by = $5
               WHERE booking_id = $1 AND trip_id = $2 AND seat_code = ANY($3::text[]) AND boarded_at IS NULL`,
              [u.bookingId, tripId, u.boardSeats, now, actor.id],
            );
          }
          if (u.collect > 0) await this.recordOnboard(c, operatorId, u, actor.id, now);
          await this.audit.record(
            {
              operatorId, actorUserId: actor.id, action: 'booking.board_import', entity: 'booking', entityId: u.bookingId,
              data: { bookingCode: u.code, tripId, seats: u.boardSeats, collected: u.collect },
            },
            c,
          );
        }
        const result = { ...this.planView(plan), replayed: false };
        await c.query(
          `INSERT INTO booking_imports (operator_id, trip_id, idempotency_key, request_hash, file_name, result, created_by, created_at, kind)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'BOARDING')`,
          [operatorId, tripId, key, requestHash, data.fileName ?? null, JSON.stringify(result), actor.id, now],
        );
        return result;
      });
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION) && e.constraint === 'booking_imports_operator_id_idempotency_key_key') {
        const existing = await this.replay(this.db, operatorId, key, requestHash);
        if (existing) return existing;
      }
      throw e;
    }
  }

  private async planBoarding(c: Queryable, operatorId: string, tripId: string, rows: z.output<typeof boardingImportSchema>['rows'], lock: boolean) {
    const issues: PlanIssue[] = [];
    const codes = [...new Set(rows.map((r) => r.code.trim().toUpperCase()).filter((x) => BOOKING_CODE.test(x)))];
    const { rows: found } = await c.query<BoardingBooking & { seat_code: string; boarded_at: Date | null; onboard: number }>(
      `SELECT b.id, b.code, b.status, b.operator_id, b.total_amount, b.deposit_amount, b.paid_amount, b.access_token_version,
              bi.seat_code, bi.boarded_at,
              COALESCE((SELECT sum(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
                        WHERE pa.booking_id = b.id AND p.collected_onboard), 0)::int AS onboard
       FROM bookings b JOIN booking_items bi ON bi.booking_id = b.id AND bi.trip_id = $2
       WHERE b.operator_id = $1 AND b.code = ANY($3::text[])
       ORDER BY b.code, bi.seat_code
       ${lock ? 'FOR UPDATE OF b' : ''}`,
      [operatorId, tripId, codes],
    );
    const bookings = new Map<string, { b: BoardingBooking; onboard: number; seats: Map<string, Date | null> }>();
    for (const r of found) {
      let e = bookings.get(r.code);
      if (!e) {
        e = { b: r, onboard: r.onboard, seats: new Map() };
        bookings.set(r.code, e);
      }
      e.seats.set(r.seat_code, r.boarded_at);
    }
    type Acc = { rows: number[]; board: Set<string>; collected: number | null };
    const acc = new Map<string, Acc>();
    let unchanged = 0;
    for (const r of rows) {
      const code = r.code.trim().toUpperCase();
      const e = bookings.get(code);
      if (!BOOKING_CODE.test(code) || !e) {
        issues.push({ rows: [r.row], message: `Dòng ${r.row}: mã vé không thuộc chuyến này.` });
        continue;
      }
      const errs: string[] = [];
      const seatRaw = r.seatCode === null || r.seatCode === undefined ? '' : String(r.seatCode).trim().toUpperCase();
      if (seatRaw && !e.seats.has(seatRaw)) errs.push(`chỗ không thuộc đơn ${code}`);
      const boarded = boardedCell(r.boarded);
      if (boarded === undefined) errs.push('cột Đã lên xe chỉ ghi "x" hoặc để trống');
      const collected = typeof r.collected === 'boolean' ? NaN : wholeNumber(r.collected);
      if (collected !== undefined && (!Number.isInteger(collected) || collected < 0)) errs.push('Thực thu trên xe phải là số tiền không âm');
      if (errs.length) {
        issues.push({ rows: [r.row], message: `Dòng ${r.row}: ${errs.join('; ')}.` });
        continue;
      }
      if (e.b.status !== 'CONFIRMED' && e.b.status !== 'COMPLETED') {
        // File xuất gồm cả đơn đang giữ chỗ/đã hủy: dòng không ghi gì thì bỏ qua; ghi lên xe/thu tiền thì báo lỗi.
        if (boarded || (collected !== undefined && collected > 0)) {
          issues.push({ rows: [r.row], message: `Dòng ${r.row}: đơn ${code} ${e.b.status === 'CANCELLED' ? 'đã hủy' : 'chưa được xác nhận'}, không ghi lên xe/thực thu được.` });
        } else unchanged += 1;
        continue;
      }
      let a = acc.get(code);
      if (!a) {
        a = { rows: [], board: new Set(), collected: null };
        acc.set(code, a);
      }
      a.rows.push(r.row);
      if (boarded) for (const s of seatRaw ? [seatRaw] : e.seats.keys()) a.board.add(s);
      if (collected !== undefined) a.collected = (a.collected ?? 0) + collected;
    }
    const updates: BoardingUpdate[] = [];
    for (const [code, a] of acc) {
      const e = bookings.get(code)!;
      const boardSeats = [...a.board].filter((s) => e.seats.get(s) === null);
      let collect = 0;
      if (a.collected !== null) {
        const due = e.b.total_amount - e.b.paid_amount;
        if (a.collected < e.onboard) {
          issues.push({ rows: a.rows, message: `${rowsLabel(a.rows)}: thực thu ${vnd(a.collected)} nhỏ hơn số đã ghi ${vnd(e.onboard)} của đơn ${code}.` });
          continue;
        }
        collect = a.collected - e.onboard;
        if (collect > due) {
          issues.push({ rows: a.rows, message: `${rowsLabel(a.rows)}: thực thu thêm ${vnd(collect)} lớn hơn số còn phải thu ${vnd(due)} của đơn ${code}.` });
          continue;
        }
      }
      if (!boardSeats.length && collect === 0) {
        unchanged += a.rows.length;
        continue;
      }
      updates.push({
        bookingId: e.b.id, code, rows: a.rows, boardSeats, collect,
        totalAmount: e.b.total_amount, depositAmount: e.b.deposit_amount, paidAmount: e.b.paid_amount,
      });
    }
    issues.sort((x, y) => Math.min(...x.rows) - Math.min(...y.rows));
    return { issues, updates, unchanged };
  }

  private planView(plan: { issues: PlanIssue[]; updates: BoardingUpdate[]; unchanged: number }) {
    return {
      issues: plan.issues,
      updates: plan.updates.map((u) => ({
        code: u.code, rows: u.rows, boardSeats: u.boardSeats, collectAmount: u.collect,
        dueAfter: u.totalAmount - u.paidAmount - u.collect,
      })),
      unchanged: plan.unchanged,
      totals: {
        bookings: plan.updates.length,
        boardSeats: plan.updates.reduce((n, u) => n + u.boardSeats.length, 0),
        collectAmount: plan.updates.reduce((n, u) => n + u.collect, 0),
      },
    };
  }

  /** Tiền mặt thu trên xe: `payments` CASH `collected_onboard`, phân bổ thẳng vào đơn (đã khóa). */
  private async recordOnboard(c: PoolClient, operatorId: string, u: BoardingUpdate, actorId: string, now: Date) {
    const { rows: pay } = await c.query<{ id: string }>(
      `INSERT INTO payments (operator_id, method, amount, content, transaction_at, received_at, allocated_amount,
                             matched_booking_id, recorded_by, review_note, collected_onboard)
       VALUES ($1, 'CASH', $2, $3, $4, $4, $2, $5, $6, 'Thu trên xe (nhập file)', true) RETURNING id`,
      [operatorId, u.collect, u.code, now, u.bookingId, actorId],
    );
    const { rows: al } = await c.query<{ id: string }>(
      'INSERT INTO payment_allocations (payment_id, booking_id, amount, allocated_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [pay[0]!.id, u.bookingId, u.collect, actorId],
    );
    const paid = u.paidAmount + u.collect;
    const paymentStatus = paid >= u.totalAmount ? 'PAID' : paid >= u.depositAmount ? 'DEPOSIT_PAID' : 'PARTIAL';
    await c.query('UPDATE bookings SET paid_amount = $2, payment_status = $3, updated_at = $4 WHERE id = $1', [
      u.bookingId, paid, paymentStatus, now,
    ]);
    await this.outbox(c, operatorId, 'payment.received', pay[0]!.id, `payment.received:${pay[0]!.id}`, { amount: u.collect });
    await this.outbox(c, operatorId, 'payment.allocated', u.bookingId, `payment.allocated:${al[0]!.id}`, {
      bookingCode: u.code, amount: u.collect, paidAmount: paid, paymentStatus,
    });
  }

  private async replay(q: Queryable, operatorId: string, key: string, requestHash: string) {
    const { rows } = await q.query<{ request_hash: string; result: object; kind: string }>(
      'SELECT request_hash, result, kind FROM booking_imports WHERE operator_id = $1 AND idempotency_key = $2',
      [operatorId, key],
    );
    const r = rows[0];
    if (!r) return undefined;
    if (r.request_hash !== requestHash || r.kind !== 'BOARDING') {
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng cho một file khác.');
    }
    return { ...r.result, replayed: true };
  }

  /** Khóa chuyến (nhân viên nhà xe, hoặc phụ xe được phân công). Chuyến nháp/đã hủy không lên xe được. */
  private async lockTrip(c: Queryable, operatorId: string, tripId: string, assignedTo?: string, lock = true) {
    const { rows } = await c.query<{ id: string; status: string }>(
      `SELECT t.id, t.status FROM trips t
       WHERE t.id = $1 AND t.operator_id = $2
         ${assignedTo ? `AND EXISTS (SELECT 1 FROM trip_assistants ta JOIN users u ON u.id = ta.user_id
                                     WHERE ta.trip_id = t.id AND ta.operator_id = t.operator_id AND ta.user_id = $3
                                       AND u.role = 'ASSISTANT' AND u.status = 'ACTIVE' AND u.archived_at IS NULL)` : ''}
       ${lock ? 'FOR NO KEY UPDATE' : ''}`,
      assignedTo ? [tripId, operatorId, assignedTo] : [tripId, operatorId],
    );
    const t = rows[0];
    if (!t) throw notFound('chuyến');
    if (t.status === 'DRAFT' || t.status === 'CANCELLED') {
      throw new DomainError('CONFLICT', t.status === 'DRAFT' ? 'Chuyến đang ở bản nháp.' : 'Chuyến đã hủy.');
    }
    return t;
  }

  private async lockBookingOnTrip(c: Queryable, operatorId: string, tripId: string, code: string) {
    const { rows } = await c.query<BoardingBooking>(
      `SELECT b.id, b.code, b.status, b.operator_id, b.total_amount, b.deposit_amount, b.paid_amount, b.access_token_version
       FROM bookings b
       WHERE b.operator_id = $1 AND b.code = $2 AND EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id AND bi.trip_id = $3)
       FOR UPDATE`,
      [operatorId, code, tripId],
    );
    return rows[0];
  }

  private async boardingView(q: Queryable, bookingId: string, tripId: string): Promise<BoardingView> {
    const { rows } = await q.query<{
      code: string; status: string; contact_name: string; total_amount: number; paid_amount: number;
      seat_code: string; occupancy: number; boarded_at: Date | null;
    }>(
      `SELECT b.code, b.status, b.contact_name, b.total_amount, b.paid_amount, bi.seat_code, bi.occupancy, bi.boarded_at
       FROM bookings b JOIN booking_items bi ON bi.booking_id = b.id AND bi.trip_id = $2
       WHERE b.id = $1 ORDER BY length(bi.seat_code), bi.seat_code`,
      [bookingId, tripId],
    );
    const f = rows[0]!;
    return {
      code: f.code, status: f.status, contactName: f.contact_name, dueAmount: Math.max(f.total_amount - f.paid_amount, 0),
      seats: rows.map((r) => ({ code: r.seat_code, occupancy: r.occupancy, boardedAt: r.boarded_at?.toISOString() ?? null })),
    };
  }

  private async outbox(c: Queryable, operatorId: string, type: string, aggregateId: string, dedupeKey: string, payload: object) {
    await c.query(
      `INSERT INTO outbox_events (operator_id, type, aggregate_id, payload, dedupe_key) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [operatorId, type, aggregateId, JSON.stringify(payload), dedupeKey],
    );
  }
}

interface BoardingUpdate {
  bookingId: string;
  code: string;
  rows: number[];
  boardSeats: string[];
  collect: number;
  totalAmount: number;
  depositAmount: number;
  paidAmount: number;
}

interface RefundRow {
  id: string; kind: string; booking_code: string; amount: number; reason: string; status: string; created_at: Date;
  created_by_name: string | null; resolved_at: Date | null; resolved_by_name: string | null; resolve_note: string | null;
  contact_name: string; contact_phone: string; contact_erased_at: Date | null;
}
const REFUND_SELECT = `
  SELECT r.id, r.kind, b.code AS booking_code, r.amount, r.reason, r.status, r.created_at, cu.full_name AS created_by_name,
         r.resolved_at, ru.full_name AS resolved_by_name, r.resolve_note, b.contact_name, b.contact_phone, b.contact_erased_at
  FROM refund_obligations r
  JOIN bookings b ON b.id = r.booking_id
  LEFT JOIN users cu ON cu.id = r.created_by
  LEFT JOIN users ru ON ru.id = r.resolved_by`;
function refundView(r: RefundRow) {
  return {
    id: r.id, kind: r.kind, bookingCode: r.booking_code, amount: r.amount, reason: r.reason, status: r.status,
    createdAt: r.created_at.toISOString(), createdBy: r.created_by_name,
    resolvedAt: r.resolved_at?.toISOString() ?? null, resolvedBy: r.resolved_by_name, resolveNote: r.resolve_note,
    // Kế toán cần liên hệ khách để hoàn tiền; khách đã xóa thông tin thì không còn SĐT.
    contactName: r.contact_name, contactPhone: r.contact_erased_at ? '' : r.contact_phone, contactErased: r.contact_erased_at !== null,
  };
}

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const rowsLabel = (rows: number[]) => (rows.length > 1 ? `Dòng ${rows.slice(0, -1).join(', ')} và ${rows.at(-1)}` : `Dòng ${rows[0]}`);
