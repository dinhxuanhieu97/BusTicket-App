import { createHmac, timingSafeEqual } from 'node:crypto';

/** Phạm vi token: `full` = dùng API quản trị; `mfa_setup` = chỉ được thiết lập 2FA. */
export type TokenScope = 'full' | 'mfa_setup';

export interface AccessClaims {
  sub: string; // user id
  ver: number; // users.token_version — tăng để thu hồi mọi token cũ
  scope: TokenScope;
  iat: number; // giây
  exp: number; // giây
  sid?: string; // auth_sessions.id — có thì phiên phải còn hiệu lực (đăng xuất thu hồi ngay)
  rem?: boolean; // "Ghi nhớ đăng nhập" — token thiết lập 2FA mang sang bước xác nhận
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Ký JWT HS256 (chỉ hỗ trợ đúng một thuật toán để tránh tấn công đổi `alg`). */
export function signJwt(claims: AccessClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${HEADER}.${payload}.${sign(`${HEADER}.${payload}`, secret)}`;
}

/** Kiểm tra chữ ký, header và hạn dùng. Sai bất kỳ điều gì → null. */
export function verifyJwt(token: string, secret: string, nowSeconds: number): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  if (header !== HEADER) return null;
  const expected = Buffer.from(sign(`${header}.${payload}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const c = claims as Partial<AccessClaims>;
  if (
    typeof c.sub !== 'string' ||
    !Number.isInteger(c.ver) ||
    (c.scope !== 'full' && c.scope !== 'mfa_setup') ||
    !Number.isInteger(c.iat) ||
    !Number.isInteger(c.exp) ||
    (c.sid !== undefined && typeof c.sid !== 'string') ||
    (c.rem !== undefined && typeof c.rem !== 'boolean')
  ) {
    return null;
  }
  if (c.exp! <= nowSeconds || c.iat! > nowSeconds + 60) return null;
  return c as AccessClaims;
}
