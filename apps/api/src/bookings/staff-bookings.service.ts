import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.service';
import { Clock } from '../common/clock';
import { bookingCode } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { normalizeVnPhone } from '../common/phone';
import { Db, isPgError, PG_UNIQUE_VIOLATION, Queryable } from '../db/db';
import { OperatorsService } from '../operators/operators.service';
import type { OperatorPolicy } from '../operators/policy';
import { SEAT_CODE } from '../seat-layouts/layout-parser';
import { expireDueHoldsForTrip } from './bookings.service';
import { depositAmount, fixedUnitDeposit, MAX_BOOKING_TOTAL, priceItems, type PricedItem } from './pricing';
import { resolveStop, type StopPoint, type TripStops } from './stops';

/** Tối đa chỗ trong một đơn tại quầy (cùng trần với đơn online). */
export const MAX_STAFF_ITEMS = 20;
/** Tối đa dòng khách mới trong một lần nhập file. */
export const MAX_IMPORT_ROWS = 200;

const money = z.number().int().min(0).max(MAX_BOOKING_TOTAL);

export const staffBookingSchema = z
  .object({
    contactName: z.string().trim().min(1).max(120),
    contactPhone: z.string().min(1).max(30),
    note: z.string().trim().max(500).optional(),
    pickupStop: z.string().trim().max(160).optional(),
    dropoffStop: z.string().trim().max(160).optional(),
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
      .max(MAX_STAFF_ITEMS),
    /** Tiền mặt nhận tại quầy lúc tạo đơn. */
    paidAmount: money.default(0),
    /**
     * true (mặc định): xác nhận ngay, phần còn lại thu sau (trên xe).
     * false: giữ chỗ chờ chuyển khoản theo hạn của nhà xe; trả đủ cọc ngay thì vẫn xác nhận.
     */
    confirm: z.boolean().default(true),
    /** false: không gửi tin cho khách (ghi vào sự kiện cho worker thông báo). */
    notifyCustomer: z.boolean().default(true),
  })
  .strict();
export type StaffBookingInput = z.input<typeof staffBookingSchema>;

/** Ô đọc từ file: chữ hoặc số (Excel có thể lưu SĐT/tiền dạng số), trống = null. */
const cell = z.union([z.string().max(500), z.number().finite()]).nullable().optional();
export const importRowSchema = z
  .object({
    /** Số dòng trong sheet (để báo lỗi đúng dòng người dùng thấy). */
    row: z.number().int().min(1).max(100_000),
    seatCode: cell,
    contactName: cell,
    contactPhone: cell,
    occupancy: cell,
    infantCount: cell,
    pickupStop: cell,
    dropoffStop: cell,
    paidAmount: cell,
    /** Tổng tiền ghi trong file: chỉ để cảnh báo khi khác giá hệ thống. */
    totalAmount: cell,
    note: cell,
  })
  .strict();
export const importSchema = z
  .object({
    fileName: z.string().trim().max(200).optional(),
    confirm: z.boolean().default(true),
    notifyCustomer: z.boolean().default(true),
    rows: z.array(importRowSchema).min(1, 'File chưa có dòng khách mới.').max(MAX_IMPORT_ROWS, `Mỗi lần nhập tối đa ${MAX_IMPORT_ROWS} dòng khách.`),
  })
  .strict();
export type ImportInput = z.input<typeof importSchema>;

/** Lỗi của một (hoặc vài) dòng; thông báo không chứa họ tên/SĐT. */
export interface PlanIssue {
  rows: number[];
  message: string;
}

interface PlanItem {
  row: number;
  seatCode: string;
  occupancy: number;
  infantCount: number;
}
interface Group {
  rows: number[];
  contactName: string;
  phone: string;
  notes: string[];
  pickup: StopPoint | null;
  dropoff: StopPoint | null;
  paidAmount: number;
  fileTotal: number | null;
  items: PlanItem[];
  /** Có dòng mâu thuẫn (đã ghi vào issues) — không lập đơn. */
  invalid?: boolean;
}
interface Planned extends Group {
  priced: PricedItem[];
  total: number;
  deposit: number;
  status: 'CONFIRMED' | 'HOLDING';
  paymentStatus: string;
}

interface TripCtx {
  id: string;
  operatorId: string;
  operatorCode: string;
  stops: TripStops | null;
  seats: Map<string, { floor: string; maxOccupancy: number; sellable: boolean; takenBy: string | null }>;
  fares: { floor: string; occupancy: number; price: number }[];
  policy: OperatorPolicy;
  now: Date;
}

/** Đơn đã tạo/đã có — chỉ mã, chỗ, tiền (không họ tên/SĐT), dùng cho kết quả và lưu lịch sử nhập. */
export interface StaffBookingSummary {
  code: string;
  rows: number[];
  status: string;
  seats: string[];
  totalAmount: number;
  depositAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: string;
  holdUntil: string | null;
}

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const collapse = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ');
const text = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : collapse(String(v)));
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const rowsLabel = (rows: number[]) => (rows.length > 1 ? `Dòng ${rows.slice(0, -1).join(', ')} và ${rows.at(-1)}` : `Dòng ${rows[0]}`);

/** Số nguyên không âm từ ô (chấp nhận "840.000", "840,000đ"). undefined = ô trống; NaN = không đọc được. */
function wholeNumber(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return undefined;
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  const s = v.trim().replace(/[\s.,đ₫]|vnd/gi, '');
  return /^-?\d+$/.test(s) ? Number(s) : NaN;
}

/** SĐT từ ô Excel: ô dạng số làm mất số 0 đầu (912345678) → thêm lại. */
function phoneFromCell(v: string | number | null | undefined): string {
  const s = text(v);
  return /^[35789]\d{8}$/.test(s) ? `0${s}` : s;
}

/**
 * Đơn do nhân viên tạo (`channel='STAFF'`): bán tại quầy (C1) và nhập danh sách khách mới từ file (B3).
 * Dùng cùng kho chỗ, bảng giá và cách tính cọc như đơn online; khóa chuyến `FOR NO KEY UPDATE` trước khi ghi.
 * Không áp giới hạn chống lạm dụng của khách online (OTP, số đơn giữ theo SĐT, số chỗ tối đa mỗi đơn của chính sách).
 */
@Injectable()
export class StaffBookingsService {
  constructor(
    private readonly db: Db,
    private readonly operators: OperatorsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // ---- Bán tại quầy ------------------------------------------------------------------------------

  /**
   * Tạo một đơn tại quầy. `dryRun`: chỉ tính giá và kiểm tra chỗ, không khóa, không ghi.
   * Ghi thật bắt buộc Idempotency-Key: bấm hai lần chỉ tạo một đơn.
   */
  async createAtCounter(actor: AuthUser, operatorId: string, tripId: string, input: unknown, opts: { dryRun: boolean; idempotencyKey?: string }) {
    if (!isUuid(operatorId) || !isUuid(tripId)) throw notFound('chuyến');
    const data = staffBookingSchema.parse(input);
    const phone = normalizeVnPhone(data.contactPhone);
    const codes = data.items.map((i) => i.seatCode);
    if (new Set(codes).size !== codes.length) throw new DomainError('VALIDATION_FAILED', 'Một chỗ chỉ được chọn một lần trong đơn.');
    const toGroup = (ctx: TripCtx): Group => ({
      rows: data.items.map((_, i) => i + 1),
      contactName: data.contactName,
      phone,
      notes: data.note ? [data.note] : [],
      pickup: resolveStop(ctx.stops, 'pickup', data.pickupStop),
      dropoff: resolveStop(ctx.stops, 'dropoff', data.dropoffStop),
      paidAmount: data.paidAmount,
      fileTotal: null,
      items: data.items.map((it, i) => ({ row: i + 1, ...it })),
    });

    if (opts.dryRun) {
      const ctx = await this.loadTrip(this.db, operatorId, tripId, false);
      const issues: PlanIssue[] = [];
      const [planned] = this.plan(ctx, [toGroup(ctx)], data.confirm, issues, false);
      return { ok: issues.length === 0, issues, quote: planned ? this.preview(planned) : null };
    }

    const key = this.checkKey(opts.idempotencyKey);
    const requestHash = createHash('sha256').update(JSON.stringify({ tripId, phone, ...data })).digest('hex');
    try {
      return await this.db.tx(async (c) => {
        const ctx = await this.loadTrip(c, operatorId, tripId, true);
        const existing = await this.replayCounter(c, operatorId, key, requestHash);
        if (existing) return existing;
        const issues: PlanIssue[] = [];
        const planned = this.plan(ctx, [toGroup(ctx)], data.confirm, issues, false);
        if (issues.length) throw this.issuesError(issues);
        const [booking] = await this.commit(c, ctx, planned, actor, {
          idempotencyKey: key, requestHash, notifyCustomer: data.notifyCustomer, source: 'COUNTER',
        });
        return { booking: booking!, replayed: false };
      });
    } catch (e) {
      // Cùng khóa gửi song song: ràng buộc duy nhất chặn bản thứ hai → trả đơn đã tạo.
      if (isPgError(e, PG_UNIQUE_VIOLATION) && e.constraint === 'bookings_operator_id_idempotency_key_key') {
        const existing = await this.replayCounter(this.db, operatorId, key, requestHash);
        if (existing) return existing;
      }
      throw e;
    }
  }

  // ---- Nhập danh sách khách mới ------------------------------------------------------------------

  /**
   * Nhập các dòng khách mới (không có mã vé) của một chuyến. Dòng cùng SĐT và họ tên gộp thành một đơn nhiều chỗ.
   * `dryRun`: kiểm tra từng dòng, trả xem trước + lỗi + cảnh báo, không ghi gì.
   * Ghi thật: một transaction, tất cả hoặc không có gì — còn một dòng lỗi (kể cả chỗ vừa có khách online lấy sau lúc
   * xem trước) thì không tạo đơn nào. Idempotency-Key (băm nội dung file) chặn ghi hai lần.
   */
  async importPassengers(actor: AuthUser, operatorId: string, tripId: string, input: unknown, opts: { dryRun: boolean; idempotencyKey?: string }) {
    if (!isUuid(operatorId) || !isUuid(tripId)) throw notFound('chuyến');
    const data = importSchema.parse(input);
    const dupRows = data.rows.map((r) => r.row).filter((r, i, all) => all.indexOf(r) !== i);
    if (dupRows.length) throw new DomainError('VALIDATION_FAILED', `Số dòng bị lặp: ${[...new Set(dupRows)].join(', ')}.`);

    if (opts.dryRun) {
      const ctx = await this.loadTrip(this.db, operatorId, tripId, false);
      const issues: PlanIssue[] = [];
      const warnings: PlanIssue[] = [];
      const planned = this.plan(ctx, this.groupRows(ctx, data.rows, issues), data.confirm, issues, true, warnings);
      return {
        ok: issues.length === 0 && planned.length > 0,
        issues: this.sortIssues(issues),
        warnings: this.sortIssues(warnings),
        bookings: planned.map((p) => this.preview(p)),
        totals: {
          bookings: planned.length,
          seats: planned.reduce((n, p) => n + p.items.length, 0),
          totalAmount: planned.reduce((n, p) => n + p.total, 0),
          paidAmount: planned.reduce((n, p) => n + p.paidAmount, 0),
        },
      };
    }

    const key = this.checkKey(opts.idempotencyKey);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ tripId, rows: data.rows, confirm: data.confirm, notifyCustomer: data.notifyCustomer }))
      .digest('hex');
    try {
      return await this.db.tx(async (c) => {
        const ctx = await this.loadTrip(c, operatorId, tripId, true);
        const existing = await this.replayImport(c, operatorId, key, requestHash);
        if (existing) return existing;
        const issues: PlanIssue[] = [];
        const planned = this.plan(ctx, this.groupRows(ctx, data.rows, issues), data.confirm, issues, true);
        if (issues.length) throw this.issuesError(this.sortIssues(issues), 'File còn dòng lỗi hoặc có chỗ vừa được đặt sau lúc xem trước. Chưa nhập dòng nào.');
        if (!planned.length) throw new DomainError('VALIDATION_FAILED', 'File chưa có dòng khách mới.');
        const bookings = await this.commit(c, ctx, planned, actor, { notifyCustomer: data.notifyCustomer, source: 'IMPORT' });
        const result = { bookings };
        await c.query(
          `INSERT INTO booking_imports (operator_id, trip_id, idempotency_key, request_hash, file_name, result, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [operatorId, tripId, key, requestHash, data.fileName ?? null, JSON.stringify(result), actor.id, ctx.now],
        );
        await this.audit.record(
          {
            operatorId, actorUserId: actor.id, action: 'booking.import', entity: 'trip', entityId: tripId,
            data: { fileName: data.fileName ?? null, rows: data.rows.length, bookings: bookings.length, seats: bookings.reduce((n, b) => n + b.seats.length, 0) },
          },
          c,
        );
        return { ...result, replayed: false };
      });
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION) && e.constraint === 'booking_imports_operator_id_idempotency_key_key') {
        const existing = await this.replayImport(this.db, operatorId, key, requestHash);
        if (existing) return existing;
      }
      throw e;
    }
  }

  // ---- Lõi ------------------------------------------------------------------------------------------

  private checkKey(key: string | undefined): string {
    const k = key?.trim() ?? '';
    if (!/^[\w-]{8,100}$/.test(k)) {
      throw new DomainError('VALIDATION_FAILED', 'Idempotency-Key phải dài 8–100 ký tự (chữ, số, "-", "_").', { field: 'Idempotency-Key' });
    }
    return k;
  }

  private issuesError(issues: PlanIssue[], message?: string): DomainError {
    const seatTaken = issues.some((i) => /đã có đơn|không bán/.test(i.message));
    return new DomainError(seatTaken ? 'SEAT_UNAVAILABLE' : 'VALIDATION_FAILED', message ?? issues[0]!.message, { issues });
  }

  private sortIssues(issues: PlanIssue[]) {
    return [...issues].sort((a, b) => Math.min(...a.rows) - Math.min(...b.rows));
  }

  /**
   * Chuyến của nhà xe (khác nhà xe → 404) kèm kho chỗ, bảng giá, chính sách. Nhân viên bán được khi chuyến mở bán
   * hoặc đã đóng bán online (`CLOSED`), miễn chưa khởi hành; chuyến nháp/đã hủy thì không.
   * `lock`: khóa hàng chuyến và dọn đơn giữ chỗ quá hạn trước khi đọc kho chỗ.
   */
  private async loadTrip(q: Queryable, operatorId: string, tripId: string, lock: boolean): Promise<TripCtx> {
    const now = this.clock.now();
    const { rows } = await q.query<{ id: string; status: string; depart_at: Date; stops: TripStops | null; operator_code: string }>(
      `SELECT t.id, t.status, t.depart_at, COALESCE(t.stops_snapshot, r.stops) AS stops, o.code AS operator_code
       FROM trips t JOIN routes r ON r.id = t.route_id JOIN operators o ON o.id = t.operator_id
       WHERE t.id = $1 AND t.operator_id = $2${lock ? ' FOR NO KEY UPDATE OF t' : ''}`,
      [tripId, operatorId],
    );
    const t = rows[0];
    if (!t) throw notFound('chuyến');
    if (t.status === 'DRAFT') throw new DomainError('TRIP_NOT_ON_SALE', 'Chuyến đang ở bản nháp, chưa bán vé được.');
    if (t.status === 'CANCELLED') throw new DomainError('TRIP_NOT_ON_SALE', 'Chuyến đã hủy.');
    if (now >= t.depart_at) throw new DomainError('TRIP_NOT_ON_SALE', 'Chuyến đã khởi hành.');
    if (lock) await expireDueHoldsForTrip(q, tripId, now);
    const { rows: seats } = await q.query<{ seat_code: string; floor: string; max_occupancy: number; sellable: boolean; taken_by: string | null }>(
      `SELECT ts.seat_code, ts.floor, ts.max_occupancy, ts.sellable, b.code AS taken_by
       FROM trip_seats ts
       LEFT JOIN bookings b ON b.id = ts.booking_id AND NOT (b.status = 'HOLDING' AND b.release_at <= $2)
       WHERE ts.trip_id = $1`,
      [tripId, now],
    );
    const { rows: fares } = await q.query<{ floor: string; occupancy: number; price: number }>(
      'SELECT floor, occupancy, price FROM trip_fares WHERE trip_id = $1',
      [tripId],
    );
    return {
      id: t.id,
      operatorId,
      operatorCode: t.operator_code,
      stops: t.stops,
      seats: new Map(seats.map((s) => [s.seat_code, { floor: s.floor, maxOccupancy: s.max_occupancy, sellable: s.sellable, takenBy: s.taken_by }])),
      fares,
      policy: await this.operators.currentPolicy(operatorId, q),
      now,
    };
  }

  /** Đọc dòng file thành nhóm khách (cùng SĐT + họ tên = một đơn); dòng thiếu/sai ghi vào `issues`. */
  private groupRows(ctx: TripCtx, rows: z.output<typeof importRowSchema>[], issues: PlanIssue[]): Group[] {
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const errs: string[] = [];
      const seatCode = text(r.seatCode).toUpperCase().replace(/\s+/g, '');
      if (!seatCode) errs.push('thiếu Phòng/Chỗ');
      else if (!SEAT_CODE.test(seatCode)) errs.push(`mã chỗ "${seatCode.slice(0, 12)}" không hợp lệ`);
      const name = text(r.contactName);
      if (!name) errs.push('thiếu Họ tên khách');
      else if (name.length > 120) errs.push('họ tên quá 120 ký tự');
      let phone = '';
      const rawPhone = phoneFromCell(r.contactPhone);
      if (!rawPhone) errs.push('thiếu SĐT');
      else {
        try {
          phone = normalizeVnPhone(rawPhone);
        } catch {
          errs.push('SĐT không hợp lệ');
        }
      }
      const occupancy = wholeNumber(r.occupancy) ?? 1;
      if (!(occupancy === 1 || occupancy === 2)) errs.push('Số người phải là 1 hoặc 2');
      const infantCount = wholeNumber(r.infantCount) ?? 0;
      if (!Number.isInteger(infantCount) || infantCount < 0 || infantCount > 2) errs.push('Trẻ <2 tuổi phải từ 0 đến 2');
      const paid = wholeNumber(r.paidAmount) ?? 0;
      if (!Number.isInteger(paid) || paid < 0 || paid > MAX_BOOKING_TOTAL) errs.push('Đã trả phải là số tiền không âm');
      const fileTotal = wholeNumber(r.totalAmount);
      const note = text(r.note);
      if (note.length > 500) errs.push('ghi chú quá 500 ký tự');
      let pickup: StopPoint | null = null;
      let dropoff: StopPoint | null = null;
      try {
        pickup = resolveStop(ctx.stops, 'pickup', text(r.pickupStop));
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        errs.push(lowerFirst(e.message.replace(/\.$/, '')));
      }
      try {
        dropoff = resolveStop(ctx.stops, 'dropoff', text(r.dropoffStop));
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        errs.push(lowerFirst(e.message.replace(/\.$/, '')));
      }
      if (errs.length) {
        issues.push({ rows: [r.row], message: `Dòng ${r.row}: ${errs.join('; ')}.` });
        continue;
      }
      const groupKey = `${phone}|${name.toLocaleLowerCase('vi')}`;
      let g = groups.get(groupKey);
      if (!g) {
        g = { rows: [], contactName: name, phone, notes: [], pickup: null, dropoff: null, paidAmount: 0, fileTotal: null, items: [] };
        groups.set(groupKey, g);
      }
      for (const [field, value, label] of [['pickup', pickup, 'điểm đón'], ['dropoff', dropoff, 'điểm trả']] as const) {
        if (!value) continue;
        const current = g[field];
        if (current && current.name !== value.name) {
          issues.push({ rows: [g.rows[0]!, r.row], message: `${rowsLabel([g.rows[0]!, r.row])} cùng khách nhưng khác ${label}.` });
          g.invalid = true;
        } else g[field] = value;
      }
      g.rows.push(r.row);
      g.items.push({ row: r.row, seatCode, occupancy, infantCount });
      g.paidAmount += paid;
      if (fileTotal !== undefined && Number.isInteger(fileTotal)) g.fileTotal = (g.fileTotal ?? 0) + fileTotal;
      if (note && !g.notes.includes(note)) g.notes.push(note);
    }
    return [...groups.values()];
  }

  /** Kiểm tra chỗ, giá, tiền của từng nhóm (không ghi). Nhóm lỗi không có trong kết quả. */
  private plan(ctx: TripCtx, groups: Group[], confirm: boolean, issues: PlanIssue[], fromFile: boolean, warnings: PlanIssue[] = []): Planned[] {
    const at = (rows: number[]) => (fromFile ? `${rowsLabel(rows)}: ` : '');
    const seatRow = new Map<string, number>();
    const planned: Planned[] = [];
    for (const g of groups) {
      if (g.invalid) continue;
      if (g.items.length > MAX_STAFF_ITEMS) {
        issues.push({ rows: g.rows, message: `${at(g.rows)}một khách tối đa ${MAX_STAFF_ITEMS} chỗ trong một đơn.` });
        continue;
      }
      let ok = true;
      for (const it of g.items) {
        const seat = ctx.seats.get(it.seatCode);
        const prev = seatRow.get(it.seatCode);
        if (!seat) {
          issues.push({ rows: [it.row], message: `${at([it.row])}chỗ ${it.seatCode} không có trên xe này.` });
          ok = false;
        } else if (prev !== undefined) {
          issues.push({ rows: [prev, it.row], message: `${rowsLabel([prev, it.row])} cùng chỗ ${it.seatCode}.` });
          ok = false;
        } else if (!seat.sellable) {
          issues.push({ rows: [it.row], message: `${at([it.row])}chỗ ${it.seatCode} không bán.` });
          ok = false;
        } else if (seat.takenBy) {
          issues.push({ rows: [it.row], message: `${at([it.row])}chỗ ${it.seatCode} đã có đơn ${seat.takenBy}.` });
          ok = false;
        }
        if (seat && prev === undefined) seatRow.set(it.seatCode, it.row);
      }
      if (!ok) continue;
      let priced: { items: PricedItem[]; total: number };
      try {
        priced = priceItems(
          g.items,
          g.items.map((i) => ({ seatCode: i.seatCode, floor: ctx.seats.get(i.seatCode)!.floor, maxOccupancy: ctx.seats.get(i.seatCode)!.maxOccupancy })),
          ctx.fares,
          ctx.policy.childPolicy,
        );
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        const seatCode = (e.details as { seatCode?: string } | undefined)?.seatCode;
        const rows = g.items.filter((i) => i.seatCode === seatCode).map((i) => i.row);
        issues.push({ rows: rows.length ? rows : g.rows, message: `${at(rows.length ? rows : g.rows)}${fromFile ? lowerFirst(e.message) : e.message}` });
        continue;
      }
      const total = priced.total;
      if (g.paidAmount > total) {
        issues.push({ rows: g.rows, message: `${at(g.rows)}${fromFile ? 'đ' : 'Đ'}ã trả ${vnd(g.paidAmount)} lớn hơn tổng tiền ${vnd(total)}.` });
        continue;
      }
      if (g.fileTotal !== null && g.fileTotal !== total) {
        warnings.push({ rows: g.rows, message: `${at(g.rows)}tổng tiền trong file ${vnd(g.fileTotal)} khác giá hệ thống ${vnd(total)}; dùng giá hệ thống.` });
      }
      const fixed = ctx.policy.fixedDeposit;
      const deposit = fixed
        ? priced.items.reduce((s, i) => s + fixedUnitDeposit(i.lineTotal, i.occupancy, fixed), 0)
        : depositAmount(total, ctx.policy.depositPercent);
      const status = confirm || g.paidAmount >= deposit ? 'CONFIRMED' : 'HOLDING';
      const paymentStatus =
        g.paidAmount >= total ? 'PAID' : g.paidAmount === 0 ? 'UNPAID' : status === 'CONFIRMED' && g.paidAmount >= deposit ? 'DEPOSIT_PAID' : 'PARTIAL';
      planned.push({ ...g, priced: priced.items, total, deposit, status, paymentStatus });
    }
    return planned;
  }

  /** Xem trước một đơn sẽ tạo (nhân viên vừa nhập nên được thấy lại họ tên/SĐT). */
  private preview(p: Planned) {
    return {
      rows: p.rows,
      contactName: p.contactName,
      contactPhone: p.phone,
      note: p.notes.join(' · ') || null,
      pickupStop: p.pickup,
      dropoffStop: p.dropoff,
      seats: p.priced.map((i) => ({ code: i.seatCode, occupancy: i.occupancy, infantCount: i.infantCount, lineTotal: i.lineTotal })),
      status: p.status,
      totalAmount: p.total,
      depositAmount: p.deposit,
      paidAmount: p.paidAmount,
      dueAmount: p.total - p.paidAmount,
      paymentStatus: p.paymentStatus,
    };
  }

  /** Ghi các đơn đã kiểm tra (bên gọi đã khóa chuyến). Tiền mặt ghi vào `payments` + `payment_allocations` như sổ thu hiện có. */
  private async commit(
    c: PoolClient,
    ctx: TripCtx,
    planned: Planned[],
    actor: AuthUser,
    opts: { idempotencyKey?: string; requestHash?: string; notifyCustomer: boolean; source: 'COUNTER' | 'IMPORT' },
  ): Promise<StaffBookingSummary[]> {
    const now = ctx.now;
    const out: StaffBookingSummary[] = [];
    for (const p of planned) {
      const holding = p.status === 'HOLDING';
      const holdExpiresAt = holding ? new Date(now.getTime() + ctx.policy.holdMinutes * 60_000) : null;
      const releaseAt = holdExpiresAt ? new Date(holdExpiresAt.getTime() + ctx.policy.paymentGraceMinutes * 60_000) : null;
      let booking: { id: string; code: string } | undefined;
      for (let attempt = 0; attempt < 5 && !booking; attempt++) {
        const { rows } = await c.query<{ id: string; code: string }>(
          `INSERT INTO bookings (operator_id, trip_id, code, status, hold_expires_at, release_at, contact_name, contact_phone,
                                 total_amount, deposit_amount, policy_snapshot, channel, idempotency_key, request_hash,
                                 passenger_note, pickup_stop, dropoff_stop, created_by, confirmed_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'STAFF', $12, $13, $14, $15, $16, $17, $18, $19, $19)
           ON CONFLICT (code) DO NOTHING RETURNING id, code`,
          [ctx.operatorId, ctx.id, bookingCode(ctx.operatorCode), p.status, holdExpiresAt, releaseAt, p.contactName, p.phone,
            p.total, p.deposit, JSON.stringify(ctx.policy), opts.idempotencyKey ?? null, opts.requestHash ?? null,
            p.notes.join(' · ') || null, p.pickup && JSON.stringify(p.pickup), p.dropoff && JSON.stringify(p.dropoff),
            actor.id, holding ? null : now, now],
        );
        booking = rows[0];
      }
      if (!booking) throw new Error('Could not generate a unique booking code');
      for (const it of p.priced) {
        await c.query(
          `INSERT INTO booking_items (booking_id, trip_id, seat_code, occupancy, infant_count, unit_price, infant_price, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [booking.id, ctx.id, it.seatCode, it.occupancy, it.infantCount, it.unitPrice, it.infantPrice, it.lineTotal],
        );
      }
      const codes = p.priced.map((i) => i.seatCode);
      const upd = await c.query(
        'UPDATE trip_seats SET booking_id = $1 WHERE trip_id = $2 AND seat_code = ANY($3::text[]) AND sellable AND booking_id IS NULL',
        [booking.id, ctx.id, codes],
      );
      if (upd.rowCount !== codes.length) throw new Error('Seat inventory changed while the trip row was locked');

      if (p.paidAmount > 0) {
        const { rows: pay } = await c.query<{ id: string }>(
          `INSERT INTO payments (operator_id, method, amount, content, transaction_at, received_at, allocated_amount,
                                 matched_booking_id, recorded_by, review_note)
           VALUES ($1, 'CASH', $2, $3, $4, $4, $2, $5, $6, $7) RETURNING id`,
          [ctx.operatorId, p.paidAmount, booking.code, now, booking.id, actor.id,
            opts.source === 'IMPORT' ? 'Nhập từ file danh sách khách' : 'Thu tại quầy khi bán vé'],
        );
        const { rows: al } = await c.query<{ id: string }>(
          'INSERT INTO payment_allocations (payment_id, booking_id, amount, allocated_by) VALUES ($1, $2, $3, $4) RETURNING id',
          [pay[0]!.id, booking.id, p.paidAmount, actor.id],
        );
        await c.query('UPDATE bookings SET paid_amount = $2, payment_status = $3 WHERE id = $1', [booking.id, p.paidAmount, p.paymentStatus]);
        await this.outbox(c, ctx.operatorId, 'payment.received', pay[0]!.id, `payment.received:${pay[0]!.id}`, { amount: p.paidAmount });
        await this.outbox(c, ctx.operatorId, 'payment.allocated', booking.id, `payment.allocated:${al[0]!.id}`, {
          bookingCode: booking.code, amount: p.paidAmount, paidAmount: p.paidAmount, paymentStatus: p.paymentStatus,
        });
      }
      if (!holding) {
        await this.outbox(c, ctx.operatorId, 'booking.confirmed', booking.id, `booking.confirmed:${booking.id}`, {
          bookingCode: booking.code, channel: 'STAFF', notifyCustomer: opts.notifyCustomer,
        });
      }
      await this.audit.record(
        {
          operatorId: ctx.operatorId, actorUserId: actor.id, action: 'booking.create_staff', entity: 'booking', entityId: booking.id,
          data: { bookingCode: booking.code, source: opts.source, seats: codes, totalAmount: p.total, paidAmount: p.paidAmount, status: p.status },
        },
        c,
      );
      out.push({
        code: booking.code,
        rows: p.rows,
        status: p.status,
        seats: codes,
        totalAmount: p.total,
        depositAmount: p.deposit,
        paidAmount: p.paidAmount,
        dueAmount: p.total - p.paidAmount,
        paymentStatus: p.paymentStatus,
        holdUntil: holdExpiresAt?.toISOString() ?? null,
      });
    }
    return out;
  }

  private async replayCounter(q: Queryable, operatorId: string, key: string, requestHash: string) {
    const { rows } = await q.query<{
      id: string; code: string; status: string; channel: string; request_hash: string | null; total_amount: number; deposit_amount: number;
      paid_amount: number; payment_status: string; hold_expires_at: Date | null;
    }>(
      `SELECT id, code, status, channel, request_hash, total_amount, deposit_amount, paid_amount, payment_status, hold_expires_at
       FROM bookings WHERE operator_id = $1 AND idempotency_key = $2`,
      [operatorId, key],
    );
    const b = rows[0];
    if (!b) return undefined;
    if (b.channel !== 'STAFF' || b.request_hash !== requestHash) {
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng cho một yêu cầu khác.');
    }
    const { rows: items } = await q.query<{ seat_code: string }>('SELECT seat_code FROM booking_items WHERE booking_id = $1 ORDER BY seat_code', [b.id]);
    const booking: StaffBookingSummary = {
      code: b.code,
      rows: items.map((_, i) => i + 1),
      status: b.status,
      seats: items.map((i) => i.seat_code),
      totalAmount: b.total_amount,
      depositAmount: b.deposit_amount,
      paidAmount: b.paid_amount,
      dueAmount: Math.max(b.total_amount - b.paid_amount, 0),
      paymentStatus: b.payment_status,
      holdUntil: b.status === 'HOLDING' ? b.hold_expires_at?.toISOString() ?? null : null,
    };
    return { booking, replayed: true };
  }

  private async replayImport(q: Queryable, operatorId: string, key: string, requestHash: string) {
    const { rows } = await q.query<{ request_hash: string; result: { bookings: StaffBookingSummary[] } }>(
      'SELECT request_hash, result FROM booking_imports WHERE operator_id = $1 AND idempotency_key = $2',
      [operatorId, key],
    );
    const r = rows[0];
    if (!r) return undefined;
    if (r.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng cho một file khác.');
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
