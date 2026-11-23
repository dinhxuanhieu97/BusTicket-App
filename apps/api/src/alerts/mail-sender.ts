import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createTransport } from 'nodemailer';

/** Máy chủ SMTP của một nhà xe (mật khẩu đã giải mã, chỉ sống trong bộ nhớ lúc gửi). */
export interface SmtpConfig {
  host: string;
  port: 465 | 587;
  user: string;
  password: string;
  fromName: string | null;
}

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
}

/** Gửi email qua SMTP của nhà xe. Lỗi ném ra là `Error` có message ngắn, không chứa mật khẩu. */
export abstract class MailSender {
  abstract send(config: SmtpConfig, message: MailMessage): Promise<void>;
}

/**
 * Địa chỉ không được kết nối tới: loopback, mạng nội bộ, link-local, CGNAT, multicast… Chủ xe tự nhập máy chủ SMTP,
 * nên phải chặn để ô này không thành đường dò mạng nội bộ của máy chủ API (SSRF).
 */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
    || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

/** Gửi thật bằng nodemailer. 465 = TLS ngay từ đầu, 587 = STARTTLS bắt buộc. */
export class SmtpMailSender extends MailSender {
  async send(config: SmtpConfig, message: MailMessage): Promise<void> {
    // Phân giải trước và nối thẳng vào IP đã kiểm (servername giữ tên miền cho TLS), tránh đổi DNS giữa lúc kiểm và lúc nối.
    let address: string;
    try {
      const all = await lookup(config.host, { all: true });
      if (!all.length || all.some((a) => isPrivateAddress(a.address))) throw new Error('private');
      address = all[0]!.address;
    } catch {
      throw new Error(`Không kết nối được máy chủ ${config.host}.`);
    }
    const transport = createTransport({
      host: address,
      port: config.port,
      secure: config.port === 465,
      requireTLS: config.port === 587,
      tls: { servername: config.host },
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      await transport.sendMail({
        from: config.fromName ? { name: config.fromName, address: config.user } : config.user,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (e) {
      throw new Error(smtpErrorMessage(e));
    } finally {
      transport.close();
    }
  }
}

/** Lỗi SMTP → câu ngắn cho chủ xe; không đưa nguyên phản hồi máy chủ (có thể dài, lẫn dữ liệu đăng nhập). */
export function smtpErrorMessage(e: unknown): string {
  const err = e as { code?: string; responseCode?: number };
  if (err?.code === 'EAUTH' || err?.responseCode === 535 || err?.responseCode === 534) {
    return 'Máy chủ từ chối đăng nhập. Kiểm tra địa chỉ email và mật khẩu ứng dụng.';
  }
  if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNECTION' || err?.code === 'ESOCKET' || err?.code === 'EDNS') {
    return 'Không kết nối được máy chủ gửi mail. Kiểm tra tên máy chủ và cổng.';
  }
  if (err?.code === 'EENVELOPE') return 'Địa chỉ người nhận bị từ chối.';
  return `Gửi email thất bại${err?.responseCode ? ` (mã ${err.responseCode})` : ''}.`;
}

/** Dùng trong test: lưu thư đã gửi, có thể cho lỗi. */
export class CapturingMailSender extends MailSender {
  readonly sent: { config: SmtpConfig; message: MailMessage }[] = [];
  failWith: string | null = null;

  async send(config: SmtpConfig, message: MailMessage): Promise<void> {
    if (this.failWith) throw new Error(this.failWith);
    this.sent.push({ config, message });
  }
}
