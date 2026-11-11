import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { OPERATOR_CODE } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { Db, isPgError, PG_UNIQUE_VIOLATION, Queryable } from '../db/db';
import { SmsSender } from '../abuse/sms-sender';
import { SeatLayoutsService } from '../seat-layouts/seat-layouts.service';
import { DEFAULT_POLICY, OperatorPolicy, PolicyInput, policyInputSchema } from './policy';

export interface OperatorRow {
  id: string;
  code: string;
  name: string;
}

export const createOperatorSchema = z
  .object({
    code: z.string().regex(OPERATOR_CODE, 'Tiền tố mã là 2–4 chữ cái in hoa'),
    name: z.string().trim().min(1).max(120),
  })
  .strict();
export type CreateOperatorInput = z.infer<typeof createOperatorSchema>;

/** Xe tạo sẵn khi thêm nhà xe mới (docs/NEN-TANG-DA-NHA-XE.md mục 1.4). */
const DEFAULT_VEHICLES = [
  { suffix: '01', name: 'Xe 01', type: 'LIMOUSINE', layout: 'LIMO24' },
  { suffix: '02', name: 'Xe 02', type: 'SLEEPER', layout: 'BED40' },
] as const;

export const LOGO_MAX_BYTES = 200 * 1024;

/** Nhận diện ảnh theo chữ ký đầu tệp. */
export function sniffImage(b: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

@Injectable()
export class OperatorsService {
  constructor(
    private readonly db: Db,
    private readonly layouts: SeatLayoutsService,
    private readonly sms: SmsSender,
  ) {}

  /** Tạo nhà xe + chính sách mặc định (phiên bản 1) + 2 xe mặc định, trong một transaction. */
  async create(input: CreateOperatorInput): Promise<OperatorRow> {
    const data = createOperatorSchema.parse(input);
    try {
      return await this.db.tx(async (c) => {
        const { rows } = await c.query<OperatorRow>(
          'INSERT INTO operators (code, name) VALUES ($1, $2) RETURNING id, code, name',
          [data.code, data.name],
        );
        const op = rows[0]!;
        await this.insertPolicy(c, op.id, 1, DEFAULT_POLICY);
        const library = await this.layouts.ensureLibrary(c);
        for (const v of DEFAULT_VEHICLES) {
          await c.query(
            `INSERT INTO vehicles (operator_id, code, name, type, seat_layout_id) VALUES ($1, $2, $3, $4, $5)`,
            [op.id, op.code + v.suffix, v.name, v.type, library.get(v.layout)!.id],
          );
        }
        return op;
      });
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) {
        throw new DomainError('CONFLICT', `Tiền tố mã ${data.code} đã được dùng hoặc mã xe bị trùng.`, { code: data.code });
      }
      throw e;
    }
  }

  async list(): Promise<(OperatorRow & { created_at: Date })[]> {
    const { rows } = await this.db.query<OperatorRow & { created_at: Date }>(
      'SELECT id, code, name, created_at FROM operators ORDER BY code',
    );
    return rows;
  }

  async getByCode(code: string, q: Queryable = this.db): Promise<OperatorRow> {
    const { rows } = await q.query<OperatorRow>('SELECT id, code, name FROM operators WHERE code = $1', [code]);
    if (!rows[0]) throw notFound('nhà xe');
    return rows[0];
  }

  async getById(id: string, q: Queryable = this.db): Promise<OperatorRow> {
    if (!isUuid(id)) throw notFound('nhà xe');
    const { rows } = await q.query<OperatorRow>('SELECT id, code, name FROM operators WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('nhà xe');
    return rows[0];
  }

  async profile(operatorId: string) {
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    const row = (await this.db.query<{id:string;code:string;name:string;defaultDepartureTime:string;logo_updated_at:Date|null}>(
      'SELECT id,code,name,default_departure_time AS "defaultDepartureTime",logo_updated_at FROM operators WHERE id=$1', [operatorId],
    )).rows[0];
    if (!row) throw notFound('nhà xe');
    const { logo_updated_at, ...rest } = row;
    return { ...rest, logoVersion: logo_updated_at ? String(logo_updated_at.getTime()) : null };
  }

  /** Đặt logo (PNG/JPEG/WebP ≤ 200 KB). Kiểm tra chữ ký tệp thật, không tin Content-Type; không nhận SVG. */
  async setLogo(operatorId: string, data: Buffer, declaredMime: string, now: Date): Promise<string> {
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    if (data.length === 0 || data.length > LOGO_MAX_BYTES) {
      throw new DomainError('VALIDATION_FAILED', 'Logo phải là ảnh PNG, JPEG hoặc WebP, tối đa 200 KB.', { field: 'logo' });
    }
    const mime = sniffImage(data);
    if (!mime || mime !== declaredMime.split(';')[0]!.trim().toLowerCase()) {
      throw new DomainError('VALIDATION_FAILED', 'Logo phải là ảnh PNG, JPEG hoặc WebP, tối đa 200 KB.', { field: 'logo' });
    }
    const { rowCount } = await this.db.query(
      'UPDATE operators SET logo_data = $2, logo_mime = $3, logo_updated_at = $4 WHERE id = $1',
      [operatorId, data, mime, now],
    );
    if (!rowCount) throw notFound('nhà xe');
    return mime;
  }

  async removeLogo(operatorId: string): Promise<void> {
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    const { rowCount } = await this.db.query(
      'UPDATE operators SET logo_data = NULL, logo_mime = NULL, logo_updated_at = NULL WHERE id = $1',
      [operatorId],
    );
    if (!rowCount) throw notFound('nhà xe');
  }

  /** Thông tin thương hiệu công khai (tên, phiên bản logo) theo mã nhà xe. */
  async brand(code: string): Promise<{ code: string; name: string; logoVersion: string | null }> {
    const { rows } = await this.db.query<{ code: string; name: string; logo_updated_at: Date | null }>(
      'SELECT code, name, logo_updated_at FROM operators WHERE code = $1',
      [code],
    );
    if (!rows[0]) throw notFound('nhà xe');
    const r = rows[0];
    return { code: r.code, name: r.name, logoVersion: r.logo_updated_at ? String(r.logo_updated_at.getTime()) : null };
  }

  async logo(code: string): Promise<{ data: Buffer; mime: string }> {
    const { rows } = await this.db.query<{ logo_data: Buffer | null; logo_mime: string | null }>(
      'SELECT logo_data, logo_mime FROM operators WHERE code = $1',
      [code],
    );
    if (!rows[0]?.logo_data || !rows[0].logo_mime) throw notFound('logo');
    return { data: rows[0].logo_data, mime: rows[0].logo_mime };
  }

  async updateProfile(operatorId: string, input: unknown) {
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    const data = z.object({
      name: z.string().trim().min(1).max(120).refine(v => !v.includes('\0')),
      defaultDepartureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }).strict().parse(input);
    const result = await this.db.query<{ id: string; code: string; name: string; defaultDepartureTime: string }>(
      'UPDATE operators SET name=$2,default_departure_time=$3 WHERE id=$1 RETURNING id,code,name,default_departure_time AS "defaultDepartureTime"',
      [operatorId, data.name, data.defaultDepartureTime],
    );
    if (!result.rows[0]) throw notFound('nhà xe');
    return this.profile(operatorId);
  }

  /** Chính sách đang áp dụng = phiên bản mới nhất. */
  async currentPolicy(operatorId: string, q: Queryable = this.db): Promise<OperatorPolicy> {
    if (!isUuid(operatorId)) throw notFound('chính sách của nhà xe');
    const { rows } = await q.query<{
      version: number;
      hold_minutes: number;
      max_units_per_booking: number;
      child_policy: OperatorPolicy['childPolicy'];
      max_active_holds_per_phone: number;
      require_phone_otp: boolean;
      deposit_percent: number;
      deposit_single: number | null;
      deposit_double: number | null;
      payment_grace_minutes: number;
      auto_reinstate_late_payment: boolean;
    }>(
      `SELECT version, hold_minutes, max_units_per_booking, child_policy, max_active_holds_per_phone, require_phone_otp,
              deposit_percent, deposit_single, deposit_double, payment_grace_minutes, auto_reinstate_late_payment
       FROM operator_policies
       WHERE operator_id = $1 ORDER BY version DESC LIMIT 1`,
      [operatorId],
    );
    const r = rows[0];
    if (!r) throw notFound('chính sách của nhà xe');
    return {
      operatorId,
      version: r.version,
      holdMinutes: r.hold_minutes,
      maxUnitsPerBooking: r.max_units_per_booking,
      childPolicy: r.child_policy,
      maxActiveHoldsPerPhone: r.max_active_holds_per_phone,
      requirePhoneOtp: r.require_phone_otp,
      depositPercent: r.deposit_percent,
      fixedDeposit: r.deposit_single !== null && r.deposit_double !== null
        ? { single: r.deposit_single, double: r.deposit_double }
        : null,
      paymentGraceMinutes: r.payment_grace_minutes,
      autoReinstateLatePayment: r.auto_reinstate_late_payment,
    };
  }

  /** Cập nhật chính sách = thêm phiên bản mới; đơn cũ giữ bản đã chụp. */
  async updatePolicy(operatorId: string, input: z.input<typeof policyInputSchema>): Promise<OperatorPolicy> {
    const data = policyInputSchema.parse(input);
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    return this.db.tx(async (c) => {
      // NO KEY UPDATE: tuần tự hóa các lần cập nhật chính sách mà không chặn các bản ghi có FK tới nhà xe.
      const { rows } = await c.query<{ id: string }>(
        'SELECT id FROM operators WHERE id = $1 FOR NO KEY UPDATE',
        [operatorId],
      );
      if (!rows[0]) throw notFound('nhà xe');
      const current = await this.currentPolicy(operatorId, c);
      // Trường không gửi lên được giữ nguyên — không âm thầm tắt chế độ cao điểm giữa mùa Tết.
      const next: PolicyInput = {
        ...data,
        maxActiveHoldsPerPhone: data.maxActiveHoldsPerPhone ?? current.maxActiveHoldsPerPhone,
        requirePhoneOtp: data.requirePhoneOtp ?? current.requirePhoneOtp,
        depositPercent: data.depositPercent ?? current.depositPercent,
        fixedDeposit: data.fixedDeposit === undefined ? current.fixedDeposit : data.fixedDeposit,
        paymentGraceMinutes: data.paymentGraceMinutes ?? current.paymentGraceMinutes,
        autoReinstateLatePayment: data.autoReinstateLatePayment ?? current.autoReinstateLatePayment,
      };
      if (next.requirePhoneOtp && !this.sms.configured) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'Chưa cấu hình dịch vụ SMS nên chưa bật được xác thực OTP — khách sẽ không đặt được vé.',
          { field: 'requirePhoneOtp' },
        );
      }
      await this.insertPolicy(c, operatorId, current.version + 1, next);
      return this.currentPolicy(operatorId, c);
    });
  }

  private async insertPolicy(c: Queryable, operatorId: string, version: number, p: PolicyInput): Promise<void> {
    await c.query(
      `INSERT INTO operator_policies (operator_id, version, hold_minutes, max_units_per_booking, child_policy,
                                      max_active_holds_per_phone, require_phone_otp, deposit_percent,
                                      payment_grace_minutes, auto_reinstate_late_payment, deposit_single, deposit_double)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [operatorId, version, p.holdMinutes, p.maxUnitsPerBooking, JSON.stringify(p.childPolicy),
        p.maxActiveHoldsPerPhone, p.requirePhoneOtp, p.depositPercent,
        p.paymentGraceMinutes, p.autoReinstateLatePayment, p.fixedDeposit?.single ?? null, p.fixedDeposit?.double ?? null],
    );
  }
}
