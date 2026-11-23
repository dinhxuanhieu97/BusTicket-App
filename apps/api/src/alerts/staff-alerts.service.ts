import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SecretBox } from '../auth/totp';
import { Clock } from '../common/clock';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { Db, Queryable } from '../db/db';
import { MailMessage, MailSender, SmtpConfig } from './mail-sender';

/** Loại sự kiện báo nhà xe trong `outbox_events` (worker chỉ đọc tiền tố `staff.`). */
export type StaffAlertType = 'staff.booking_held' | 'staff.payment_proof';

/** Gửi lỗi thì thử lại sau 1, 2, 4, 8 phút; quá số lần thì bỏ và ghi lỗi để chủ xe thấy trong Cài đặt. */
export const ALERT_MAX_ATTEMPTS = 5;
/** Sự kiện cũ hơn mức này (worker dừng lâu, vừa bật lại) thì bỏ, tránh dội hàng loạt thư cũ. */
export const ALERT_STALE_MS = 6 * 3600_000;
/** Thời gian "giữ" một sự kiện đang gửi; instance khác không lấy trùng trong lúc đó. */
const ALERT_LEASE_MS = 5 * 60_000;
const ALERT_BATCH = 20;
/** Danh sách đơn có ảnh chờ kiểm trên chuông. */
export const PENDING_PROOFS_LIMIT = 50;

/** Tên máy chủ SMTP: tên miền công khai, không nhận IP hay tên nội bộ (SSRF). */
const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const INTERNAL_SUFFIX = /\.(local|localhost|internal|lan|home|corp|intranet)$/;

const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Email không hợp lệ.'));

export const alertSettingsSchema = z.object({
  enabled: z.boolean(),
  smtpHost: z.string().trim().toLowerCase()
    .refine((h) => HOST.test(h) && !INTERNAL_SUFFIX.test(h), 'Tên máy chủ SMTP không hợp lệ (vd. smtp.gmail.com).'),
  smtpPort: z.union([z.literal(465), z.literal(587)]),
  smtpUser: email,
  /** Bỏ trống = giữ mật khẩu đã lưu. */
  smtpPassword: z.string().max(200).refine((v) => !v.includes('\0')).optional(),
  fromName: z.string().trim().max(80).refine((v) => !/[\r\n\0]/.test(v)).nullable().optional(),
  recipients: z.array(email).min(1, 'Cần ít nhất một email nhận.').max(5, 'Tối đa 5 email nhận.')
    .refine((l) => new Set(l).size === l.length, 'Email nhận bị trùng.'),
  onBookingHeld: z.boolean(),
  onPaymentProof: z.boolean(),
}).strict();

export interface AlertSettingsView {
  configured: boolean;
  enabled: boolean;
  smtpHost: string;
  smtpPort: 465 | 587;
  smtpUser: string;
  fromName: string | null;
  recipients: string[];
  onBookingHeld: boolean;
  onPaymentProof: boolean;
  /** Mật khẩu không bao giờ trả về; chỉ cho biết đã lưu chưa. */
  passwordSet: boolean;
  lastSentAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

interface SettingsRow {
  enabled: boolean; smtp_host: string; smtp_port: 465 | 587; smtp_user: string; smtp_password_enc: string; from_name: string | null;
  recipients: string[]; on_booking_held: boolean; on_payment_proof: boolean; last_sent_at: Date | null; last_error: string | null;
  last_error_at: Date | null;
}

/**
 * Ghi sự kiện báo nhà xe trong cùng transaction với nghiệp vụ; chỉ ghi khi nhà xe đã bật loại báo này,
 * nên tắt báo không để dồn hàng đợi. Trùng `dedupeKey` thì bỏ qua.
 */
export async function enqueueStaffAlert(
  q: Queryable, operatorId: string, type: StaffAlertType, bookingId: string, dedupeKey: string, now: Date, payload: object = {},
): Promise<void> {
  const flag = type === 'staff.booking_held' ? 'on_booking_held' : 'on_payment_proof';
  await q.query(
    `INSERT INTO outbox_events (operator_id, type, aggregate_id, payload, dedupe_key, created_at)
     SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (
       SELECT 1 FROM operator_alert_settings WHERE operator_id = $1 AND enabled AND ${flag})
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [operatorId, type, bookingId, JSON.stringify(payload), dedupeKey, now],
  );
}

/** `0912345678` hoặc `+84912345678` → `0912***678`: thư đi qua hộp mail bên ngoài nên không ghi đủ số khách. */
export function maskPhone(phone: string): string {
  const local = phone.startsWith('+84') ? `0${phone.slice(3)}` : phone;
  return local.length >= 7 ? `${local.slice(0, 4)}***${local.slice(-3)}` : '***';
}

const vnd = (n: number) => `${n.toLocaleString('vi-VN')} đ`;
/** Giờ VN (UTC+7, không đổi giờ mùa hè) dạng `HH:mm dd/MM/yyyy`. */
export function vnDateTime(d: Date): string {
  const v = new Date(d.getTime() + 7 * 3600_000).toISOString();
  return `${v.slice(11, 16)} ${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
}
const vnDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

export interface AlertBooking {
  operatorCode: string;
  code: string;
  status: string;
  contactName: string | null;
  contactPhone: string | null;
  tripId: string;
  tripName: string;
  departAt: Date;
  seats: string[];
  totalAmount: number;
  depositAmount: number;
  paidAmount: number;
  releaseAt: Date | null;
  proofCount: number;
}

/** Nội dung thư; `dashboardUrl` trống thì không kèm link. */
export function alertMessage(type: StaffAlertType, b: AlertBooking, dashboardUrl: string | null): Omit<MailMessage, 'to'> {
  const link = dashboardUrl
    ? `${dashboardUrl.replace(/\/+$/, '')}/admin/passengers?${new URLSearchParams({ date: vnDate(b.departAt), trip: b.tripId, booking: b.code })}`
    : null;
  const who = b.contactName === null ? 'Đã xóa thông tin liên hệ' : `${b.contactName} · ${maskPhone(b.contactPhone ?? '')}`;
  const lines = [
    `Mã vé: ${b.code}`,
    `Khách: ${who}`,
    `Chuyến: ${b.tripName}`,
    `Khởi hành: ${vnDateTime(b.departAt)}`,
    `Chỗ: ${b.seats.join(', ') || '—'}`,
    `Tiền: đã thu ${vnd(b.paidAmount)} / ${vnd(b.totalAmount)} (cọc ${vnd(b.depositAmount)})`,
  ];
  if (b.status === 'HOLDING' && b.releaseAt) lines.push(`Giữ chỗ đến: ${vnDateTime(b.releaseAt)}`);
  else lines.push(`Trạng thái hiện tại: ${b.status}`);
  const head = type === 'staff.payment_proof'
    ? `Khách vừa gửi ảnh chuyển khoản (${b.proofCount} ảnh). Vui lòng kiểm tra tiền về rồi ghi nhận thanh toán trong Dashboard.`
    : 'Có đơn đặt vé mới từ Mini App.';
  const subject = type === 'staff.payment_proof'
    ? `[${b.operatorCode}] Khách gửi ảnh chuyển khoản — vé ${b.code}`
    : `[${b.operatorCode}] Đơn mới ${b.code} — ${b.seats.length} chỗ, ${vnDateTime(b.departAt)}`;
  const text = [head, '', ...lines, ...(link ? ['', `Mở trong Dashboard: ${link}`] : []), '', '— PNTicket (thư tự động, không trả lời thư này)'].join('\n');
  return { subject, text };
}

/** Cấu hình worker: chu kỳ (0 = tắt, mặc định trong test) và địa chỉ Dashboard để gắn link vào thư. */
export class StaffAlertConfig {
  readonly intervalMs: number;
  readonly dashboardUrl: string | null;
  constructor(intervalMs: number, dashboardUrl?: string | null) {
    this.intervalMs = Number.isFinite(intervalMs) && intervalMs >= 1000 ? intervalMs : 0;
    this.dashboardUrl = dashboardUrl && /^https?:\/\/[^\s]+$/.test(dashboardUrl) ? dashboardUrl : null;
  }
}

/** Cấu hình báo email của nhà xe, danh sách ảnh chờ kiểm và worker gửi thư từ outbox. */
@Injectable()
export class StaffAlertsService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly box: SecretBox,
    private readonly mailer: MailSender,
    private readonly config: StaffAlertConfig,
  ) {}

  async settings(operatorId: string): Promise<AlertSettingsView> {
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    const row = await this.row(this.db, operatorId);
    if (!row) {
      return {
        configured: false, enabled: false, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpUser: '', fromName: null, recipients: [],
        onBookingHeld: false, onPaymentProof: true, passwordSet: false, lastSentAt: null, lastError: null, lastErrorAt: null,
      };
    }
    return view(row);
  }

  /** Lưu cấu hình. Đổi máy chủ/tài khoản mà không nhập lại mật khẩu thì từ chối (mật khẩu cũ thuộc tài khoản cũ). */
  async saveSettings(operatorId: string, input: unknown, inTx?: (q: Queryable, v: AlertSettingsView) => Promise<void>) {
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    const d = alertSettingsSchema.parse(input);
    const password = d.smtpPassword && d.smtpHost === 'smtp.gmail.com' ? d.smtpPassword.replace(/\s+/g, '') : d.smtpPassword;
    return this.db.tx(async (c) => {
      const { rows: ops } = await c.query('SELECT id FROM operators WHERE id = $1 FOR UPDATE', [operatorId]);
      if (!ops[0]) throw notFound('nhà xe');
      const old = await this.row(c, operatorId);
      const sameAccount = old && old.smtp_host === d.smtpHost && old.smtp_user === d.smtpUser;
      if (!password && !sameAccount) {
        throw new DomainError('VALIDATION_FAILED', 'Nhập mật khẩu ứng dụng của tài khoản gửi mail.', { field: 'smtpPassword' });
      }
      const enc = password ? this.box.seal(password) : old!.smtp_password_enc;
      // Đổi tài khoản/mật khẩu thì lỗi cũ không còn đúng nữa.
      const resetError = !!password || !sameAccount;
      await c.query(
        `INSERT INTO operator_alert_settings (operator_id, enabled, smtp_host, smtp_port, smtp_user, smtp_password_enc, from_name,
           recipients, on_booking_held, on_payment_proof, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (operator_id) DO UPDATE SET enabled = EXCLUDED.enabled, smtp_host = EXCLUDED.smtp_host,
           smtp_port = EXCLUDED.smtp_port, smtp_user = EXCLUDED.smtp_user, smtp_password_enc = EXCLUDED.smtp_password_enc,
           from_name = EXCLUDED.from_name, recipients = EXCLUDED.recipients, on_booking_held = EXCLUDED.on_booking_held,
           on_payment_proof = EXCLUDED.on_payment_proof, updated_at = EXCLUDED.updated_at,
           last_error = CASE WHEN $12 THEN NULL ELSE operator_alert_settings.last_error END,
           last_error_at = CASE WHEN $12 THEN NULL ELSE operator_alert_settings.last_error_at END`,
        [operatorId, d.enabled, d.smtpHost, d.smtpPort, d.smtpUser, enc, d.fromName || null, d.recipients, d.onBookingHeld,
          d.onPaymentProof, this.clock.now(), resetError],
      );
      const saved = view((await this.row(c, operatorId))!);
      if (inTx) await inTx(c, saved);
      return saved;
    });
  }

  /** Gửi thư thử tới danh sách nhận bằng cấu hình đã lưu (kể cả khi đang tắt báo). */
  async sendTest(operatorId: string): Promise<{ sentTo: string[] }> {
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    const row = await this.row(this.db, operatorId);
    if (!row) throw new DomainError('CONFLICT', 'Lưu cấu hình email trước khi gửi thử.');
    const { rows: op } = await this.db.query<{ code: string; name: string }>('SELECT code, name FROM operators WHERE id = $1', [operatorId]);
    try {
      await this.mailer.send(this.smtp(row), {
        to: row.recipients,
        subject: `[${op[0]!.code}] Thư thử từ PNTicket`,
        text: `Cấu hình gửi email của ${op[0]!.name} hoạt động. Từ nay nhà xe sẽ nhận thư khi khách đặt vé hoặc gửi ảnh chuyển khoản (theo lựa chọn trong Cài đặt).\n\n— PNTicket`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Gửi email thất bại.';
      await this.markResult(operatorId, message);
      throw new DomainError('SERVICE_UNAVAILABLE', message);
    }
    await this.markResult(operatorId, null);
    return { sentTo: row.recipients };
  }

  /** Đơn khách đã báo chuyển khoản, còn giữ chỗ (chưa ghi nhận đủ tiền): mới gửi ảnh trước. */
  async pendingProofs(operatorId: string) {
    if (!isUuid(operatorId)) return { total: 0, bookings: [] };
    const now = this.clock.now();
    const where = `b.operator_id = $1 AND b.status = 'HOLDING' AND b.transfer_claimed_at IS NOT NULL AND b.release_at > $2`;
    const [count, list] = await Promise.all([
      this.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM bookings b WHERE ${where}`, [operatorId, now]),
      this.db.query<{
        code: string; contact_name: string | null; contact_phone: string | null; trip_id: string; trip_name: string; depart_at: Date;
        total_amount: number; paid_amount: number; release_at: Date; proof_count: number; last_proof_at: Date | null;
      }>(
        `SELECT b.code, CASE WHEN b.contact_erased_at IS NULL THEN b.contact_name END AS contact_name,
           CASE WHEN b.contact_erased_at IS NULL THEN b.contact_phone END AS contact_phone,
           t.id AS trip_id, t.name AS trip_name, t.depart_at, b.total_amount, b.paid_amount, b.release_at,
           p.n AS proof_count, p.last_at AS last_proof_at
         FROM bookings b JOIN trips t ON t.id = b.trip_id
         CROSS JOIN LATERAL (SELECT COUNT(*)::int AS n, max(created_at) AS last_at FROM booking_payment_proofs WHERE booking_id = b.id) p
         WHERE ${where}
         ORDER BY COALESCE(p.last_at, b.transfer_claimed_at) DESC, b.id LIMIT ${PENDING_PROOFS_LIMIT}`,
        [operatorId, now],
      ),
    ]);
    return {
      total: count.rows[0]!.n,
      bookings: list.rows.map((r) => ({
        code: r.code, contactName: r.contact_name, contactPhone: r.contact_phone,
        trip: { id: r.trip_id, name: r.trip_name, departAt: r.depart_at.toISOString() },
        totalAmount: r.total_amount, paidAmount: r.paid_amount, releaseAt: r.release_at.toISOString(),
        proofCount: r.proof_count, lastProofAt: r.last_proof_at?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Một lượt gửi: nhận tối đa ALERT_BATCH sự kiện `staff.*` đến hạn (SKIP LOCKED + hạn giữ, chạy nhiều instance vẫn
   * không gửi trùng), gửi ngoài transaction, rồi ghi kết quả. Trả số thư đã gửi.
   */
  async dispatchDue(): Promise<number> {
    const now = this.clock.now();
    const { rows: due } = await this.db.query<{ id: string; operator_id: string; type: StaffAlertType; aggregate_id: string; attempts: number; created_at: Date }>(
      `UPDATE outbox_events SET attempts = attempts + 1, next_attempt_at = $2
       WHERE id IN (
         SELECT id FROM outbox_events
         WHERE processed_at IS NULL AND type LIKE 'staff.%' AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
         ORDER BY created_at, id LIMIT ${ALERT_BATCH} FOR UPDATE SKIP LOCKED)
       RETURNING id, operator_id, type, aggregate_id, attempts, created_at`,
      [now, new Date(now.getTime() + ALERT_LEASE_MS)],
    );
    let sent = 0;
    for (const e of due) {
      const settings = await this.row(this.db, e.operator_id);
      const wanted = settings?.enabled && (e.type === 'staff.payment_proof' ? settings.on_payment_proof : settings.on_booking_held);
      if (!wanted) { await this.finish(e.id, 'Đã tắt báo email.'); continue; }
      if (now.getTime() - e.created_at.getTime() > ALERT_STALE_MS) { await this.finish(e.id, 'Bỏ qua: sự kiện quá cũ.'); continue; }
      const booking = await this.alertBooking(e.aggregate_id);
      if (!booking) { await this.finish(e.id, 'Bỏ qua: không còn đơn.'); continue; }
      try {
        await this.mailer.send(this.smtp(settings), { to: settings.recipients, ...alertMessage(e.type, booking, this.config.dashboardUrl) });
        await this.finish(e.id, null);
        await this.markResult(e.operator_id, null);
        sent++;
      } catch (err) {
        const message = (err instanceof Error ? err.message : 'Gửi email thất bại.').slice(0, 300);
        if (e.attempts >= ALERT_MAX_ATTEMPTS) await this.finish(e.id, message);
        else {
          await this.db.query('UPDATE outbox_events SET next_attempt_at = $2, last_error = $3 WHERE id = $1',
            [e.id, new Date(now.getTime() + 2 ** (e.attempts - 1) * 60_000), message]);
        }
        await this.markResult(e.operator_id, message);
      }
    }
    return sent;
  }

  private async alertBooking(bookingId: string): Promise<AlertBooking | null> {
    const { rows } = await this.db.query<{
      operator_code: string; code: string; status: string; contact_name: string | null; contact_phone: string | null; trip_id: string;
      trip_name: string; depart_at: Date; seats: string[] | null; total_amount: number; deposit_amount: number; paid_amount: number;
      release_at: Date | null; proof_count: number;
    }>(
      `SELECT o.code AS operator_code, b.code, b.status,
         CASE WHEN b.contact_erased_at IS NULL THEN b.contact_name END AS contact_name,
         CASE WHEN b.contact_erased_at IS NULL THEN b.contact_phone END AS contact_phone,
         t.id AS trip_id, t.name AS trip_name, t.depart_at,
         (SELECT array_agg(seat_code ORDER BY seat_code) FROM booking_items WHERE booking_id = b.id AND trip_id = b.trip_id) AS seats,
         b.total_amount, b.deposit_amount, b.paid_amount, b.release_at,
         (SELECT COUNT(*)::int FROM booking_payment_proofs WHERE booking_id = b.id) AS proof_count
       FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN operators o ON o.id = b.operator_id WHERE b.id = $1`,
      [bookingId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      operatorCode: r.operator_code, code: r.code, status: r.status, contactName: r.contact_name, contactPhone: r.contact_phone,
      tripId: r.trip_id, tripName: r.trip_name, departAt: r.depart_at, seats: r.seats ?? [], totalAmount: r.total_amount,
      depositAmount: r.deposit_amount, paidAmount: r.paid_amount, releaseAt: r.release_at, proofCount: r.proof_count,
    };
  }

  private finish(id: string, note: string | null) {
    return this.db.query('UPDATE outbox_events SET processed_at = $2, next_attempt_at = NULL, last_error = $3 WHERE id = $1',
      [id, this.clock.now(), note]);
  }

  private markResult(operatorId: string, error: string | null) {
    return error
      ? this.db.query('UPDATE operator_alert_settings SET last_error = $2, last_error_at = $3 WHERE operator_id = $1',
        [operatorId, error, this.clock.now()])
      : this.db.query('UPDATE operator_alert_settings SET last_sent_at = $2, last_error = NULL, last_error_at = NULL WHERE operator_id = $1',
        [operatorId, this.clock.now()]);
  }

  private smtp(row: SettingsRow): SmtpConfig {
    return { host: row.smtp_host, port: row.smtp_port, user: row.smtp_user, password: this.box.open(row.smtp_password_enc), fromName: row.from_name };
  }

  private async row(q: Queryable, operatorId: string): Promise<SettingsRow | undefined> {
    const { rows } = await q.query<SettingsRow>(
      `SELECT enabled, smtp_host, smtp_port, smtp_user, smtp_password_enc, from_name, recipients, on_booking_held, on_payment_proof,
         last_sent_at, last_error, last_error_at FROM operator_alert_settings WHERE operator_id = $1`,
      [operatorId],
    );
    return rows[0];
  }
}

const view = (r: SettingsRow): AlertSettingsView => ({
  configured: true, enabled: r.enabled, smtpHost: r.smtp_host, smtpPort: r.smtp_port, smtpUser: r.smtp_user, fromName: r.from_name,
  recipients: r.recipients, onBookingHeld: r.on_booking_held, onPaymentProof: r.on_payment_proof, passwordSet: true,
  lastSentAt: r.last_sent_at?.toISOString() ?? null, lastError: r.last_error, lastErrorAt: r.last_error_at?.toISOString() ?? null,
});
