/**
 * Test tái hiện các phát hiện của vòng rà soát subagent T5b. Xem bảng trong task.md.
 */
import { AbuseConfig } from '../src/abuse/abuse-config';
import { NotConfiguredSmsSender } from '../src/abuse/sms-sender';
import { AuthConfig, AuthService } from '../src/auth/auth.service';
import { SecretBox } from '../src/auth/totp';
import { UsersService } from '../src/auth/users.service';
import { OperatorsService } from '../src/operators/operators.service';
import { AUTH_SECRET, buildServices, errorCode, newKey, resetDatabase, seedOperatorWithTrips, Services, T0 } from './helpers';

const LIMITS: Partial<AbuseConfig> = {
  bookingsPerIpPerMinute: 3,
  bookingsPerPhonePerHour: 1000,
  otpResendSeconds: 60,
  otpPerPhonePerHour: 50,
  otpPerIpPerHour: 1000,
  loginsPerIpPer15Min: 1000,
};
const POLICY = { holdMinutes: 10, maxUnitsPerBooking: 5, childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false } };

let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let auth: AuthService;
let phoneSeq = 500;
const freshPhone = () => `09124${String(phoneSeq++).padStart(5, '0')}`;

beforeAll(async () => {
  await resetDatabase();
  s = buildServices(undefined, LIMITS);
  seed = await seedOperatorWithTrips(s, 'PN');
  auth = new AuthService(s.db, s.clock, new AuthConfig(AUTH_SECRET), new SecretBox(AUTH_SECRET), s.limiter, new AbuseConfig(LIMITS));
});
afterAll(() => s.db.close());
beforeEach(() => s.clock.set(new Date(T0.getTime() + (phoneSeq - 500) * 3600_000)));

describe('policy update keeps peak settings that are not sent', () => {
  it('a PUT without the new fields does not turn peak mode off or reset the hold cap', async () => {
    await s.operators.updatePolicy(seed.op.id, { ...POLICY, maxActiveHoldsPerPhone: 1, requirePhoneOtp: true });
    const p = await s.operators.updatePolicy(seed.op.id, { ...POLICY, holdMinutes: 15 });
    expect(p).toMatchObject({ holdMinutes: 15, requirePhoneOtp: true, maxActiveHoldsPerPhone: 1 });
    await s.operators.updatePolicy(seed.op.id, { ...POLICY, maxActiveHoldsPerPhone: 20, requirePhoneOtp: false });
  });

  it('refuses to enable phone OTP when no SMS provider is configured', async () => {
    const noSms = new OperatorsService(s.db, s.layouts, new NotConfiguredSmsSender());
    expect(await errorCode(noSms.updatePolicy(seed.op.id, { ...POLICY, requirePhoneOtp: true }))).toBe('VALIDATION_FAILED');
    expect((await s.operators.currentPolicy(seed.op.id)).requirePhoneOtp).toBe(false);
  });
});

describe('OTP sending', () => {
  it('is refused for an operator that is not in peak mode (no SMS cost for nothing)', async () => {
    const before = s.sms.sent.length;
    expect(await errorCode(s.phones.start({ operatorCode: 'PN', phone: freshPhone() }, '1.1.1.1'))).toBe('VALIDATION_FAILED');
    expect(s.sms.sent.length).toBe(before);
  });

  it('enforces the resend gap even across a minute boundary and for parallel requests', async () => {
    await s.operators.updatePolicy(seed.op.id, { ...POLICY, maxActiveHoldsPerPhone: 20, requirePhoneOtp: true });
    try {
      const phone = freshPhone();
      const minute = Math.ceil(s.clock.now().getTime() / 60_000) * 60_000;
      s.clock.set(new Date(minute - 100));
      await s.phones.start({ operatorCode: 'PN', phone }, '1.1.1.1');
      s.clock.set(new Date(minute + 100));
      expect(await errorCode(s.phones.start({ operatorCode: 'PN', phone }, '1.1.1.1'))).toBe('TOO_MANY_ATTEMPTS');

      const other = freshPhone();
      s.clock.advanceMinutes(5);
      const parallel = await Promise.all(Array.from({ length: 5 }, () => errorCode(s.phones.start({ operatorCode: 'PN', phone: other }, '1.1.1.1'))));
      expect(parallel.filter((r) => r === 'NO_ERROR')).toHaveLength(1);
    } finally {
      await s.operators.updatePolicy(seed.op.id, { ...POLICY, maxActiveHoldsPerPhone: 20, requirePhoneOtp: false });
    }
  });
});

describe('client IP keys', () => {
  it('groups IPv6 addresses by /64 so rotating addresses does not bypass the limit', async () => {
    const results: string[] = [];
    for (let i = 1; i <= 4; i++) {
      results.push(
        await errorCode(
          s.bookings.createHold(
            { tripId: seed.bedTrip.id, contactName: 'A', contactPhone: freshPhone(), items: [{ seatCode: `C${i}` }] },
            newKey(),
            { ip: `2001:db8:1:2::${i.toString(16)}` },
          ),
        ),
      );
    }
    expect(results).toEqual(['NO_ERROR', 'NO_ERROR', 'NO_ERROR', 'TOO_MANY_ATTEMPTS']);
  });

  it('treats ::ffff:1.2.3.4 and 1.2.3.4 as the same client', async () => {
    const results: string[] = [];
    for (const [i, ip] of ['1.2.3.4', '::ffff:1.2.3.4', '1.2.3.4', '::FFFF:1.2.3.4'].entries()) {
      results.push(
        await errorCode(
          s.bookings.createHold(
            { tripId: seed.bedTrip.id, contactName: 'A', contactPhone: freshPhone(), items: [{ seatCode: `B${i + 2}` }] },
            newKey(),
            { ip },
          ),
        ),
      );
    }
    expect(results[3]).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('idempotent retries', () => {
  it('a retry with the same Idempotency-Key gets its booking back even when the IP limit is used up', async () => {
    const key = newKey();
    const input = { tripId: seed.bedTrip.id, contactName: 'A', contactPhone: freshPhone(), items: [{ seatCode: 'D9' }] };
    const attempt = { ip: '5.5.5.5', retryToken: 'ab'.repeat(32) };
    const first = await s.bookings.createHold(input, key, attempt);
    const invalidAttempt = { ...attempt, retryToken: 'ba'.repeat(32) };
    for (let i = 0; i < 2; i++) {
      expect(await errorCode(s.bookings.createHold(input, key, invalidAttempt))).toBe('IDEMPOTENCY_CONFLICT');
    }
    expect(await errorCode(s.bookings.createHold(input, key, invalidAttempt))).toBe('TOO_MANY_ATTEMPTS');
    for (let i = 0; i < 5; i++) {
      const again = await s.bookings.createHold(input, key, attempt);
      expect(again).toMatchObject({ replayed: true, booking: { code: first.booking.code } });
    }
  });
});

describe('login does not reveal which phones are accounts', () => {
  it('a locked account answers exactly like an unknown phone', async () => {
    const phone = freshPhone();
    await new UsersService(s.db, s.clock).createStaff(seed.op.id, { fullName: 'B', phone, password: 'seller-password-1', role: 'SELLER' });
    for (let i = 0; i < 5; i++) await errorCode(auth.login({ phone, password: `wrong-${i}-password` }, '9.9.9.9'));
    const locked = await auth.login({ phone, password: 'seller-password-1' }, '9.9.9.9').catch((e) => e);
    const unknown = await auth.login({ phone: freshPhone(), password: 'seller-password-1' }, '9.9.9.9').catch((e) => e);
    expect([locked.code, locked.message, locked.details]).toEqual([unknown.code, unknown.message, unknown.details]);
    expect(locked.code).toBe('INVALID_CREDENTIALS');
    s.clock.advanceMinutes(15);
    await expect(auth.login({ phone, password: 'seller-password-1' }, '9.9.9.9')).resolves.toMatchObject({ scope: 'full' });
  });
});
