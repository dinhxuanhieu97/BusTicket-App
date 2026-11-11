import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** Bỏ các ký tự dễ nhầm khi đọc/gõ nội dung chuyển khoản: 0/O, 1/I/L. */
export const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length: number, rng: (max: number) => number = randomInt): string {
  if (!Number.isInteger(length) || length < 1) throw new RangeError('length must be a positive integer');
  let out = '';
  for (let i = 0; i < length; i++) out += SAFE_ALPHABET[rng(SAFE_ALPHABET.length)];
  return out;
}

/** Mã đơn = tiền tố nhà xe + 6 ký tự, ví dụ `PN7K3D2Q`. */
export function bookingCode(operatorCode: string, rng?: (max: number) => number): string {
  return operatorCode + randomCode(6, rng);
}

export const OPERATOR_CODE = /^[A-Z]{2,4}$/;

/**
 * Token truy cập đơn: HMAC(secret, bookingId:version). Không lưu token; đổi `version` để thu hồi.
 * Trả lại được khi client gửi lặp cùng Idempotency-Key.
 */
export function bookingAccessToken(secret: string, bookingId: string, version: number): string {
  return createHmac('sha256', secret).update(`${bookingId}:${version}`).digest('base64url');
}

export function verifyBookingAccessToken(secret: string, bookingId: string, version: number, token: string): boolean {
  return matchesToken(bookingAccessToken(secret, bookingId, version), token);
}

/** Chữ ký để đối chiếu vé. Dùng miền riêng để mã QR không cấp quyền truy cập đơn. */
export function ticketProof(secret: string, bookingId: string, version: number): string {
  return createHmac('sha256', secret).update(`ticket-proof:v1:${bookingId}:${version}`).digest('base64url');
}

export function verifyTicketProof(secret: string, bookingId: string, version: number, proof: string): boolean {
  return matchesToken(ticketProof(secret, bookingId, version), proof);
}

function matchesToken(expectedToken: string, token: string): boolean {
  const expected = Buffer.from(expectedToken);
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
