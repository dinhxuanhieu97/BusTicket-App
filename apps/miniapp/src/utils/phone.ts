/**
 * Kiểm tra sơ bộ số di động Việt Nam trước khi gửi (máy chủ vẫn chuẩn hóa và kiểm tra lại).
 * Cùng quy tắc với apps/api/src/common/phone.ts: 0xxxxxxxxx, 84xxxxxxxxx, +84xxxxxxxxx; đầu số 3/5/7/8/9.
 */
export function isValidVnMobile(input: string): boolean {
  const compact = input.trim().replace(/[\s.\-()]/g, "");
  let body: string | null = null;
  if (/^\+84\d+$/.test(compact)) body = compact.slice(3);
  else if (/^84\d{9}$/.test(compact)) body = compact.slice(2);
  else if (/^0\d{9}$/.test(compact)) body = compact.slice(1);
  return body !== null && /^[35789]\d{8}$/.test(body);
}
