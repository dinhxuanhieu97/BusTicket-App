import { redact } from './audit.service';

describe('redact', () => {
  it('drops sensitive keys at any depth and keeps the rest', () => {
    const out = redact({
      name: 'Xe 01',
      password: 'p',
      nested: { apiKey: 'k', mfaSecret: 's', keep: 1, deeper: [{ otp: '123456', ok: true }] },
      accessToken: 't',
      passwordHash: 'h',
    });
    expect(out).toEqual({ name: 'Xe 01', nested: { keep: 1, deeper: [{ ok: true }] } });
  });

  it('returns an empty object for undefined input', () => {
    expect(redact(undefined)).toEqual({});
  });

  it('truncates very deep structures instead of recursing forever', () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 10; i++) cur = (cur.a = {}) as Record<string, unknown>;
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
  });
});
