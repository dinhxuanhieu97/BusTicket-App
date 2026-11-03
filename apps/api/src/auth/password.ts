import { randomBytes, scrypt as scryptCb, ScryptOptions, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Băm mật khẩu bằng scrypt. Định dạng: `scrypt$N$r$p$saltB64$hashB64`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** So khớp mật khẩu với chuỗi băm; chuỗi băm sai định dạng → false (không ném lỗi). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n! > 0) || N! > 1 << 20) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  if (salt.length < 16 || expected.length !== KEYLEN) return false;
  const key = await scrypt(password, salt, KEYLEN, { N: N!, r: r!, p: p! });
  return timingSafeEqual(key, expected);
}

/** Chuỗi băm giả để so khớp khi không có tài khoản, giữ thời gian phản hồi giống nhau. */
export function dummyHash(): Promise<string> {
  dummyHash_ ??= hashPassword('dummy-password-for-timing');
  return dummyHash_;
}
let dummyHash_: Promise<string> | undefined;

export const PASSWORD_RULE = { min: 10, max: 128 };
