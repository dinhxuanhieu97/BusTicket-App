import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DomainError } from '../common/errors';
import { normalizeVnPhone } from '../common/phone';
import { Db } from '../db/db';
import { AbuseConfig } from './abuse-config';
import { clientKey } from './client-ip';
import { PhoneVerificationService } from './phone-verification.service';
import { RateLimiter } from './rate-limiter';
import { ZaloPhoneResolver } from './zalo-phone';

export const zaloPhoneSchema = z
  .object({
    operatorCode: z.string().regex(/^[A-Z]{2,4}$/),
    accessToken: z.string().min(1).max(2048),
    code: z.string().min(1).max(2048),
  })
  .strict();

/**
 * Khách bấm "Dùng số điện thoại Zalo" trong Mini App: đổi token của Zalo lấy số thật.
 * Số do Zalo xác nhận nên được cấp luôn `phoneToken` (thay cho OTP SMS khi nhà xe bật chế độ cao điểm).
 * Số điện thoại chỉ trả về cho chính người vừa đồng ý chia sẻ.
 */
@Injectable()
export class ZaloPhoneService {
  constructor(
    private readonly db: Db,
    private readonly config: AbuseConfig,
    private readonly limiter: RateLimiter,
    private readonly resolver: ZaloPhoneResolver,
    private readonly phones: PhoneVerificationService,
  ) {}

  async exchange(
    input: z.input<typeof zaloPhoneSchema>,
    ip: string,
  ): Promise<{ phone: string; phoneToken: string; expiresAt: string }> {
    const data = zaloPhoneSchema.parse(input);
    const { rows } = await this.db.query<{ id: string }>('SELECT id FROM operators WHERE code = $1', [data.operatorCode]);
    const op = rows[0];
    if (!op) throw new DomainError('NOT_FOUND', 'Không tìm thấy nhà xe.');
    if (!this.resolver.configured(data.operatorCode)) {
      throw new DomainError('SERVICE_UNAVAILABLE', 'Chưa lấy được số điện thoại từ Zalo, vui lòng nhập tay.');
    }
    await this.limiter.consume(
      `zalo-phone-ip:${clientKey(ip) ?? 'unknown'}`,
      this.config.zaloPhonePerIpPerHour,
      3600,
      'Bạn đã thử quá nhiều lần. Vui lòng nhập số điện thoại bằng tay.',
    );
    const raw = await this.resolver.resolve(data.operatorCode, data.accessToken, data.code);
    let phone: string;
    try {
      phone = normalizeVnPhone(raw);
    } catch {
      // Số Zalo không phải di động Việt Nam (vd. số nước ngoài): khách nhập tay.
      throw new DomainError('VALIDATION_FAILED', 'Số điện thoại Zalo của bạn không phải số di động Việt Nam, vui lòng nhập tay.');
    }
    return { phone: `0${phone.slice(3)}`, ...this.phones.issueToken(op.id, phone) };
  }
}
