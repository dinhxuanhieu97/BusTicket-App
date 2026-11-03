import { DomainError } from '../common/errors';

/** Gửi SMS. Nhà cung cấp thật được cắm vào ở T7; mặc định chưa cấu hình. */
export abstract class SmsSender {
  /** Đã có nhà cung cấp SMS thật chưa (bật OTP cao điểm cần cái này). */
  abstract readonly configured: boolean;
  abstract send(phone: string, text: string): Promise<void>;
}

export class NotConfiguredSmsSender extends SmsSender {
  readonly configured = false;

  async send(): Promise<void> {
    throw new DomainError('SERVICE_UNAVAILABLE', 'Chưa cấu hình dịch vụ SMS, vui lòng liên hệ nhà xe.');
  }
}

/** Dùng trong test: lưu tin đã gửi. */
export class CapturingSmsSender extends SmsSender {
  readonly configured = true;
  readonly sent: { phone: string; text: string }[] = [];

  async send(phone: string, text: string): Promise<void> {
    this.sent.push({ phone, text });
  }

  lastCodeFor(phone: string): string | undefined {
    const msg = [...this.sent].reverse().find((m) => m.phone === phone);
    return msg?.text.match(/\b(\d{6})\b/)?.[1];
  }
}
