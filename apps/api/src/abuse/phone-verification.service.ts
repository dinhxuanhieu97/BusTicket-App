import { Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { TokenSecret } from '../bookings/token-secret';
import { Clock } from '../common/clock';
import { DomainError } from '../common/errors';
import { isUuid } from '../common/ids';
import { normalizeVnPhone } from '../common/phone';
import { Db } from '../db/db';
import { AbuseConfig } from './abuse-config';
import { clientKey } from './client-ip';
import { RateLimiter } from './rate-limiter';
import { SmsSender } from './sms-sender';

export const startVerificationSchema = z
  .object({ operatorCode: z.string().regex(/^[A-Z]{2,4}$/), phone: z.string().min(1).max(30) })
  .strict();
export const verifyCodeSchema = z
  .object({ verificationId: z.string().min(1).max(64), code: z.string().min(1).max(10) })
  .strict();

const wrongCode = () => new DomainError('VALIDATION_FAILED', 'Mã xác thực không đúng hoặc đã hết hạn.');

/**
 * Xác thực SĐT bằng OTP qua SMS khi nhà xe bật chế độ cao điểm (chính sách `requirePhoneOtp`).
 * Thành công → token ký HMAC gắn với (nhà xe, SĐT), dùng trong header `X-Phone-Token` khi giữ chỗ.
 */
@Injectable()
export class PhoneVerificationService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly config: AbuseConfig,
    private readonly limiter: RateLimiter,
    private readonly sms: SmsSender,
    private readonly secret: TokenSecret,
  ) {}

  /**
   * Gửi mã 6 số. Chỉ khi nhà xe đang bật chế độ cao điểm (tránh tốn SMS vô ích).
   * Giới hạn: theo nguồn (IP, gom IPv6 theo /64), theo SĐT trên toàn nền tảng và trong nhà xe mỗi giờ,
   * và khoảng cách tối thiểu giữa hai lần gửi cho cùng SĐT (kiểm tra dưới khóa, không phụ thuộc ranh giới phút).
   */
  async start(input: z.input<typeof startVerificationSchema>, ip: string): Promise<{ verificationId: string; expiresAt: string }> {
    const data = startVerificationSchema.parse(input);
    const phone = normalizeVnPhone(data.phone);
    const { rows: ops } = await this.db.query<{ id: string; name: string; require_phone_otp: boolean | null }>(
      `SELECT o.id, o.name,
              (SELECT p.require_phone_otp FROM operator_policies p WHERE p.operator_id = o.id ORDER BY p.version DESC LIMIT 1)
                AS require_phone_otp
       FROM operators o WHERE o.code = $1`,
      [data.operatorCode],
    );
    const op = ops[0];
    if (!op) throw new DomainError('NOT_FOUND', 'Không tìm thấy nhà xe.');
    if (!op.require_phone_otp) {
      throw new DomainError('VALIDATION_FAILED', 'Nhà xe hiện không yêu cầu xác thực số điện thoại.');
    }
    const busy = 'Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau.';
    await this.limiter.consume(`otp-ip:${clientKey(ip) ?? 'unknown'}`, this.config.otpPerIpPerHour, 3600, busy);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.config.otpTtlSeconds * 1000);
    const id = await this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp-send:${op.id}:${phone}`]);
      const { rows: last } = await c.query<{ created_at: Date }>(
        'SELECT created_at FROM phone_verifications WHERE operator_id = $1 AND phone = $2 ORDER BY created_at DESC LIMIT 1',
        [op.id, phone],
      );
      const waitMs = last[0] ? last[0].created_at.getTime() + this.config.otpResendSeconds * 1000 - now.getTime() : 0;
      if (waitMs > 0) {
        throw new DomainError('TOO_MANY_ATTEMPTS', 'Vui lòng chờ một chút trước khi gửi lại mã.', {
          retryAfterSeconds: Math.ceil(waitMs / 1000),
        });
      }
      // Hạn mức theo giờ chỉ tính các lần thực sự gửi (sau khi qua khoảng cách tối thiểu).
      // Một SĐT nhận tối đa 2N mã/giờ trên toàn nền tảng (không nhân lên theo số nhà xe).
      await this.limiter.consume(`otp-phone-all:${phone}`, this.config.otpPerPhonePerHour * 2, 3600, busy);
      await this.limiter.consume(`otp-phone:${op.id}:${phone}`, this.config.otpPerPhonePerHour, 3600, busy);
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO phone_verifications (operator_id, phone, code_hash, expires_at, created_at)
         VALUES ($1, $2, 'pending', $3, $4) RETURNING id`,
        [op.id, phone, expiresAt, now],
      );
      const newId = rows[0]!.id;
      await c.query('UPDATE phone_verifications SET code_hash = $2 WHERE id = $1', [newId, this.codeHash(newId, code)]);
      return newId;
    });
    const minutes = Math.round(this.config.otpTtlSeconds / 60);
    try {
      await this.sms.send(phone, `${op.name}: Ma xac thuc dat ve cua ban la ${code}. Het han sau ${minutes} phut. Khong chia se ma nay.`);
    } catch (e) {
      // Gửi lỗi: hủy mã để khách có thể xin lại ngay.
      await this.db.query('DELETE FROM phone_verifications WHERE id = $1', [id]);
      throw e;
    }
    return { verificationId: id, expiresAt: expiresAt.toISOString() };
  }

  /** Kiểm tra mã. Sai quá số lần hoặc hết hạn → phải xin mã mới. Mỗi mã chỉ dùng được một lần. */
  async verify(input: z.input<typeof verifyCodeSchema>): Promise<{ phoneToken: string; expiresAt: string }> {
    const data = verifyCodeSchema.parse(input);
    if (!isUuid(data.verificationId) || !/^\d{6}$/.test(data.code)) throw wrongCode();
    const now = this.clock.now();
    // Tính lượt thử trước khi so mã (nguyên tử) để các yêu cầu song song không vượt số lần cho phép.
    const { rows } = await this.db.query<{ operator_id: string; phone: string; code_hash: string }>(
      `UPDATE phone_verifications SET attempts = attempts + 1
       WHERE id = $1 AND attempts < $2 AND expires_at > $3 AND consumed_at IS NULL
       RETURNING operator_id, phone, code_hash`,
      [data.verificationId, this.config.otpMaxAttempts, now],
    );
    const v = rows[0];
    if (!v) throw wrongCode();
    const expected = Buffer.from(this.codeHash(data.verificationId, data.code));
    const stored = Buffer.from(v.code_hash);
    if (expected.length !== stored.length || !timingSafeEqual(expected, stored)) throw wrongCode();
    const consumed = await this.db.query(
      'UPDATE phone_verifications SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL',
      [data.verificationId, now],
    );
    if (consumed.rowCount !== 1) throw wrongCode();
    const exp = Math.floor(now.getTime() / 1000) + this.config.phoneTokenTtlSeconds;
    return { phoneToken: this.signToken(v.operator_id, v.phone, exp), expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Token hợp lệ cho đúng nhà xe và đúng SĐT, còn hạn. */
  verifyToken(token: string | undefined, operatorId: string, phone: string): boolean {
    if (!token) return false;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    let claims: { op?: unknown; phone?: unknown; exp?: unknown };
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return false;
    }
    return (
      claims.op === operatorId &&
      claims.phone === phone &&
      typeof claims.exp === 'number' &&
      claims.exp > Math.floor(this.clock.now().getTime() / 1000)
    );
  }

  private signToken(operatorId: string, phone: string, exp: number): string {
    const payload = Buffer.from(JSON.stringify({ op: operatorId, phone, exp })).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  /** Tách miền khóa với token truy cập đơn (cùng bí mật gốc nhưng tiền tố khác). */
  private sign(payload: string): string {
    return createHmac('sha256', this.secret.value).update(`phone-token:v1:${payload}`).digest('base64url');
  }

  private codeHash(id: string, code: string): string {
    return createHmac('sha256', this.secret.value).update(`phone-otp:v1:${id}:${code}`).digest('base64url');
  }
}
