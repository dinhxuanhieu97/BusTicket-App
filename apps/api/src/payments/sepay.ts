import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { SAFE_ALPHABET } from '../common/codes';
import { DomainError } from '../common/errors';

/**
 * Giao dịch ngân hàng đã chuẩn hóa (từ webhook hoặc API đối soát của SePay).
 * Tài liệu SePay: payload webhook gồm id, gateway, transactionDate, accountNumber, code, content,
 * transferType ("in"/"out"), transferAmount, accumulated, subAccount, referenceCode, description.
 */
export interface BankTransfer {
  providerTxnId: string;
  accountNumber: string;
  direction: 'in' | 'out';
  amount: number;
  content: string;
  referenceCode: string | null;
  /** Mã thanh toán SePay tự nhận diện từ nội dung (nếu đã cấu hình tiền tố), có thể null. */
  code: string | null;
  transactionAt: Date;
}

/** Số tiền: SePay có lúc gửi số, có lúc gửi chuỗi "19689000.00". Chỉ nhận số nguyên VND dương. */
const amountSchema = z.union([z.number(), z.string().regex(/^\d+(\.0+)?$/)]).transform((v, ctx) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isSafeInteger(n) || n < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Số tiền phải là số nguyên VND' });
    return z.NEVER;
  }
  return n;
});

const idSchema = z.union([z.number().int().nonnegative(), z.string().regex(/^[\w.-]{1,64}$/)]).transform(String);

export const sepayWebhookSchema = z
  .object({
    id: idSchema,
    gateway: z.string().max(100).optional().nullable(),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    accountNumber: z.string().regex(/^[0-9A-Za-z]{4,30}$/),
    code: z.string().max(100).optional().nullable(),
    content: z.string().max(1000).optional().nullable(),
    transferType: z.enum(['in', 'out']),
    transferAmount: amountSchema,
    referenceCode: z.string().max(200).optional().nullable(),
  })
  .passthrough();

/** "2026-11-04 14:02:37" theo giờ Việt Nam (UTC+7) → Date (UTC). */
export function parseVnDateTime(text: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!m) throw new DomainError('VALIDATION_FAILED', 'Thời gian giao dịch không hợp lệ.');
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const ms = Date.UTC(y, mo - 1, d, h - 7, mi, s);
  const check = new Date(ms + 7 * 3600_000);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    throw new DomainError('VALIDATION_FAILED', 'Thời gian giao dịch không hợp lệ.');
  }
  return new Date(ms);
}

export function parseSepayWebhook(body: unknown): BankTransfer {
  const p = sepayWebhookSchema.parse(body);
  return {
    providerTxnId: p.id,
    accountNumber: p.accountNumber,
    direction: p.transferType,
    amount: p.transferAmount,
    content: p.content ?? '',
    referenceCode: p.referenceCode ?? null,
    code: p.code ?? null,
    transactionAt: parseVnDateTime(p.transactionDate),
  };
}

export function hashWebhookKey(key: string): string {
  return createHash('sha256').update(`sepay-webhook:v1:${key}`).digest('hex');
}

/**
 * Header theo tài liệu SePay (xác thực API Key): `Authorization: Apikey <API_KEY>`.
 * So khớp dạng băm, thời gian hằng.
 */
export function verifyApiKeyHeader(header: string | undefined, storedHash: string): boolean {
  const m = /^Apikey\s+(\S+)\s*$/i.exec(header ?? '');
  if (!m) return false;
  const given = Buffer.from(hashWebhookKey(m[1]!));
  const expected = Buffer.from(storedHash);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Tìm mã đơn (tiền tố nhà xe + 6 ký tự an toàn) trong nội dung chuyển khoản. Ngân hàng có thể đổi
 * chữ hoa/thường, bỏ/ thêm dấu cách hoặc dính chữ khác vào trước mã, nên không dựa vào ranh giới từ.
 * Trả về các mã khác nhau tìm thấy (ưu tiên trường `code` SePay tự nhận diện nếu có).
 */
export function extractBookingCodes(content: string, operatorCode: string, providerCode?: string | null): string[] {
  const found = new Set<string>();
  // Lookahead để các ứng viên được phép chồng nhau: tên người gửi trùng tiền tố (vd. "NGUYEN VAN AN" với nhà xe "AN")
  // không được "nuốt" mất mã thật. Ứng viên thừa bị loại khi tra trong DB.
  const pattern = new RegExp(`(?=(${operatorCode}[${SAFE_ALPHABET}]{6}))`, 'g');
  for (const text of [providerCode ?? '', content]) {
    const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const m of compact.matchAll(pattern)) found.add(m[1]!);
  }
  return [...found];
}

/**
 * Ảnh QR chuyển khoản (VietQR) do SePay tạo: quét bằng mọi app ngân hàng, điền sẵn số tiền và nội dung.
 * Định dạng `https://qr.sepay.vn/img?acc=&bank=&amount=&des=` — cần đối chiếu lại tài liệu SePay khi chạy thật.
 */
export function sepayQrUrl(bankCode: string, accountNumber: string, amount: number, content: string): string {
  const q = new URLSearchParams({ acc: accountNumber, bank: bankCode, amount: String(amount), des: content });
  return `https://qr.sepay.vn/img?${q.toString()}`;
}

/** Nguồn giao dịch để đối soát định kỳ (bù webhook bị lỡ). */
export abstract class SepayTransactionsClient {
  abstract listIncoming(apiToken: string, accountNumber: string, since: Date): Promise<BankTransfer[]>;
}

/**
 * Gọi API giao dịch của SePay (`GET https://my.sepay.vn/userapi/transactions/list`, Bearer token).
 * Tên trường lấy theo tài liệu công khai và đọc phòng thủ (số tiền có thể là chuỗi) —
 * **cần chạy thử với tài khoản SePay thật trước khi bật**.
 */
export class HttpSepayTransactionsClient extends SepayTransactionsClient {
  constructor(private readonly baseUrl = 'https://my.sepay.vn') {
    super();
  }

  async listIncoming(apiToken: string, accountNumber: string, since: Date): Promise<BankTransfer[]> {
    const vn = new Date(since.getTime() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
    const q = new URLSearchParams({ account_number: accountNumber, transaction_date_min: vn, limit: '5000' });
    const res = await fetch(`${this.baseUrl}/userapi/transactions/list?${q}`, {
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`SePay API ${res.status}`);
    return mapSepayTransactionList(await res.json());
  }
}

const listItemSchema = z
  .object({
    id: idSchema,
    transaction_date: z.string(),
    account_number: z.string(),
    amount_in: amountSchema,
    transaction_content: z.string().nullable().optional(),
    reference_number: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
  })
  .passthrough();

/** Chuyển kết quả API danh sách giao dịch thành `BankTransfer` (chỉ tiền vào). Dòng sai định dạng bị bỏ qua. */
export function mapSepayTransactionList(json: unknown): BankTransfer[] {
  const list = (json as { transactions?: unknown })?.transactions;
  if (!Array.isArray(list)) return [];
  const out: BankTransfer[] = [];
  for (const raw of list) {
    const r = listItemSchema.safeParse(raw);
    if (!r.success || r.data.amount_in <= 0) continue;
    try {
      out.push({
        providerTxnId: r.data.id,
        accountNumber: r.data.account_number,
        direction: 'in',
        amount: r.data.amount_in,
        content: r.data.transaction_content ?? '',
        referenceCode: r.data.reference_number ?? null,
        code: r.data.code ?? null,
        transactionAt: parseVnDateTime(r.data.transaction_date),
      });
    } catch {
      continue;
    }
  }
  return out;
}
