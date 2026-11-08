import { DomainError } from '../common/errors';
import { HttpZaloPhoneResolver, parseZaloSecretKeys } from './zalo-phone';

describe('parseZaloSecretKeys', () => {
  it('parses one secret per operator code', () => {
    expect(parseZaloSecretKeys(' PN=abc , XY=d=e ')).toEqual({ PN: 'abc', XY: 'd=e' });
  });

  it('treats a missing variable as no operators configured', () => {
    expect(parseZaloSecretKeys(undefined)).toEqual({});
    expect(parseZaloSecretKeys('')).toEqual({});
  });

  it.each(['PN', 'pn=abc', 'PN=', '=abc'])('rejects malformed entry %p', (raw) => {
    expect(() => parseZaloSecretKeys(raw)).toThrow(/ZALO_APP_SECRET_KEYS/);
  });
});

describe('HttpZaloPhoneResolver', () => {
  const okFetch = (body: unknown, ok = true) => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const impl = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return { ok, json: async () => body };
    };
    return { impl, calls };
  };

  it('sends access token, phone code and the operator secret to Zalo and returns the number', async () => {
    const f = okFetch({ error: 0, message: 'Success', data: { number: '84912345678' } });
    const r = new HttpZaloPhoneResolver({ PN: 'sk-pn' }, f.impl);
    await expect(r.resolve('PN', 'acc', 'tok')).resolves.toBe('84912345678');
    expect(f.calls).toEqual([
      { url: 'https://graph.zalo.me/v2.0/me/info', headers: { access_token: 'acc', code: 'tok', secret_key: 'sk-pn' } },
    ]);
  });

  it('is not configured for an operator without a secret and never calls Zalo', async () => {
    const f = okFetch({});
    const r = new HttpZaloPhoneResolver({ PN: 'sk' }, f.impl);
    expect(r.configured('PN')).toBe(true);
    expect(r.configured('XY')).toBe(false);
    await expect(r.resolve('XY', 'a', 'b')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(f.calls).toHaveLength(0);
  });

  it('maps a Zalo error (expired token, no consent) to a validation error', async () => {
    const r = new HttpZaloPhoneResolver({ PN: 'sk' }, okFetch({ error: -201, message: 'invalid' }).impl);
    const err = await r.resolve('PN', 'a', 'b').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('VALIDATION_FAILED');
    expect((err as DomainError).message).not.toContain('invalid');
  });

  it('maps network failure and HTTP errors to service unavailable', async () => {
    const down = new HttpZaloPhoneResolver({ PN: 'sk' }, async () => {
      throw new Error('ECONNRESET');
    });
    await expect(down.resolve('PN', 'a', 'b')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    const http500 = new HttpZaloPhoneResolver({ PN: 'sk' }, okFetch({}, false).impl);
    await expect(http500.resolve('PN', 'a', 'b')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});
