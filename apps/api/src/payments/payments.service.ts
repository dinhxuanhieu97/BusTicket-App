import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.service';
import { SecretBox } from '../auth/totp';
import { TokenSecret } from '../bookings/token-secret';
import { Clock } from '../common/clock';
import { verifyBookingAccessToken } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { Db, isPgError, PG_UNIQUE_VIOLATION, Queryable } from '../db/db';
import {
  BankTransfer, extractBookingCodes, hashWebhookKey, parseSepayWebhook, SepayTransactionsClient, sepayQrUrl, verifyApiKeyHeader,
} from './sepay';

export const configureAccountSchema = z
  .object({
    bankCode: z.string().regex(/^[A-Za-z0-9]{2,20}$/),
    accountNumber: z.string().regex(/^[0-9A-Za-z]{4,30}$/),
    accountName: z.string().trim().min(1).max(120),
    /** API Key đặt trong cấu hình webhook SePay (chọn xác thực "API Key"). */
    webhookApiKey: z.string().min(24, 'API Key webhook tối thiểu 24 ký tự').max(200),
    /** Token API SePay để đối soát định kỳ (tùy chọn). */
    apiToken: z.string().min(10).max(500).optional(),
  })
  .strict();

export const manualPaymentSchema = z
  .object({
    bookingCode: z.string().regex(/^[A-Z0-9]{4,12}$/),
    amount: z.number().int().min(1).max(2_000_000_000),
    method: z.enum(['MANUAL_BANK', 'CASH']),
    /** Mã giao dịch ngân hàng nhìn thấy trong app (bắt buộc với MANUAL_BANK). */
    bankReference: z.string().trim().min(3).max(100).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.method !== 'MANUAL_BANK' || !!v.bankReference, {
    message: 'Chuyển khoản xác nhận thủ công cần mã giao dịch ngân hàng',
    path: ['bankReference'],
  });

export const allocateSchema = z
  .object({ bookingCode: z.string().regex(/^[A-Z0-9]{4,12}$/), amount: z.number().int().min(1).optional(), note: z.string().max(500).optional() })
  .strict();

export const resolveSchema = z.object({ note: z.string().trim().min(3).max(500) }).strict();

type ReviewReason = 'UNMATCHED' | 'AMBIGUOUS' | 'LATE' | 'OVERPAID' | 'BOOKING_CLOSED';

interface PaymentRow {
  id: string;
  operator_id: string;
  method: string;
  amount: number;
  allocated_amount: number;
  content: string | null;
  transaction_at: Date;
  review_status: string;
  review_reason: string | null;
  matched_booking_id: string | null;
  idempotency_key: string | null;
  request_hash: string | null;
}

interface LockedBooking {
  id: string;
  code: string;
  operator_id: string;
  trip_id: string;
  status: string;
  hold_expires_at: Date | null;
  total_amount: number;
  deposit_amount: number;
  paid_amount: number;
}

export interface IngestResult {
  status: 'PROCESSED' | 'DUPLICATE' | 'IGNORED';
  paymentId?: string;
}

/**
 * Sổ thu: ghi nhận tiền vào (SePay webhook, đối soát, nhân viên), phân bổ vào đơn, xác nhận vé.
 * Quy tắc (PNTicketDocs mục 6): mỗi giao dịch ngân hàng ghi nhận đúng một lần; không phân bổ vượt
 * số tiền thực nhận hoặc vượt giá trị đơn; tiền đến khi đơn đã hết hạn/đã bán lại chỗ → cần kiểm tra,
 * không tự cấp lại chỗ; mọi thứ trong một transaction cùng với nhật ký và outbox.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly box: SecretBox,
    private readonly tokenSecret: TokenSecret,
    private readonly sepay: SepayTransactionsClient,
  ) {}

  // ---- Cấu hình tài khoản nhận tiền ------------------------------------------------------------

  async configureAccount(actor: AuthUser, operatorId: string, input: z.input<typeof configureAccountSchema>) {
    const data = configureAccountSchema.parse(input);
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    try {
      return await this.db.tx(async (c) => {
        const { rows: ops } = await c.query('SELECT id FROM operators WHERE id = $1 FOR NO KEY UPDATE', [operatorId]);
        if (!ops[0]) throw notFound('nhà xe');
        await c.query(
          'UPDATE operator_payment_accounts SET active = false, updated_at = $2 WHERE operator_id = $1 AND active',
          [operatorId, this.clock.now()],
        );
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO operator_payment_accounts
             (operator_id, provider, bank_code, account_number, account_name, webhook_key_hash, api_token_enc)
           VALUES ($1, 'SEPAY', $2, $3, $4, $5, $6)
           ON CONFLICT (provider, account_number) DO UPDATE SET
             bank_code = EXCLUDED.bank_code, account_name = EXCLUDED.account_name,
             webhook_key_hash = EXCLUDED.webhook_key_hash, api_token_enc = EXCLUDED.api_token_enc,
             active = true, updated_at = now()
           WHERE operator_payment_accounts.operator_id = EXCLUDED.operator_id
           RETURNING id`,
          [operatorId, data.bankCode.toUpperCase(), data.accountNumber, data.accountName,
            hashWebhookKey(data.webhookApiKey), data.apiToken ? this.box.seal(data.apiToken) : null],
        );
        if (!rows[0]) throw new DomainError('CONFLICT', 'Số tài khoản này đã được nhà xe khác dùng.');
        await this.audit.record(
          { operatorId, actorUserId: actor.id, action: 'payment_account.configure', entity: 'payment_account', entityId: rows[0].id,
            data: { bankCode: data.bankCode.toUpperCase(), accountNumber: data.accountNumber, reconcile: !!data.apiToken } },
          c,
        );
        return this.publicAccount(c, operatorId);
      });
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new DomainError('CONFLICT', 'Số tài khoản này đã được nhà xe khác dùng.');
      throw e;
    }
  }

  async getAccount(operatorId: string) {
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    return this.publicAccount(this.db, operatorId);
  }

  private async publicAccount(q: Queryable, operatorId: string) {
    const { rows } = await q.query<{ bank_code: string; account_number: string; account_name: string; reconcile: boolean }>(
      `SELECT bank_code, account_number, account_name, api_token_enc IS NOT NULL AS reconcile
       FROM operator_payment_accounts WHERE operator_id = $1 AND active`,
      [operatorId],
    );
    const a = rows[0];
    return a
      ? { provider: 'SEPAY', bankCode: a.bank_code, accountNumber: a.account_number, accountName: a.account_name, reconcileEnabled: a.reconcile }
      : null;
  }

  // ---- Hướng dẫn thanh toán cho khách --------------------------------------------------------------

  /** QR + thông tin chuyển khoản cho đơn (khách xác minh bằng token truy cập đơn). Không lộ dữ liệu khác. */
  async paymentInstructions(code: string, accessToken: string) {
    const { rows } = await this.db.query<{
      id: string; operator_id: string; status: string; hold_expires_at: Date | null; total_amount: number;
      deposit_amount: number; paid_amount: number; access_token_version: number;
    }>(
      `SELECT id, operator_id, status, hold_expires_at, total_amount, deposit_amount, paid_amount, access_token_version
       FROM bookings WHERE code = $1`,
      [code],
    );
    const b = rows[0];
    if (!b || !verifyBookingAccessToken(this.tokenSecret.value, b.id, b.access_token_version, accessToken)) throw notFound('đơn');
    const now = this.clock.now();
    const holding = b.status === 'HOLDING' && b.hold_expires_at !== null && b.hold_expires_at > now;
    const due = holding ? b.deposit_amount - b.paid_amount : b.status === 'CONFIRMED' ? b.total_amount - b.paid_amount : 0;
    if (due <= 0) {
      return { code, payable: false, reason: holding || b.status === 'CONFIRMED' ? 'PAID' : 'NOT_PAYABLE', amountDue: 0 };
    }
    const account = await this.publicAccount(this.db, b.operator_id);
    if (!account) throw new DomainError('SERVICE_UNAVAILABLE', 'Nhà xe chưa cấu hình tài khoản nhận tiền.');
    return {
      code,
      payable: true,
      amountDue: due,
      transferContent: code,
      holdExpiresAt: holding ? b.hold_expires_at!.toISOString() : null,
      bank: { code: account.bankCode, accountNumber: account.accountNumber, accountName: account.accountName },
      qrImageUrl: sepayQrUrl(account.bankCode, account.accountNumber, due, code),
    };
  }

  // ---- Nhận tiền từ SePay ----------------------------------------------------------------------------

  /** Webhook SePay: xác thực API Key của đúng tài khoản nhận tiền, rồi ghi nhận. */
  async handleSepayWebhook(authorization: string | undefined, body: unknown): Promise<IngestResult> {
    const transfer = parseSepayWebhook(body);
    const { rows } = await this.db.query<{ webhook_key_hash: string }>(
      `SELECT webhook_key_hash FROM operator_payment_accounts WHERE provider = 'SEPAY' AND account_number = $1`,
      [transfer.accountNumber],
    );
    // Không phân biệt "sai khóa" với "tài khoản không có" trong phản hồi.
    if (!rows[0] || !verifyApiKeyHeader(authorization, rows[0].webhook_key_hash)) {
      throw new DomainError('UNAUTHENTICATED', 'Webhook không hợp lệ.');
    }
    return this.ingest(transfer, 'WEBHOOK', body);
  }

  /**
   * Đối soát định kỳ: lấy giao dịch tiền vào từ API SePay trong `lookbackHours` vừa qua và ghi nhận
   * những giao dịch webhook chưa gửi tới (chống trùng theo mã giao dịch).
   */
  async reconcile(operatorId: string, lookbackHours = 72): Promise<{ fetched: number; processed: number; duplicates: number }> {
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    const { rows } = await this.db.query<{ account_number: string; api_token_enc: string | null }>(
      `SELECT account_number, api_token_enc FROM operator_payment_accounts WHERE operator_id = $1 AND active`,
      [operatorId],
    );
    const acc = rows[0];
    if (!acc?.api_token_enc) throw new DomainError('VALIDATION_FAILED', 'Chưa cấu hình token API SePay để đối soát.');
    const since = new Date(this.clock.now().getTime() - lookbackHours * 3600_000);
    const list = await this.sepay.listIncoming(this.box.open(acc.api_token_enc), acc.account_number, since);
    let processed = 0;
    let duplicates = 0;
    for (const t of list) {
      if (t.accountNumber !== acc.account_number) continue;
      const r = await this.ingest(t, 'RECONCILE', t);
      if (r.status === 'PROCESSED') processed++;
      if (r.status === 'DUPLICATE') duplicates++;
    }
    return { fetched: list.length, processed, duplicates };
  }

  /** Ghi sự kiện + khoản thu + phân bổ trong một transaction. Gửi lặp → DUPLICATE, không cộng tiền lần hai. */
  private async ingest(t: BankTransfer, source: 'WEBHOOK' | 'RECONCILE', payload: unknown): Promise<IngestResult> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const { rows: acc } = await c.query<{ operator_id: string; code: string }>(
        `SELECT a.operator_id, o.code FROM operator_payment_accounts a JOIN operators o ON o.id = a.operator_id
         WHERE a.provider = 'SEPAY' AND a.account_number = $1`,
        [t.accountNumber],
      );
      const account = acc[0];
      if (!account) throw new DomainError('UNAUTHENTICATED', 'Webhook không hợp lệ.');
      const ev = await c.query(
        `INSERT INTO provider_events (provider, account_number, provider_txn_id, payload, source, received_at)
         VALUES ('SEPAY', $1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
        [t.accountNumber, t.providerTxnId, JSON.stringify(payload), source, now],
      );
      if (ev.rowCount === 0) return { status: 'DUPLICATE' };
      if (t.direction !== 'in' || t.amount <= 0) return { status: 'IGNORED' };

      // Giờ giao dịch do ngân hàng báo; không tin giờ ở tương lai.
      const paidAt = t.transactionAt > now ? now : t.transactionAt;
      const { rows: pay } = await c.query<PaymentRow>(
        `INSERT INTO payments (operator_id, method, provider, provider_txn_id, account_number, amount, content,
                               reference_code, transaction_at, received_at)
         VALUES ($1, 'BANK_TRANSFER', 'SEPAY', $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [account.operator_id, t.providerTxnId, t.accountNumber, t.amount, t.content, t.referenceCode, paidAt, now],
      );
      const payment = pay[0]!;
      await this.outbox(c, account.operator_id, 'payment.received', payment.id, `payment.received:${payment.id}`, { amount: t.amount });

      const codes = extractBookingCodes(t.content, account.code, t.code);
      if (codes.length === 0) {
        await this.flag(c, payment.id, 'UNMATCHED');
        return { status: 'PROCESSED', paymentId: payment.id };
      }
      const { rows: found } = await c.query<{ id: string }>(
        'SELECT id FROM bookings WHERE operator_id = $1 AND code = ANY($2::text[])',
        [account.operator_id, codes],
      );
      if (found.length !== 1) {
        await this.flag(c, payment.id, found.length === 0 ? 'UNMATCHED' : 'AMBIGUOUS');
        return { status: 'PROCESSED', paymentId: payment.id };
      }
      await c.query('UPDATE payments SET matched_booking_id = $2 WHERE id = $1', [payment.id, found[0]!.id]);
      await this.applyToBooking(c, payment, found[0]!.id, paidAt, null, true);
      return { status: 'PROCESSED', paymentId: payment.id };
    });
  }

  // ---- Nhân viên ghi nhận / phân bổ / xử lý ngoại lệ --------------------------------------------------

  /**
   * Ghi nhận tiền mặt hoặc chuyển khoản thấy trong app ngân hàng (mức 0) cho một đơn.
   * Bắt buộc Idempotency-Key: bấm hai lần chỉ ghi một lần (AC-13).
   */
  async recordManual(actor: AuthUser, operatorId: string, input: z.input<typeof manualPaymentSchema>, idempotencyKey: string) {
    const data = manualPaymentSchema.parse(input);
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    // Bán vé chỉ ghi nhận tiền mặt thu tại quầy; xác nhận chuyển khoản thủ công là việc của kế toán/chủ xe.
    if (data.method !== 'CASH' && actor.role !== 'OWNER' && actor.role !== 'ACCOUNTANT') {
      throw new DomainError('FORBIDDEN', 'Chỉ kế toán hoặc chủ xe được xác nhận chuyển khoản thủ công.');
    }
    const key = idempotencyKey.trim();
    if (!/^[\w-]{8,100}$/.test(key)) throw new DomainError('VALIDATION_FAILED', 'Idempotency-Key phải dài 8–100 ký tự.');
    const requestHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const now = this.clock.now();
    try {
      return await this.db.tx(async (c) => {
        const existing = await this.findByIdempotency(c, operatorId, key);
        if (existing) return this.replayManual(c, existing, requestHash);
        const { rows: bk } = await c.query<{ id: string }>('SELECT id FROM bookings WHERE operator_id = $1 AND code = $2', [
          operatorId, data.bookingCode,
        ]);
        if (!bk[0]) throw notFound('đơn');
        const { rows } = await c.query<PaymentRow>(
          `INSERT INTO payments (operator_id, method, amount, content, reference_code, transaction_at, received_at,
                                 matched_booking_id, recorded_by, idempotency_key, request_hash, review_note)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [operatorId, data.method, data.amount, data.bookingCode, data.bankReference ?? null, now,
            bk[0].id, actor.id, key, requestHash, data.note ?? null],
        );
        const payment = rows[0]!;
        await this.outbox(c, operatorId, 'payment.received', payment.id, `payment.received:${payment.id}`, { amount: data.amount });
        await this.applyToBooking(c, payment, bk[0].id, now, actor.id, true);
        await this.audit.record(
          { operatorId, actorUserId: actor.id, action: 'payment.record_manual', entity: 'payment', entityId: payment.id,
            data: { bookingCode: data.bookingCode, amount: data.amount, method: data.method, bankReference: data.bankReference ?? null } },
          c,
        );
        return this.paymentView(c, payment.id);
      });
    } catch (e) {
      // Hai yêu cầu cùng khóa chạy song song: ràng buộc duy nhất chặn bản thứ hai → trả bản đã ghi.
      if (isPgError(e, PG_UNIQUE_VIOLATION) && e.constraint === 'payments_operator_id_idempotency_key_key') {
        const existing = await this.findByIdempotency(this.db, operatorId, key);
        if (existing) return this.replayManual(this.db, existing, requestHash);
      }
      throw e;
    }
  }

  /** Phân bổ phần tiền chưa phân bổ của một khoản thu vào một đơn (đơn đang giữ chỗ hợp lệ hoặc đã xác nhận). */
  async allocate(actor: AuthUser, operatorId: string, paymentId: string, input: z.input<typeof allocateSchema>) {
    const data = allocateSchema.parse(input);
    if (!isUuid(operatorId) || !isUuid(paymentId)) throw notFound('khoản thu');
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const { rows: bk } = await c.query<{ id: string; trip_id: string }>(
        'SELECT id, trip_id FROM bookings WHERE operator_id = $1 AND code = $2',
        [operatorId, data.bookingCode],
      );
      if (!bk[0]) throw notFound('đơn');
      // Thứ tự khóa giống luồng giữ chỗ: chuyến → đơn → khoản thu.
      await c.query('SELECT id FROM trips WHERE id = $1 FOR NO KEY UPDATE', [bk[0].trip_id]);
      const { rows } = await c.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 AND operator_id = $2 FOR UPDATE', [
        paymentId, operatorId,
      ]);
      const payment = rows[0];
      if (!payment) throw notFound('khoản thu');
      const available = payment.amount - payment.allocated_amount;
      if (available <= 0) throw new DomainError('CONFLICT', 'Khoản thu này đã được phân bổ hết.');
      if (data.amount !== undefined && data.amount > available) {
        throw new DomainError('VALIDATION_FAILED', `Chỉ còn ${available.toLocaleString('vi-VN')}đ chưa phân bổ.`, { available });
      }
      const result = await this.applyToBooking(c, payment, bk[0].id, now, actor.id, false, data.amount);
      if (result.allocated === 0) {
        throw new DomainError('CONFLICT', 'Không phân bổ được vào đơn này (đơn đã hết hạn, đã hủy hoặc đã trả đủ).', {
          bookingStatus: result.bookingStatus,
        });
      }
      await this.audit.record(
        { operatorId, actorUserId: actor.id, action: 'payment.allocate', entity: 'payment', entityId: paymentId,
          data: { bookingCode: data.bookingCode, amount: result.allocated, note: data.note ?? null } },
        c,
      );
      return this.paymentView(c, paymentId);
    });
  }

  /** Đánh dấu đã xử lý xong một khoản cần kiểm tra (vd. đã hoàn tiền ngoài hệ thống), bắt buộc ghi chú. */
  async resolve(actor: AuthUser, operatorId: string, paymentId: string, input: z.input<typeof resolveSchema>) {
    const data = resolveSchema.parse(input);
    if (!isUuid(operatorId) || !isUuid(paymentId)) throw notFound('khoản thu');
    return this.db.tx(async (c) => {
      const { rows } = await c.query<PaymentRow>(
        `UPDATE payments SET review_status = 'RESOLVED', review_note = $3
         WHERE id = $1 AND operator_id = $2 AND review_status = 'NEEDS_REVIEW' RETURNING *`,
        [paymentId, operatorId, data.note],
      );
      if (!rows[0]) {
        const { rows: ex } = await c.query('SELECT 1 FROM payments WHERE id = $1 AND operator_id = $2', [paymentId, operatorId]);
        if (!ex[0]) throw notFound('khoản thu');
        throw new DomainError('CONFLICT', 'Khoản thu này không ở trạng thái cần kiểm tra.');
      }
      await this.audit.record(
        { operatorId, actorUserId: actor.id, action: 'payment.resolve', entity: 'payment', entityId: paymentId, data: { note: data.note } },
        c,
      );
      return this.paymentView(c, paymentId);
    });
  }

  async list(operatorId: string, filter: { review?: string } = {}) {
    if (!isUuid(operatorId)) return [];
    const review = filter.review && ['NONE', 'NEEDS_REVIEW', 'RESOLVED'].includes(filter.review) ? filter.review : null;
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM payments WHERE operator_id = $1 AND ($2::text IS NULL OR review_status = $2)
       ORDER BY received_at DESC, id LIMIT 200`,
      [operatorId, review],
    );
    return Promise.all(rows.map((r) => this.paymentView(this.db, r.id)));
  }

  // ---- Lõi phân bổ ---------------------------------------------------------------------------------

  /**
   * Phân bổ tiền chưa phân bổ của `payment` vào đơn. Khóa chuyến rồi đơn (cùng thứ tự với giữ chỗ/hết hạn).
   * - Đơn đang giữ chỗ và giao dịch xảy ra trước hạn giữ: cộng tiền; đủ cọc → xác nhận vé.
   * - Đơn đã xác nhận: cộng phần còn thiếu.
   * - Đơn đã hết hạn/hủy hoặc giao dịch sau hạn giữ: không phân bổ, đánh dấu cần kiểm tra (không tự cấp lại chỗ).
   * - Phần dư sau khi trả đủ: đánh dấu OVERPAID.
   * `flagLeftover = false` (phân bổ thủ công) thì phần còn lại giữ nguyên trạng thái kiểm tra hiện có.
   */
  private async applyToBooking(
    c: PoolClient,
    payment: PaymentRow,
    bookingId: string,
    paidAt: Date,
    actorId: string | null,
    flagLeftover: boolean,
    maxAmount?: number,
  ): Promise<{ allocated: number; bookingStatus: string }> {
    const { rows: tr } = await c.query<{ trip_id: string }>('SELECT trip_id FROM bookings WHERE id = $1', [bookingId]);
    await c.query('SELECT id FROM trips WHERE id = $1 FOR NO KEY UPDATE', [tr[0]!.trip_id]);
    const { rows } = await c.query<LockedBooking>(
      `SELECT id, code, operator_id, trip_id, status, hold_expires_at, total_amount, deposit_amount, paid_amount
       FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId],
    );
    const b = rows[0]!;
    const { rows: fresh } = await c.query<{ amount: number; allocated_amount: number }>(
      'SELECT amount, allocated_amount FROM payments WHERE id = $1 FOR UPDATE',
      [payment.id],
    );
    let available = fresh[0]!.amount - fresh[0]!.allocated_amount;
    if (maxAmount !== undefined) available = Math.min(available, maxAmount);

    const onTimeHold = b.status === 'HOLDING' && b.hold_expires_at !== null && paidAt < b.hold_expires_at;
    const open = onTimeHold || b.status === 'CONFIRMED';
    if (!open) {
      if (flagLeftover) await this.flag(c, payment.id, b.status === 'HOLDING' || b.status === 'EXPIRED' ? 'LATE' : 'BOOKING_CLOSED');
      return { allocated: 0, bookingStatus: b.status };
    }
    const allocate = Math.min(available, b.total_amount - b.paid_amount);
    if (allocate > 0) {
      const { rows: al } = await c.query<{ id: string }>(
        'INSERT INTO payment_allocations (payment_id, booking_id, amount, allocated_by) VALUES ($1, $2, $3, $4) RETURNING id',
        [payment.id, b.id, allocate, actorId],
      );
      await c.query('UPDATE payments SET allocated_amount = allocated_amount + $2 WHERE id = $1', [payment.id, allocate]);
      const paid = b.paid_amount + allocate;
      const confirm = b.status === 'HOLDING' && paid >= b.deposit_amount;
      const status = confirm ? 'CONFIRMED' : b.status;
      const paymentStatus = paid >= b.total_amount ? 'PAID' : status === 'CONFIRMED' ? 'DEPOSIT_PAID' : 'PARTIAL';
      await c.query(
        `UPDATE bookings SET paid_amount = $2, payment_status = $3, status = $4,
                hold_expires_at = CASE WHEN $5 THEN NULL ELSE hold_expires_at END,
                confirmed_at = CASE WHEN $5 THEN $6 ELSE confirmed_at END, updated_at = $6
         WHERE id = $1`,
        [b.id, paid, paymentStatus, status, confirm, this.clock.now()],
      );
      await this.outbox(c, b.operator_id, 'payment.allocated', b.id, `payment.allocated:${al[0]!.id}`, {
        bookingCode: b.code, amount: allocate, paidAmount: paid, paymentStatus,
      });
      if (confirm) {
        await this.outbox(c, b.operator_id, 'booking.confirmed', b.id, `booking.confirmed:${b.id}`, { bookingCode: b.code });
      }
    }
    if (flagLeftover && available - allocate > 0) await this.flag(c, payment.id, 'OVERPAID');
    if (!flagLeftover) {
      // Phân bổ thủ công hết phần còn lại → khoản cần kiểm tra coi như đã xử lý.
      await c.query(
        `UPDATE payments SET review_status = 'RESOLVED', review_note = COALESCE(review_note, 'Đã phân bổ thủ công')
         WHERE id = $1 AND review_status = 'NEEDS_REVIEW' AND allocated_amount = amount`,
        [payment.id],
      );
    }
    return { allocated: allocate, bookingStatus: b.status };
  }

  private async flag(c: Queryable, paymentId: string, reason: ReviewReason): Promise<void> {
    await c.query(
      `UPDATE payments SET review_status = 'NEEDS_REVIEW', review_reason = $2 WHERE id = $1 AND review_status <> 'RESOLVED'`,
      [paymentId, reason],
    );
  }

  private async outbox(c: Queryable, operatorId: string, type: string, aggregateId: string, dedupeKey: string, payload: object) {
    await c.query(
      `INSERT INTO outbox_events (operator_id, type, aggregate_id, payload, dedupe_key) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [operatorId, type, aggregateId, JSON.stringify(payload), dedupeKey],
    );
  }

  private async findByIdempotency(q: Queryable, operatorId: string, key: string): Promise<PaymentRow | undefined> {
    const { rows } = await q.query<PaymentRow>('SELECT * FROM payments WHERE operator_id = $1 AND idempotency_key = $2', [
      operatorId, key,
    ]);
    return rows[0];
  }

  private async replayManual(q: Queryable, existing: PaymentRow, requestHash: string) {
    if (existing.request_hash !== requestHash) {
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng cho một khoản thu khác.');
    }
    return { ...(await this.paymentView(q, existing.id)), replayed: true };
  }

  private async paymentView(q: Queryable, paymentId: string) {
    const { rows } = await q.query<{
      id: string; method: string; amount: number; allocated_amount: number; content: string | null; reference_code: string | null;
      transaction_at: Date; received_at: Date; review_status: string; review_reason: string | null; review_note: string | null;
      matched_code: string | null; recorded_by_name: string | null;
    }>(
      `SELECT p.id, p.method, p.amount, p.allocated_amount, p.content, p.reference_code, p.transaction_at, p.received_at,
              p.review_status, p.review_reason, p.review_note, b.code AS matched_code, u.full_name AS recorded_by_name
       FROM payments p LEFT JOIN bookings b ON b.id = p.matched_booking_id LEFT JOIN users u ON u.id = p.recorded_by
       WHERE p.id = $1`,
      [paymentId],
    );
    const p = rows[0]!;
    const { rows: allocs } = await q.query<{ code: string; amount: number; created_at: Date }>(
      `SELECT b.code, a.amount, a.created_at FROM payment_allocations a JOIN bookings b ON b.id = a.booking_id
       WHERE a.payment_id = $1 ORDER BY a.id`,
      [paymentId],
    );
    return {
      id: p.id,
      method: p.method,
      amount: p.amount,
      allocatedAmount: p.allocated_amount,
      unallocatedAmount: p.amount - p.allocated_amount,
      content: p.content,
      bankReference: p.reference_code,
      transactionAt: p.transaction_at.toISOString(),
      receivedAt: p.received_at.toISOString(),
      matchedBookingCode: p.matched_code,
      review: { status: p.review_status, reason: p.review_reason, note: p.review_note },
      recordedBy: p.recorded_by_name,
      allocations: allocs.map((a) => ({ bookingCode: a.code, amount: a.amount, at: a.created_at.toISOString() })),
    };
  }
}
