import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.service';
import { can } from '../auth/permissions';
import { Clock } from '../common/clock';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { Db, isPgError, PG_UNIQUE_VIOLATION, Queryable } from '../db/db';
import { DEFAULT_POLICY, type OperatorPolicy } from '../operators/policy';
import { SEAT_CODE } from '../seat-layouts/layout-parser';
import { expireDueHoldsForTrip } from './bookings.service';
import { depositAmount, fixedUnitDeposit, MAX_BOOKING_TOTAL, priceItems, type PricedItem } from './pricing';
import { MAX_STAFF_ITEMS } from './staff-bookings.service';
import { resolveStop, type StopPoint, type TripStops } from './stops';

const BOOKING_CODE = /^[A-Z0-9]{4,12}$/;
const money = z.number().int().min(0).max(MAX_BOOKING_TOTAL);

/**
 * Nhân viên đổi một chặng của đơn: chỗ khác trên cùng chuyến, hoặc sang chuyến/ngày khác; kèm (hoặc chỉ) chỉnh tiền.
 * Bỏ trống `items` = giữ nguyên mã chỗ, số người, số bé của chặng (ví dụ đổi ngày nhưng giữ giường A3/A4).
 * `totalAmount`, `depositAmount`, `refundAmount` (giảm "đã thu", tạo khoản cần hoàn) cần quyền `payment.manage`.
 */
export const bookingChangeSchema = z
  .object({
    /** Chặng cần đổi; bỏ trống = chặng đi (chuyến chính của đơn). */
    fromTripId: z.string().uuid().optional(),
    /** Chuyến đích; bỏ trống = cùng chuyến. */
    toTripId: z.string().uuid().optional(),
    items: z
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
      .max(MAX_STAFF_ITEMS)
      .optional(),
    /** Tổng tiền chỉnh tay (thay giá tính theo bảng giá). */
    totalAmount: money.optional(),
    /** Mức cọc chỉnh tay (≤ tổng tiền). */
    depositAmount: money.optional(),
    /** Giảm "đã thu" một khoản và ghi khoản cần hoàn tương ứng. */
    refundAmount: z.number().int().min(1).max(MAX_BOOKING_TOTAL).optional(),
    /**
     * Xác nhận đơn đang giữ chỗ dù chưa thu đủ cọc (trường hợp đặc biệt nhà xe cho đặt không cọc trước).
     * Cần `payment.manage` và lý do. Mặc định đơn chỉ tự xác nhận khi đã thu ít nhất một khoản và đủ cọc.
     */
    confirmWithoutDeposit: z.boolean().optional(),
    /** Bắt buộc khi chỉnh tiền tay, xác nhận không cọc hoặc có khoản cần hoàn. */
    reason: z.string().trim().max(300).optional(),
    /** false: không báo khách (ghi vào sự kiện cho worker thông báo). */
    notifyCustomer: z.boolean().default(true),
  })
  .strict();
export type BookingChangeInput = z.input<typeof bookingChangeSchema>;

interface SeatLine {
  tripId: string;
  seatCode: string;
  occupancy: number;
  infantCount: number;
  unitPrice: number;
  infantPrice: number;
  lineTotal: number;
}

/** Ảnh chụp đơn trước/sau (không họ tên/SĐT) — lưu vào `booking_changes` và trả cho dashboard. */
export interface BookingSnapshot {
  tripId: string;
  status: string;
  seats: { tripId: string; seatCode: string; occupancy: number; infantCount: number; lineTotal: number }[];
  totalAmount: number;
  depositAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: string;
  pickupStop: StopPoint | null;
  dropoffStop: StopPoint | null;
}

export interface BookingChangeResult {
  booking: BookingSnapshot & { code: string };
  before: BookingSnapshot;
  changed: string[];
  refundAmount: number;
  warnings: string[];
  replayed: boolean;
}

interface BookingRow {
  id: string;
  code: string;
  operator_id: string;
  trip_id: string;
  status: string;
  release_at: Date | null;
  total_amount: number;
  deposit_amount: number;
  paid_amount: number;
  payment_status: string;
  policy_snapshot: Partial<OperatorPolicy>;
  pickup_stop: StopPoint | null;
  dropoff_stop: StopPoint | null;
}
interface ItemRow {
  trip_id: string;
  seat_code: string;
  occupancy: number;
  infant_count: number;
  unit_price: number;
  infant_price: number;
  line_total: number;
  boarded_at: Date | null;
}
interface TripRow {
  id: string;
  status: string;
  depart_at: Date;
  origin: string;
  destination: string;
  route_id: string;
  stops: TripStops | null;
}
interface Plan {
  b: BookingRow;
  before: BookingSnapshot;
  after: BookingSnapshot;
  fromTripId: string;
  toTripId: string;
  seatChange: boolean;
  newLeg: SeatLine[];
  confirm: boolean;
  refundAmount: number;
  changed: string[];
  warnings: string[];
}

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const sameStop = (a: StopPoint | null, z: StopPoint | null) =>
  a === null || z === null ? a === z : a.name === z.name && a.time === z.time && a.day === z.day;

function paymentStatusOf(status: string, paid: number, total: number, deposit: number): string {
  if (paid >= total) return 'PAID';
  if (paid === 0) return 'UNPAID';
  return status === 'CONFIRMED' && paid >= deposit ? 'DEPOSIT_PAID' : 'PARTIAL';
}

/**
 * Đổi chỗ / chuyến / tiền của đơn đã đặt (dashboard). Khóa theo thứ tự như đặt vé và thanh toán: mọi chuyến liên quan
 * (các chặng hiện có + chuyến đích, `FOR NO KEY UPDATE` theo ID) rồi mới tới đơn (`FOR UPDATE`).
 * Giá tính lại theo bảng giá chuyến đích và chính sách đã chụp trong đơn; "đã thu" giữ nguyên, phần dư so với
 * tổng mới (hoặc phần nhân viên chủ động giảm) chuyển thành khoản cần hoàn — sổ thu không bị sửa.
 */
@Injectable()
export class BookingChangesService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async change(
    actor: AuthUser,
    operatorId: string,
    code: string,
    input: unknown,
    opts: { dryRun: boolean; idempotencyKey?: string },
  ): Promise<BookingChangeResult> {
    const data = bookingChangeSchema.parse(input);
    const upper = code.trim().toUpperCase();
    if (!isUuid(operatorId) || !BOOKING_CODE.test(upper)) throw notFound('đơn');
    if (moneyOverride(data) && !can(actor.role, 'payment.manage')) {
      throw new DomainError('FORBIDDEN', 'Chỉnh tay tổng tiền, tiền cọc, giảm số đã thu hoặc xác nhận không cọc cần quyền quản lý thu tiền.');
    }
    if (data.items) {
      const codes = data.items.map((i) => i.seatCode);
      if (new Set(codes).size !== codes.length) throw new DomainError('VALIDATION_FAILED', 'Một chỗ chỉ được chọn một lần trong đơn.');
    }

    if (opts.dryRun) {
      const plan = await this.plan(this.db, operatorId, upper, data, false, actor.role);
      return this.view(plan, false);
    }

    const key = this.checkKey(opts.idempotencyKey);
    const requestHash = createHash('sha256').update(JSON.stringify({ code: upper, ...data })).digest('hex');
    try {
      return await this.db.tx(async (c) => {
        // Hai lần gửi cùng khóa chạy song song: lần sau chờ lần đầu xong rồi trả lại kết quả cũ, không lập kế hoạch
        // trên đơn đã đổi (sẽ báo "chưa có thay đổi" hoặc sai chặng).
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking-change:${operatorId}:${key}`]);
        const early = await this.replay(c, operatorId, key, requestHash);
        if (early) return early;
        const plan = await this.plan(c, operatorId, upper, data, true, actor.role);
        const result = this.view(plan, false);
        await this.commit(c, actor, plan, data, key, requestHash, result);
        return result;
      });
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION) && e.constraint === 'booking_changes_operator_id_idempotency_key_key') {
        const existing = await this.replay(this.db, operatorId, key, requestHash);
        if (existing) return existing;
      }
      throw e;
    }
  }

  // ---- Lập kế hoạch (dùng chung cho xem trước và ghi thật) ---------------------------------------

  private async plan(
    q: Queryable,
    operatorId: string,
    code: string,
    data: z.output<typeof bookingChangeSchema>,
    lock: boolean,
    role: AuthUser['role'],
  ): Promise<Plan> {
    const now = this.clock.now();
    const { rows: found } = await q.query<{ id: string; trip_id: string }>(
      'SELECT id, trip_id FROM bookings WHERE operator_id = $1 AND code = $2',
      [operatorId, code],
    );
    if (!found[0]) throw notFound('đơn');
    const bookingId = found[0].id;
    const fromTripId = data.fromTripId ?? found[0].trip_id;
    const toTripId = data.toTripId ?? fromTripId;

    // Khóa mọi chuyến liên quan theo thứ tự ID (cùng thứ tự với đặt vé/thanh toán) trước khi khóa đơn.
    const { rows: trips } = await q.query<TripRow>(
      `SELECT t.id, t.status, t.depart_at, t.route_id, r.origin, r.destination, COALESCE(t.stops_snapshot, r.stops) AS stops
       FROM trips t JOIN routes r ON r.id = t.route_id
       WHERE t.operator_id = $1 AND (t.id = ANY($2::uuid[]) OR t.id IN (SELECT trip_id FROM booking_items WHERE booking_id = $3))
       ORDER BY t.id${lock ? ' FOR NO KEY UPDATE OF t' : ''}`,
      [operatorId, [fromTripId, toTripId], bookingId],
    );
    const tripBy = new Map(trips.map((t) => [t.id, t]));
    // Đơn giữ chỗ quá hạn trên chuyến đích phải được trả chỗ trước khi chiếm (kể cả khi đổi trong cùng chuyến).
    if (lock && tripBy.has(toTripId)) await expireDueHoldsForTrip(q, toTripId, now);

    const { rows: bRows } = await q.query<BookingRow>(
      `SELECT id, code, operator_id, trip_id, status, release_at, total_amount, deposit_amount, paid_amount, payment_status,
              policy_snapshot, pickup_stop, dropoff_stop
       FROM bookings WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [bookingId],
    );
    const b = bRows[0]!;
    const { rows: items } = await q.query<ItemRow>(
      `SELECT trip_id, seat_code, occupancy, infant_count, unit_price, infant_price, line_total, boarded_at
       FROM booking_items WHERE booking_id = $1 ORDER BY trip_id, seat_code`,
      [b.id],
    );
    // Đơn vừa được đổi sang chuyến khác giữa lúc đọc và lúc khóa: chuyến mới chưa được khóa → yêu cầu thử lại.
    if (items.some((i) => !tripBy.has(i.trip_id))) throw new DomainError('CONFLICT', 'Đơn vừa được sửa ở nơi khác, vui lòng tải lại.');

    const expired = b.status === 'EXPIRED' || (b.status === 'HOLDING' && (!b.release_at || b.release_at <= now));
    if (b.status === 'CANCELLED' || b.status === 'COMPLETED' || expired) {
      throw new DomainError('CONFLICT', 'Chỉ sửa được đơn đang giữ chỗ hoặc đã xác nhận.');
    }
    const lines = (rows: ItemRow[]): SeatLine[] =>
      rows.map((i) => ({
        tripId: i.trip_id, seatCode: i.seat_code, occupancy: i.occupancy, infantCount: i.infant_count,
        unitPrice: i.unit_price, infantPrice: i.infant_price, lineTotal: i.line_total,
      }));
    const leg = items.filter((i) => i.trip_id === fromTripId);
    if (!leg.length) throw new DomainError('VALIDATION_FAILED', 'Đơn không có chỗ trên chuyến cần đổi.', { field: 'fromTripId' });
    const others = lines(items.filter((i) => i.trip_id !== fromTripId));

    const policy = { ...DEFAULT_POLICY, ...b.policy_snapshot } as OperatorPolicy;
    const wanted = (data.items ?? leg.map((i) => ({ seatCode: i.seat_code, occupancy: i.occupancy, infantCount: i.infant_count })))
      .map((i) => ({ seatCode: i.seatCode, occupancy: i.occupancy, infantCount: i.infantCount }))
      .sort((a, z) => a.seatCode.localeCompare(z.seatCode));
    const legKey = (xs: { seatCode: string; occupancy: number; infantCount: number }[]) =>
      xs.map((x) => `${x.seatCode}:${x.occupancy}:${x.infantCount}`).sort().join('|');
    const seatChange =
      toTripId !== fromTripId ||
      legKey(wanted) !== legKey(leg.map((i) => ({ seatCode: i.seat_code, occupancy: i.occupancy, infantCount: i.infant_count })));

    const warnings: string[] = [];
    let newLeg = lines(leg);
    if (seatChange) {
      if (leg.some((i) => i.boarded_at)) throw new DomainError('CONFLICT', 'Khách đã lên xe: bỏ đánh dấu lên xe trước khi đổi chỗ.');
      const from = tripBy.get(fromTripId)!;
      if (now >= from.depart_at) throw new DomainError('CONFLICT', 'Chuyến hiện tại của đơn đã khởi hành, không đổi chỗ được.');
      const to = tripBy.get(toTripId);
      if (!to) throw notFound('chuyến');
      if (to.status === 'DRAFT') throw new DomainError('TRIP_NOT_ON_SALE', 'Chuyến mới đang ở bản nháp, chưa bán vé được.');
      if (to.status === 'CANCELLED') throw new DomainError('TRIP_NOT_ON_SALE', 'Chuyến mới đã hủy.');
      if (now >= to.depart_at) throw new DomainError('TRIP_NOT_ON_SALE', 'Chuyến mới đã khởi hành.');
      if (toTripId !== fromTripId && others.some((o) => o.tripId === toTripId)) {
        throw new DomainError('VALIDATION_FAILED', 'Đơn đã có chặng trên chuyến này.', { field: 'toTripId' });
      }
      if (toTripId !== fromTripId && others.length) {
        // Đơn khứ hồi: giữ quy tắc lúc đặt — chặng về ngược chiều chặng đi và khởi hành sau chặng đi.
        const otherTrip = tripBy.get(others[0]!.tripId)!;
        const movingOutbound = fromTripId === b.trip_id;
        const out = movingOutbound ? to : otherTrip;
        const ret = movingOutbound ? otherTrip : to;
        if (ret.origin !== out.destination || ret.destination !== out.origin || ret.depart_at <= out.depart_at) {
          throw new DomainError(
            'VALIDATION_FAILED',
            'Chuyến về phải đúng tuyến ngược chiều và khởi hành sau chuyến đi.',
            { field: 'toTripId' },
          );
        }
      }
      if (to.route_id !== from.route_id) warnings.push('Chuyến mới thuộc tuyến khác chuyến cũ.');

      const { rows: seats } = await q.query<{ seat_code: string; floor: string; max_occupancy: number; sellable: boolean; booking_id: string | null; taken_by: string | null }>(
        `SELECT ts.seat_code, ts.floor, ts.max_occupancy, ts.sellable, b.id AS booking_id, b.code AS taken_by
         FROM trip_seats ts
         LEFT JOIN bookings b ON b.id = ts.booking_id AND NOT (b.status = 'HOLDING' AND b.release_at <= $3)
         WHERE ts.trip_id = $1 AND ts.seat_code = ANY($2::text[])`,
        [toTripId, wanted.map((w) => w.seatCode), now],
      );
      const seatBy = new Map(seats.map((s) => [s.seat_code, s]));
      for (const w of wanted) {
        const s = seatBy.get(w.seatCode);
        if (!s) throw new DomainError('VALIDATION_FAILED', `Chỗ ${w.seatCode} không có trên xe của chuyến mới.`, { seatCode: w.seatCode });
        if (!s.sellable) throw new DomainError('SEAT_UNAVAILABLE', `Chỗ ${w.seatCode} không bán.`, { seatCode: w.seatCode });
        if (s.booking_id && s.booking_id !== b.id) {
          throw new DomainError('SEAT_UNAVAILABLE', `Chỗ ${w.seatCode} đã có đơn ${s.taken_by}.`, { seatCode: w.seatCode });
        }
      }
      const { rows: fares } = await q.query<{ floor: string; occupancy: number; price: number }>(
        'SELECT floor, occupancy, price FROM trip_fares WHERE trip_id = $1',
        [toTripId],
      );
      const priced: { items: PricedItem[] } = priceItems(
        wanted,
        seats.map((s) => ({ seatCode: s.seat_code, floor: s.floor, maxOccupancy: s.max_occupancy })),
        fares,
        policy.childPolicy,
      );
      newLeg = priced.items.map((i) => ({ tripId: toTripId, ...i }));
    }

    const allLines = [...others, ...newLeg];
    const computedTotal = seatChange ? allLines.reduce((n, l) => n + l.lineTotal, 0) : b.total_amount;
    if (computedTotal > MAX_BOOKING_TOTAL) throw new DomainError('LIMIT_EXCEEDED', 'Tổng tiền đơn vượt giới hạn cho phép.');
    const total = data.totalAmount ?? computedTotal;
    // Cọc theo chính sách của đơn. Đơn đang ở đúng mức cọc theo chính sách thì đổi chỗ tính lại theo chính sách;
    // đơn đã được chỉnh cọc tay thì giữ mức đó (không vượt tổng mới) và cảnh báo nếu chính sách sẽ cho mức khác.
    const policyDeposit = (ls: SeatLine[], t: number) => {
      const fixed = policy.fixedDeposit;
      return fixed
        ? Math.min(t, ls.reduce((n, l) => n + fixedUnitDeposit(l.lineTotal, l.occupancy, fixed), 0))
        : depositAmount(t, policy.depositPercent ?? 100);
    };
    const wasPolicyDeposit = seatChange && b.deposit_amount === policyDeposit(lines(items), b.total_amount);
    let deposit: number;
    if (data.depositAmount !== undefined) {
      if (data.depositAmount > total) {
        throw new DomainError('VALIDATION_FAILED', `Tiền cọc ${vnd(data.depositAmount)} lớn hơn tổng tiền ${vnd(total)}.`, { field: 'depositAmount' });
      }
      deposit = data.depositAmount;
    } else if (data.totalAmount !== undefined) {
      deposit = policyDeposit(allLines, total);
    } else if (wasPolicyDeposit) {
      deposit = policyDeposit(allLines, total);
    } else {
      deposit = Math.min(b.deposit_amount, total);
      if (seatChange) {
        const suggested = policyDeposit(allLines, total);
        if (suggested !== deposit) warnings.push(`Giữ cọc ${vnd(deposit)}; theo chính sách mới cọc sẽ là ${vnd(suggested)}. Chỉnh tay nếu cần.`);
      }
    }

    const manualRefund = data.refundAmount ?? 0;
    if (manualRefund > b.paid_amount) {
      throw new DomainError('VALIDATION_FAILED', `Số giảm ${vnd(manualRefund)} lớn hơn số đã thu ${vnd(b.paid_amount)}.`, { field: 'refundAmount' });
    }
    const paidAfterManual = b.paid_amount - manualRefund;
    const excess = Math.max(0, paidAfterManual - total);
    // Đổi sang giá thấp hơn số đã thu tạo khoản cần hoàn: việc này thuộc quản lý thu tiền, không chỉ quyền sửa đơn.
    if (excess > 0 && !can(role, 'payment.manage')) {
      throw new DomainError('FORBIDDEN', 'Thay đổi này làm đơn có khoản cần hoàn; cần quyền quản lý thu tiền.');
    }
    const paid = paidAfterManual - excess;
    const refundAmount = manualRefund + excess;

    // Tự xác nhận chỉ khi đã thu ít nhất một khoản và đủ cọc (đơn 0 đồng thì không cần thu). Hạ cọc về 0 khi chưa thu
    // không tự xác nhận; muốn giữ chỗ không cọc thì quản lý bật `confirmWithoutDeposit` kèm lý do.
    if (data.confirmWithoutDeposit && b.status !== 'HOLDING') {
      throw new DomainError('VALIDATION_FAILED', 'Đơn đã được xác nhận.', { field: 'confirmWithoutDeposit' });
    }
    const confirm =
      b.status === 'HOLDING' && (data.confirmWithoutDeposit === true || (paid >= deposit && (paid > 0 || total === 0)));
    const status = confirm ? 'CONFIRMED' : b.status;

    // Đổi chuyến chính: chụp lại điểm đón/trả theo danh sách điểm của chuyến mới (khớp theo tên).
    let pickup = b.pickup_stop;
    let dropoff = b.dropoff_stop;
    const outboundMoves = fromTripId === b.trip_id && toTripId !== fromTripId;
    if (outboundMoves) {
      const stops = tripBy.get(toTripId)!.stops;
      const rematch = (kind: 'pickup' | 'dropoff', cur: StopPoint | null, label: string): StopPoint | null => {
        if (!cur) return null;
        if (!stops?.[kind]?.length) return { name: cur.name, time: '', day: 0 };
        try {
          return resolveStop(stops, kind, cur.name);
        } catch {
          warnings.push(`${label} "${cur.name}" không có trên chuyến mới, đã bỏ trống.`);
          return null;
        }
      };
      pickup = rematch('pickup', b.pickup_stop, 'Điểm đón');
      dropoff = rematch('dropoff', b.dropoff_stop, 'Điểm trả');
    }

    const snapshot = (
      tripId: string, st: string, ls: SeatLine[], t: number, d: number, p: number, ps: string, pu: StopPoint | null, df: StopPoint | null,
    ): BookingSnapshot => ({
      tripId,
      status: st,
      seats: ls.map((l) => ({ tripId: l.tripId, seatCode: l.seatCode, occupancy: l.occupancy, infantCount: l.infantCount, lineTotal: l.lineTotal })),
      totalAmount: t,
      depositAmount: d,
      paidAmount: p,
      dueAmount: Math.max(0, t - p),
      paymentStatus: ps,
      pickupStop: pu,
      dropoffStop: df,
    });
    const before = snapshot(b.trip_id, b.status, lines(items), b.total_amount, b.deposit_amount, b.paid_amount, b.payment_status, b.pickup_stop, b.dropoff_stop);
    const after = snapshot(
      outboundMoves ? toTripId : b.trip_id, status, allLines.sort((x, y) => x.tripId.localeCompare(y.tripId) || x.seatCode.localeCompare(y.seatCode)),
      total, deposit, paid, paymentStatusOf(status, paid, total, deposit), pickup, dropoff,
    );

    const changed: string[] = [];
    if (toTripId !== fromTripId) changed.push('trip');
    if (seatChange) changed.push('seats');
    if (after.totalAmount !== before.totalAmount) changed.push('totalAmount');
    if (after.depositAmount !== before.depositAmount) changed.push('depositAmount');
    if (after.paidAmount !== before.paidAmount) changed.push('paidAmount');
    if (after.status !== before.status) changed.push('status');
    if (!sameStop(pickup, b.pickup_stop) || !sameStop(dropoff, b.dropoff_stop)) changed.push('stops');
    if (!changed.length) throw new DomainError('VALIDATION_FAILED', 'Chưa có thay đổi nào.');
    // Xem trước không bắt lý do: nhân viên cần thấy khoản cần hoàn trước rồi mới ghi lý do.
    if (lock && (moneyOverride(data) || refundAmount > 0) && (data.reason?.length ?? 0) < 3) {
      throw new DomainError('VALIDATION_FAILED', 'Vui lòng ghi lý do (ít nhất 3 ký tự) khi chỉnh tiền, xác nhận không cọc hoặc có khoản cần hoàn.', { field: 'reason' });
    }
    return { b, before, after, fromTripId, toTripId, seatChange, newLeg, confirm, refundAmount, changed, warnings };
  }

  // ---- Ghi ---------------------------------------------------------------------------------------

  private async commit(
    c: PoolClient, actor: AuthUser, p: Plan, data: z.output<typeof bookingChangeSchema>, key: string, requestHash: string, result: BookingChangeResult,
  ) {
    const now = this.clock.now();
    const { b, after } = p;
    if (p.seatChange) {
      await c.query('UPDATE trip_seats SET booking_id = NULL WHERE trip_id = $1 AND booking_id = $2', [p.fromTripId, b.id]);
      await c.query('DELETE FROM booking_items WHERE booking_id = $1 AND trip_id = $2', [b.id, p.fromTripId]);
      for (const it of p.newLeg) {
        await c.query(
          `INSERT INTO booking_items (booking_id, trip_id, seat_code, occupancy, infant_count, unit_price, infant_price, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [b.id, p.toTripId, it.seatCode, it.occupancy, it.infantCount, it.unitPrice, it.infantPrice, it.lineTotal],
        );
      }
      const codes = p.newLeg.map((i) => i.seatCode);
      const upd = await c.query(
        'UPDATE trip_seats SET booking_id = $1 WHERE trip_id = $2 AND seat_code = ANY($3::text[]) AND sellable AND booking_id IS NULL',
        [b.id, p.toTripId, codes],
      );
      if (upd.rowCount !== codes.length) throw new DomainError('SEAT_UNAVAILABLE', 'Chỗ vừa có người đặt, vui lòng chọn lại.');
    }
    await c.query(
      `UPDATE bookings SET trip_id = $2, status = $3, total_amount = $4, deposit_amount = $5, paid_amount = $6, payment_status = $7,
              pickup_stop = $8, dropoff_stop = $9,
              hold_expires_at = CASE WHEN $10 THEN NULL ELSE hold_expires_at END,
              release_at = CASE WHEN $10 THEN NULL ELSE release_at END,
              confirmed_at = CASE WHEN $10 THEN $11 ELSE confirmed_at END, updated_at = $11
       WHERE id = $1`,
      [b.id, after.tripId, after.status, after.totalAmount, after.depositAmount, after.paidAmount, after.paymentStatus,
        after.pickupStop && JSON.stringify(after.pickupStop), after.dropoffStop && JSON.stringify(after.dropoffStop), p.confirm, now],
    );
    if (p.refundAmount > 0) {
      await c.query(
        `INSERT INTO refund_obligations (operator_id, booking_id, amount, reason, created_by, created_at, kind)
         VALUES ($1, $2, $3, $4, $5, $6, 'ADJUST')`,
        [b.operator_id, b.id, p.refundAmount, data.reason, actor.id, now],
      );
    }
    const { rows: ch } = await c.query<{ id: string }>(
      `INSERT INTO booking_changes (operator_id, booking_id, idempotency_key, request_hash, reason, before, after, result, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [b.operator_id, b.id, key, requestHash, data.reason || null, JSON.stringify(p.before), JSON.stringify(after), JSON.stringify(result), actor.id, now],
    );
    await this.outbox(c, b.operator_id, 'booking.changed', b.id, `booking.changed:${ch[0]!.id}`, {
      bookingCode: b.code, by: 'STAFF', changed: p.changed, notifyCustomer: data.notifyCustomer,
      tripId: after.tripId, seats: after.seats.map((s) => s.seatCode), totalAmount: after.totalAmount, paidAmount: after.paidAmount,
      refundAmount: p.refundAmount,
    });
    if (p.confirm) {
      await this.outbox(c, b.operator_id, 'booking.confirmed', b.id, `booking.confirmed:${b.id}`, {
        bookingCode: b.code, channel: 'STAFF', notifyCustomer: data.notifyCustomer,
      });
    }
    // Nhật ký: chỗ, chuyến, tiền trước/sau — không chép họ tên/SĐT.
    const brief = (s: BookingSnapshot) => ({
      tripId: s.tripId, status: s.status, seats: s.seats.map((x) => `${x.seatCode}@${x.tripId}`),
      totalAmount: s.totalAmount, depositAmount: s.depositAmount, paidAmount: s.paidAmount,
    });
    await this.audit.record(
      {
        operatorId: b.operator_id, actorUserId: actor.id, action: 'booking.change_staff', entity: 'booking', entityId: b.id,
        data: { bookingCode: b.code, changed: p.changed, before: brief(p.before), after: brief(after), refundAmount: p.refundAmount },
      },
      c,
    );
  }

  private view(p: Plan, replayed: boolean): BookingChangeResult {
    return {
      booking: { code: p.b.code, ...p.after },
      before: p.before,
      changed: p.changed,
      refundAmount: p.refundAmount,
      warnings: p.warnings,
      replayed,
    };
  }

  private checkKey(key: string | undefined): string {
    const k = key?.trim() ?? '';
    if (!/^[\w-]{8,100}$/.test(k)) {
      throw new DomainError('VALIDATION_FAILED', 'Idempotency-Key phải dài 8–100 ký tự (chữ, số, "-", "_").', { field: 'Idempotency-Key' });
    }
    return k;
  }

  private async replay(q: Queryable, operatorId: string, key: string, requestHash: string): Promise<BookingChangeResult | undefined> {
    const { rows } = await q.query<{ request_hash: string; result: BookingChangeResult }>(
      'SELECT request_hash, result FROM booking_changes WHERE operator_id = $1 AND idempotency_key = $2',
      [operatorId, key],
    );
    const r = rows[0];
    if (!r) return undefined;
    if (r.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng cho một yêu cầu khác.');
    return { ...r.result, replayed: true };
  }

  private async outbox(c: Queryable, operatorId: string, type: string, aggregateId: string, dedupeKey: string, payload: object) {
    await c.query(
      `INSERT INTO outbox_events (operator_id, type, aggregate_id, payload, dedupe_key) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [operatorId, type, aggregateId, JSON.stringify(payload), dedupeKey],
    );
  }
}

function moneyOverride(d: z.output<typeof bookingChangeSchema>) {
  return (
    d.totalAmount !== undefined || d.depositAmount !== undefined || d.refundAmount !== undefined || d.confirmWithoutDeposit === true
  );
}
