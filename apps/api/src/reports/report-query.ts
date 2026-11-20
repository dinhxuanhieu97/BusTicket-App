import { z } from 'zod';
import { DomainError } from '../common/errors';
import { vnDayRange } from '../common/vn-time';

const MAX_DAYS = 366;

const rangeSchema = z.object({ from: z.string(), to: z.string() }).strict();

/** Khoảng báo cáo `[from, to)` theo ngày giờ Việt Nam (`to` không tính), 1–366 ngày. */
export function reportRange(input: unknown) {
  const q = rangeSchema.parse(input);
  const start = vnDayRange(q.from).start;
  const end = vnDayRange(q.to).start;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days < 1 || days > MAX_DAYS) throw new DomainError('VALIDATION_FAILED', 'Khoảng báo cáo phải từ 1 đến 366 ngày.');
  return { from: q.from, to: q.to, start, end, days };
}

/** Các ngày `YYYY-MM-DD` (giờ VN) trong `[from, to)` — để trả đủ ngày kể cả ngày không có số liệu. */
export function vnDates(from: string, days: number): string[] {
  const base = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

const searchSchema = z.object({ q: z.string().trim().min(2).max(64) }).strict();

/** Mẫu LIKE an toàn: thoát `\`, `%`, `_` của người dùng (dùng với `ESCAPE '\'`). */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Chuẩn hóa ô tìm nhanh. `phone` là phần số sau đầu số quốc gia (đã bỏ `0`/`84`/`+84`) khi người dùng gõ
 * toàn số và có ít nhất 4 chữ số; SĐT trong DB lưu dạng `+84xxxxxxxxx`.
 */
export function searchTerms(input: unknown) {
  const { q } = searchSchema.parse(input);
  let phone: string | null = null;
  if (/^[\d\s.+()-]+$/.test(q)) {
    let digits = q.replace(/\D/g, '');
    if (digits.startsWith('84') && digits.length >= 11) digits = digits.slice(2);
    else if (digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length >= 4) phone = digits;
  }
  return { q, code: q.toUpperCase().replace(/\s+/g, ''), phone };
}
