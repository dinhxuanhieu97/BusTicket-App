import { Logger } from '@nestjs/common';
import { DomainError } from '../common/errors';

/**
 * Đổi token `getPhoneNumber` của Zalo Mini App lấy số điện thoại thật của khách.
 * Tài liệu: https://miniapp.zaloplatforms.com/documents/api/getPhoneNumber
 * Máy chủ gọi Zalo Open API với access token của khách + token số điện thoại + Secret Key của Mini App.
 */
export abstract class ZaloPhoneResolver {
  /** Nhà xe này đã cấu hình Secret Key Mini App chưa. */
  abstract configured(operatorCode: string): boolean;
  /** Trả số điện thoại thô do Zalo trả về (vd. `84912345678`). */
  abstract resolve(operatorCode: string, accessToken: string, code: string): Promise<string>;
}

const unavailable = () =>
  new DomainError('SERVICE_UNAVAILABLE', 'Chưa lấy được số điện thoại từ Zalo, vui lòng nhập tay.');

/**
 * Đọc `ZALO_APP_SECRET_KEYS`: mỗi nhà xe một Mini App nên mỗi nhà xe một Secret Key.
 * Định dạng `PN=secret1,ABC=secret2`.
 */
export function parseZaloSecretKeys(raw: string | undefined): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const part of (raw ?? '').split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const code = trimmed.slice(0, eq).trim();
    const secret = trimmed.slice(eq + 1).trim();
    if (eq <= 0 || !/^[A-Z]{2,4}$/.test(code) || !secret) {
      throw new Error('ZALO_APP_SECRET_KEYS phải có dạng "PN=secret,ABC=secret"');
    }
    keys[code] = secret;
  }
  return keys;
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status?: number;
  json(): Promise<unknown>;
}>;

export class HttpZaloPhoneResolver extends ZaloPhoneResolver {
  private readonly logger = new Logger('ZaloPhone');

  constructor(
    private readonly secretKeys: Record<string, string>,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 8000,
  ) {
    super();
  }

  configured(operatorCode: string): boolean {
    return !!this.secretKeys[operatorCode];
  }

  async resolve(operatorCode: string, accessToken: string, code: string): Promise<string> {
    const secret = this.secretKeys[operatorCode];
    if (!secret) throw unavailable();
    let body: unknown;
    try {
      const res = await this.fetchImpl('https://graph.zalo.me/v2.0/me/info', {
        headers: { access_token: accessToken, code, secret_key: secret },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${String((res as { status?: number }).status ?? '?')}`);
      body = await res.json();
    } catch (e) {
      this.logger.warn(`Zalo phone API unreachable (operator ${operatorCode}): ${(e as Error).message}`);
      throw unavailable();
    }
    const data = body as { error?: unknown; data?: { number?: unknown } } | null;
    const number = data?.data?.number;
    if (data?.error !== 0 || typeof number !== 'string' || !number) {
      // Chỉ ghi mã lỗi, không ghi token. Lỗi lặp lại ở mọi khách thường do Secret Key sai.
      this.logger.warn(`Zalo phone API error ${String(data?.error)} (operator ${operatorCode})`);
      // Token sai/hết hạn hoặc khách chưa đồng ý: không lộ chi tiết lỗi của Zalo ra ngoài.
      throw new DomainError('VALIDATION_FAILED', 'Không lấy được số điện thoại từ Zalo, vui lòng thử lại hoặc nhập tay.');
    }
    return number;
  }
}

/** Dùng trong test: map `code` → số điện thoại. */
export class FakeZaloPhoneResolver extends ZaloPhoneResolver {
  readonly numbers = new Map<string, string>();
  readonly calls: { operatorCode: string; accessToken: string; code: string }[] = [];

  configured(operatorCode: string): boolean {
    return operatorCode !== 'NOZL';
  }

  async resolve(operatorCode: string, accessToken: string, code: string): Promise<string> {
    this.calls.push({ operatorCode, accessToken, code });
    const n = this.numbers.get(code);
    if (!n) throw new DomainError('VALIDATION_FAILED', 'Không lấy được số điện thoại từ Zalo, vui lòng thử lại hoặc nhập tay.');
    return n;
  }
}
