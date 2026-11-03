import { DomainError } from './errors';

/** Đầu số di động Việt Nam hợp lệ sau khi bỏ số 0 đầu: 3x, 5x, 7x, 8x, 9x. */
const MOBILE_BODY = /^[35789]\d{8}$/;

/**
 * Chuẩn hóa số di động Việt Nam về dạng `+84xxxxxxxxx`.
 * Chấp nhận `0912 345 678`, `0912.345.678`, `84912345678`, `+84 912 345 678`.
 */
export function normalizeVnPhone(input: string): string {
  const compact = input.trim().replace(/[\s.\-()]/g, '');
  let body: string | null = null;
  if (/^\+84\d+$/.test(compact)) body = compact.slice(3);
  else if (/^84\d{9}$/.test(compact)) body = compact.slice(2);
  else if (/^0\d{9}$/.test(compact)) body = compact.slice(1);
  if (body === null || !MOBILE_BODY.test(body)) {
    throw new DomainError('VALIDATION_FAILED', 'Số điện thoại di động không hợp lệ.', { field: 'phone' });
  }
  return `+84${body}`;
}
