import { bookingAccessToken, bookingCode, randomCode, SAFE_ALPHABET, verifyBookingAccessToken } from './codes';
import { DomainError } from './errors';
import { normalizeVnPhone } from './phone';
import { vnDayRange } from './vn-time';

describe('normalizeVnPhone', () => {
  it.each([
    ['0912345678', '+84912345678'],
    ['0912 345 678', '+84912345678'],
    ['0912.345.678', '+84912345678'],
    ['84912345678', '+84912345678'],
    ['+84 912 345 678', '+84912345678'],
    [' (+84) 3-8888-7777 '.replace('(+84)', '+84'), '+84388887777'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeVnPhone(input)).toBe(expected);
  });

  it.each(['', '123', '091234567', '09123456789', '0212345678', '+1 415 555 0100', '84 0912345678', 'abc0912345678'])(
    'rejects %p with VALIDATION_FAILED',
    (input) => {
      expect(() => normalizeVnPhone(input)).toThrow(DomainError);
      try {
        normalizeVnPhone(input);
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_FAILED');
      }
    },
  );
});

describe('randomCode / bookingCode', () => {
  it('uses only unambiguous characters', () => {
    expect(SAFE_ALPHABET).not.toMatch(/[01OIL]/);
    const code = randomCode(200);
    expect(code).toHaveLength(200);
    expect(code).toMatch(new RegExp(`^[${SAFE_ALPHABET}]+$`));
  });

  it('prefixes the operator code and appends 6 characters', () => {
    const rng = () => 0;
    expect(bookingCode('PN', rng)).toBe('PNAAAAAA');
  });

  it('rejects non-positive lengths', () => {
    expect(() => randomCode(0)).toThrow(RangeError);
    expect(() => randomCode(1.5)).toThrow(RangeError);
  });
});

describe('booking access token', () => {
  const secret = 's'.repeat(32);

  it('verifies the token for the same booking and version', () => {
    const t = bookingAccessToken(secret, 'b1', 1);
    expect(verifyBookingAccessToken(secret, 'b1', 1, t)).toBe(true);
  });

  it('rejects tokens for another booking, a bumped version, or a different secret', () => {
    const t = bookingAccessToken(secret, 'b1', 1);
    expect(verifyBookingAccessToken(secret, 'b2', 1, t)).toBe(false);
    expect(verifyBookingAccessToken(secret, 'b1', 2, t)).toBe(false);
    expect(verifyBookingAccessToken('x'.repeat(32), 'b1', 1, t)).toBe(false);
    expect(verifyBookingAccessToken(secret, 'b1', 1, t.slice(1))).toBe(false);
  });
});

describe('vnDayRange', () => {
  it('maps a Vietnamese calendar day to [17:00 UTC previous day, 17:00 UTC)', () => {
    const { start, end } = vnDayRange('2027-02-01');
    expect(start.toISOString()).toBe('2027-01-31T17:00:00.000Z');
    expect(end.toISOString()).toBe('2027-02-01T17:00:00.000Z');
  });

  it.each(['2027-2-1', '01/02/2027', '2027-02-30', '2027-13-01', ''])('rejects %p', (d) => {
    expect(() => vnDayRange(d)).toThrow(DomainError);
  });
});
