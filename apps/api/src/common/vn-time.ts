import { DomainError } from './errors';

/** Việt Nam không có giờ mùa hè: UTC+7 cố định. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Khoảng [start, end) theo UTC của một ngày lịch `YYYY-MM-DD` giờ Việt Nam. */
export function vnDayRange(date: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new DomainError('VALIDATION_FAILED', 'Ngày phải có dạng YYYY-MM-DD.', { field: 'date' });
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utcMidnight = Date.UTC(y, mo - 1, d);
  const check = new Date(utcMidnight);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new DomainError('VALIDATION_FAILED', 'Ngày không tồn tại.', { field: 'date' });
  }
  const start = new Date(utcMidnight - VN_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}
