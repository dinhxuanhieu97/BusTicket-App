import { signJwt, verifyJwt } from './jwt';
import { hashPassword, verifyPassword } from './password';
import { can, MFA_REQUIRED_ROLES, OPERATOR_ASSIGNABLE_ROLES, PERMISSIONS, ROLE_PERMISSIONS, ROLES } from './permissions';
import { base32Decode, base32Encode, hotp, SecretBox, verifyTotp } from './totp';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$/);
    await expect(verifyPassword('correct horse battery', h)).resolves.toBe(true);
    await expect(verifyPassword('correct horse batterz', h)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });

  it.each(['', 'plain', 'bcrypt$1$2$3$4$5', 'scrypt$x$8$1$AAAA$BBBB', 'scrypt$16384$8$1$c2FsdA==$aGFzaA=='])(
    'returns false for a malformed stored hash %p',
    async (stored) => {
      await expect(verifyPassword('anything', stored)).resolves.toBe(false);
    },
  );
});

describe('JWT HS256', () => {
  const secret = 'k'.repeat(32);
  const claims = { sub: 'u1', ver: 1, scope: 'full' as const, iat: 1000, exp: 2000 };

  it('round-trips valid claims', () => {
    expect(verifyJwt(signJwt(claims, secret), secret, 1500)).toEqual(claims);
  });

  it('rejects an expired token and a token issued in the future', () => {
    expect(verifyJwt(signJwt(claims, secret), secret, 2000)).toBeNull();
    expect(verifyJwt(signJwt({ ...claims, iat: 1700, exp: 9999 }, secret), secret, 1500)).toBeNull();
  });

  it('rejects a wrong secret or a tampered payload', () => {
    const t = signJwt(claims, secret);
    expect(verifyJwt(t, 'x'.repeat(32), 1500)).toBeNull();
    const [h, , s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: 'admin' })).toString('base64url');
    expect(verifyJwt(`${h}.${forged}.${s}`, secret, 1500)).toBeNull();
  });

  it('rejects alg=none and other headers', () => {
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    expect(verifyJwt(`${none}.${payload}.`, secret, 1500)).toBeNull();
  });

  it('rejects garbage and claims with wrong types or scope', () => {
    expect(verifyJwt('a.b', secret, 1500)).toBeNull();
    expect(verifyJwt('not-a-token', secret, 1500)).toBeNull();
    expect(verifyJwt(signJwt({ ...claims, scope: 'root' as never }, secret), secret, 1500)).toBeNull();
    expect(verifyJwt(signJwt({ ...claims, ver: '1' as never }, secret), secret, 1500)).toBeNull();
  });
});

describe('TOTP (RFC 4226 / 6238)', () => {
  const rfcSecret = Buffer.from('12345678901234567890');

  it('matches the RFC 4226 HOTP test vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expect(expected.map((_, i) => hotp(rfcSecret, i))).toEqual(expected);
  });

  it('matches the RFC 6238 SHA1 vector at T=59 (8 digits)', () => {
    expect(hotp(rfcSecret, Math.floor(59 / 30), 8)).toBe('94287082');
  });

  it('round-trips base32', () => {
    const b = Buffer.from('any binary \x00\xff data');
    expect(base32Decode(base32Encode(b))).toEqual(b);
    expect(base32Encode(rfcSecret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(() => base32Decode('abc1')).toThrow();
  });

  it('accepts the current code and ±1 step, rejects others and reused steps', () => {
    const secret = base32Encode(rfcSecret);
    const now = 1_700_000_000;
    const step = Math.floor(now / 30);
    expect(verifyTotp(secret, hotp(rfcSecret, step), now, null)).toBe(step);
    expect(verifyTotp(secret, hotp(rfcSecret, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, hotp(rfcSecret, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(secret, hotp(rfcSecret, step - 2), now, null)).toBeNull();
    expect(verifyTotp(secret, hotp(rfcSecret, step), now, step)).toBeNull();
    expect(verifyTotp(secret, '12345', now, null)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now, null)).toBeNull();
  });
});

describe('SecretBox', () => {
  it('encrypts so that only the same master secret can decrypt', () => {
    const box = new SecretBox('m'.repeat(32));
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => new SecretBox('n'.repeat(32)).open(sealed)).toThrow();
  });

  it('detects tampering', () => {
    const box = new SecretBox('m'.repeat(32));
    const [v, iv, tag, enc] = box.seal('secret').split('.');
    const flipped = Buffer.from(enc!, 'base64');
    flipped[0]! ^= 1;
    expect(() => box.open([v, iv, tag, flipped.toString('base64')].join('.'))).toThrow();
  });
});

describe('role permissions', () => {
  it('only the platform admin can create operators or edit the shared layout library', () => {
    for (const role of ROLES) {
      expect(can(role, 'operator.create')).toBe(role === 'PLATFORM_ADMIN');
      expect(can(role, 'layout.library.write')).toBe(role === 'PLATFORM_ADMIN');
    }
  });

  it('sellers and accountants are read-only on fleet and trips', () => {
    for (const role of ['SELLER', 'ACCOUNTANT'] as const) {
      expect(can(role, 'trip.read')).toBe(true);
      expect(can(role, 'trip.write')).toBe(false);
      expect(can(role, 'fleet.write')).toBe(false);
      expect(can(role, 'user.manage')).toBe(false);
    }
  });

  it('assistants have no admin permissions yet', () => {
    expect(PERMISSIONS.filter((p) => can('ASSISTANT', p))).toEqual([]);
  });

  it('requires 2FA for owners, accountants and platform admins', () => {
    expect([...MFA_REQUIRED_ROLES].sort()).toEqual(['ACCOUNTANT', 'OWNER', 'PLATFORM_ADMIN']);
  });

  it('never lets operators assign the platform admin role', () => {
    expect(OPERATOR_ASSIGNABLE_ROLES.has('PLATFORM_ADMIN')).toBe(false);
  });

  it('every role entry only uses known permissions', () => {
    for (const set of Object.values(ROLE_PERMISSIONS)) for (const p of set) expect(PERMISSIONS).toContain(p);
  });
});
