import { enqueueStaffAlert } from '../alerts/staff-alerts.service';
import { Injectable } from '@nestjs/common';
import { RateLimiter } from '../abuse/rate-limiter';
import { createHash } from 'node:crypto';
import { Clock } from '../common/clock';
import { verifyBookingAccessToken } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { Db } from '../db/db';
import { sniffImage } from '../operators/operators.service';
import { TokenSecret } from './token-secret';

/** Ảnh nén ở Mini App thường < 500 KB; giới hạn cứng 1,5 MB mỗi ảnh. */
export const PROOF_MAX_BYTES = 1_572_864;
/** Mỗi đơn tối đa 3 ảnh (ví dụ chuyển nhiều lần). */
export const PROOF_MAX_PER_BOOKING = 3;
/** Gia hạn giữ chỗ một lần khi khách báo đã chuyển khoản. */
export const TRANSFER_CLAIM_EXTENSION_MS = 2 * 60 * 60 * 1000;

/** Giới hạn lượt gửi ảnh (kể cả lượt lỗi) trong 10 phút. */
export const PROOF_UPLOADS_PER_IP_PER_10_MIN = 30;
export const PROOF_UPLOADS_PER_BOOKING_PER_10_MIN = 10;

export const PROOF_INVALID = 'Ảnh phải là PNG, JPEG hoặc WebP, tối đa 1,5 MB.';

export interface ProofMeta {
  id: string;
  mime: string;
  bytes: number;
  createdAt: string;
}

/**
 * Ảnh lệnh chuyển khoản khách gửi để nhà xe đối chiếu. Khách xác thực bằng token đơn (`X-Booking-Token`);
 * nhà xe đọc qua API quản trị trong phạm vi nhà xe của mình. Ảnh không làm đơn được xác nhận: nhà xe vẫn phải
 * ghi nhận tiền (`payment.record`) sau khi thấy tiền về.
 */
@Injectable()
export class PaymentProofsService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly tokenSecret: TokenSecret,
    private readonly limiter: RateLimiter,
  ) {}

  /**
   * Kiểm tra trước khi đọc thân ảnh: giới hạn tần suất theo IP và theo đơn, rồi xác thực token đơn.
   * Nhờ vậy request rác (token sai, gửi dồn) bị chặn mà máy chủ không phải nhận hết 1,5 MB.
   */
  async precheck(code: string, accessToken: string, ip: string): Promise<void> {
    const message = 'Bạn gửi ảnh quá nhanh, vui lòng thử lại sau ít phút.';
    await this.limiter.consume(`proof-ip:${ip}`, PROOF_UPLOADS_PER_IP_PER_10_MIN, 600, message);
    await this.limiter.consume(`proof-code:${code}`, PROOF_UPLOADS_PER_BOOKING_PER_10_MIN, 600, message);
    await this.findByToken(code, accessToken);
  }

  /**
   * Lưu một ảnh và (lần đầu) đánh dấu khách đã báo chuyển khoản + gia hạn giữ chỗ tới
   * min(bây giờ + 2 giờ, giờ đóng bán/xuất bến sớm nhất của các chuyến trong đơn). Không rút ngắn hạn đang có.
   */
  async submit(code: string, accessToken: string, data: Buffer, declaredMime: string): Promise<{ proof: ProofMeta; duplicate: boolean }> {
    if (data.length === 0 || data.length > PROOF_MAX_BYTES) {
      throw new DomainError('VALIDATION_FAILED', PROOF_INVALID, { field: 'proof' });
    }
    const mime = sniffImage(data);
    if (!mime || mime !== declaredMime.split(';')[0]!.trim().toLowerCase()) {
      throw new DomainError('VALIDATION_FAILED', PROOF_INVALID, { field: 'proof' });
    }
    const found = await this.findByToken(code, accessToken);
    const sha = createHash('sha256').update(data).digest();
    return this.db.tx(async (c) => {
      // Cùng thứ tự khóa với giữ chỗ/nhả chỗ: mọi chuyến của đơn theo ID, rồi mới tới đơn.
      const { rows: trips } = await c.query<{ sales_close_at: Date; depart_at: Date }>(
        `SELECT sales_close_at, depart_at FROM trips
          WHERE id IN (SELECT trip_id FROM booking_items WHERE booking_id = $1) ORDER BY id FOR NO KEY UPDATE`,
        [found.id],
      );
      const { rows } = await c.query<{
        id: string; operator_id: string; status: string; release_at: Date | null; hold_expires_at: Date | null;
        access_token_version: number; transfer_claimed_at: Date | null;
      }>(
        `SELECT id, operator_id, status, release_at, hold_expires_at, access_token_version, transfer_claimed_at
           FROM bookings WHERE id = $1 FOR UPDATE`,
        [found.id],
      );
      const b = rows[0]!;
      if (!verifyBookingAccessToken(this.tokenSecret.value, b.id, b.access_token_version, accessToken)) throw notFound('đơn');
      const now = this.clock.now();
      if (b.status !== 'HOLDING' || !b.release_at || b.release_at <= now) {
        throw new DomainError('CONFLICT', 'Đơn không còn giữ chỗ nên không gửi ảnh chuyển khoản được. Vui lòng liên hệ nhà xe.', {
          status: b.status === 'HOLDING' ? 'EXPIRED' : b.status,
        });
      }
      const existing = await c.query<ProofRow>(
        `SELECT id, mime, bytes, created_at FROM booking_payment_proofs WHERE booking_id = $1 AND sha256 = $2`,
        [b.id, sha],
      );
      if (existing.rows[0]) return { proof: meta(existing.rows[0]), duplicate: true };
      const { rows: counted } = await c.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM booking_payment_proofs WHERE booking_id = $1',
        [b.id],
      );
      if (counted[0]!.n >= PROOF_MAX_PER_BOOKING) {
        throw new DomainError('CONFLICT', `Mỗi đơn gửi tối đa ${PROOF_MAX_PER_BOOKING} ảnh chuyển khoản.`, { limit: PROOF_MAX_PER_BOOKING });
      }
      const { rows: inserted } = await c.query<ProofRow>(
        `INSERT INTO booking_payment_proofs (booking_id, operator_id, data, mime, bytes, sha256, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, mime, bytes, created_at`,
        [b.id, b.operator_id, data, mime, data.length, sha, now],
      );
      if (!b.transfer_claimed_at) {
        const latest = Math.min(
          now.getTime() + TRANSFER_CLAIM_EXTENSION_MS,
          ...trips.flatMap((t) => [t.sales_close_at.getTime(), t.depart_at.getTime()]),
        );
        const deadline = new Date(latest);
        await c.query(
          `UPDATE bookings SET transfer_claimed_at = $2,
                  hold_expires_at = GREATEST(hold_expires_at, $3),
                  -- Giữ nguyên ân hạn tiền về chậm như lúc giữ chỗ (hạn nhả = hạn trả + payment_grace_minutes).
                  release_at = GREATEST(release_at,
                    $3 + make_interval(mins => COALESCE((policy_snapshot->>'paymentGraceMinutes')::int, 0))),
                  updated_at = $2
            WHERE id = $1`,
          [b.id, now, deadline],
        );
      }
      await enqueueStaffAlert(c, b.operator_id, 'staff.payment_proof', b.id, `staff.payment_proof:${inserted[0]!.id}`, now, {
        proofId: inserted[0]!.id,
      });
      return { proof: meta(inserted[0]!), duplicate: false };
    });
  }

  /** Danh sách ảnh của một đơn thuộc nhà xe (không kèm dữ liệu ảnh). */
  async listForBooking(operatorId: string, code: string): Promise<{ transferClaimedAt: string | null; proofs: ProofMeta[] }> {
    if (!isUuid(operatorId) || !/^[A-Z0-9]{4,12}$/.test(code)) throw notFound('đơn');
    const { rows } = await this.db.query<{ id: string; transfer_claimed_at: Date | null }>(
      'SELECT id, transfer_claimed_at FROM bookings WHERE operator_id = $1 AND code = $2',
      [operatorId, code],
    );
    const b = rows[0];
    if (!b) throw notFound('đơn');
    const { rows: proofs } = await this.db.query<ProofRow>(
      'SELECT id, mime, bytes, created_at FROM booking_payment_proofs WHERE booking_id = $1 ORDER BY created_at, id',
      [b.id],
    );
    return { transferClaimedAt: b.transfer_claimed_at?.toISOString() ?? null, proofs: proofs.map(meta) };
  }

  /** Dữ liệu một ảnh, chỉ trong phạm vi nhà xe. */
  async image(operatorId: string, proofId: string): Promise<{ data: Buffer; mime: string; bookingCode: string }> {
    if (!isUuid(operatorId) || !isUuid(proofId)) throw notFound('ảnh');
    const { rows } = await this.db.query<{ data: Buffer; mime: string; bookingCode: string }>(
      `SELECT p.data, p.mime, b.code AS "bookingCode" FROM booking_payment_proofs p JOIN bookings b ON b.id = p.booking_id
        WHERE p.id = $1 AND p.operator_id = $2`,
      [proofId, operatorId],
    );
    if (!rows[0]) throw notFound('ảnh');
    return rows[0];
  }

  private async findByToken(code: string, accessToken: string): Promise<{ id: string }> {
    const { rows } = await this.db.query<{ id: string; access_token_version: number }>(
      'SELECT id, access_token_version FROM bookings WHERE code = $1',
      [code],
    );
    const b = rows[0];
    if (!b || !verifyBookingAccessToken(this.tokenSecret.value, b.id, b.access_token_version, accessToken)) throw notFound('đơn');
    return b;
  }
}

interface ProofRow { id: string; mime: string; bytes: number; created_at: Date }

const meta = (r: ProofRow): ProofMeta => ({ id: r.id, mime: r.mime, bytes: r.bytes, createdAt: r.created_at.toISOString() });
