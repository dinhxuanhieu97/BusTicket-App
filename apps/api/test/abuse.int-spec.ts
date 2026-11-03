/**
 * T5b — chống giữ chỗ ảo mùa cao điểm: giới hạn tần suất theo IP/SĐT, số đơn đang giữ mỗi SĐT,
 * OTP xác thực SĐT khi bật chế độ cao điểm, giới hạn đăng nhập theo IP.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AbuseConfig } from '../src/abuse/abuse-config';
import { CapturingSmsSender } from '../src/abuse/sms-sender';
import { AppModule } from '../src/app.module';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import {
  AUTH_SECRET, buildServices, errorCode, newKey, resetDatabase, seedOperatorWithTrips, Services, T0, TEST_DB_URL, TOKEN_SECRET,
} from './helpers';

const LIMITS: Partial<AbuseConfig> = {
  bookingsPerIpPerMinute: 4,
  bookingsPerPhonePerHour: 6,
  otpResendSeconds: 60,
  otpPerPhonePerHour: 3,
  otpPerIpPerHour: 50,
  otpTtlSeconds: 300,
  otpMaxAttempts: 3,
  phoneTokenTtlSeconds: 1800,
  loginsPerIpPer15Min: 5,
};

let app: INestApplication;
let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
const sms = new CapturingSmsSender();
const http = () => request(app.getHttpServer());

let phoneSeq = 100;
/** SĐT riêng cho từng kịch bản để các giới hạn theo SĐT không ảnh hưởng nhau. */
const freshPhone = () => `09123${String(phoneSeq++).padStart(5, '0')}`;
const norm = (p: string) => `+84${p.slice(1)}`;

const POLICY = { holdMinutes: 10, maxUnitsPerBooking: 5, childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false } };

beforeAll(async () => {
  await resetDatabase();
  s = buildServices(undefined, LIMITS);
  seed = await seedOperatorWithTrips(s, 'PN');
  await s.operators.updatePolicy(seed.op.id, { ...POLICY, maxActiveHoldsPerPhone: 2 });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET,
      clock: s.clock, abuse: LIMITS, smsSender: sms,
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
});
afterAll(async () => {
  await app.close();
  await s.db.close();
});
beforeEach(() => {
  // Mỗi kịch bản ở một khung giờ mới để bộ đếm theo cửa sổ thời gian không cộng dồn.
  s.clock.set(new Date(T0.getTime() + phoneSeq * 3600_000));
});

const holdBody = (seatCode: string, phone: string, tripId = seed.bedTrip.id) => ({
  tripId, contactName: 'Khách', contactPhone: phone, items: [{ seatCode }],
});

describe('rate limit by IP on POST /bookings', () => {
  it('rejects the 5th request in a minute from the same IP with 429 and Retry-After, then recovers', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await http().post('/api/v1/bookings').set('Idempotency-Key', newKey()).send(holdBody(`C${i + 1}`, freshPhone()));
      codes.push(r.status);
      if (r.status === 429) {
        expect(r.body.error.code).toBe('TOO_MANY_ATTEMPTS');
        expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
      }
    }
    expect(codes).toEqual([201, 201, 201, 201, 429]);
    s.clock.advanceMinutes(1);
    await http().post('/api/v1/bookings').set('Idempotency-Key', newKey()).send(holdBody('C6', freshPhone())).expect(201);
  });

  it('does not trust a spoofed X-Forwarded-For header (no trust proxy configured)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await http()
        .post('/api/v1/bookings')
        .set('X-Forwarded-For', `10.0.0.${i}`)
        .set('Idempotency-Key', newKey())
        .send(holdBody(`C${i + 7}`.replace('C11', 'D1').replace('C10', 'C10'), freshPhone()));
      codes.push(r.status);
    }
    expect(codes[4]).toBe(429);
  });
});

describe('rate limit by phone', () => {
  it('limits holds per phone per hour within an operator', async () => {
    const phone = freshPhone();
    const results: string[] = [];
    for (let i = 0; i < 7; i++) {
      // Hết hạn ngay từng đơn để không chạm giới hạn "đơn đang giữ" (kiểm tra riêng bên dưới).
      results.push(await errorCode(s.bookings.createHold(holdBody(`A${i + 1}`, phone), newKey())));
      await s.db.query("UPDATE bookings SET status = 'EXPIRED' WHERE contact_phone = $1 AND status = 'HOLDING'", [norm(phone)]);
      await s.db.query(
        `UPDATE trip_seats SET booking_id = NULL WHERE booking_id IN (SELECT id FROM bookings WHERE contact_phone = $1)`,
        [norm(phone)],
      );
    }
    expect(results).toEqual(['NO_ERROR', 'NO_ERROR', 'NO_ERROR', 'NO_ERROR', 'NO_ERROR', 'NO_ERROR', 'TOO_MANY_ATTEMPTS']);
  });
});

describe('active holds per phone', () => {
  it('allows at most maxActiveHoldsPerPhone unpaid holds, across trips', async () => {
    const phone = freshPhone();
    await s.bookings.createHold(holdBody('B1', phone), newKey());
    await s.bookings.createHold(holdBody('B1', phone, seed.limoTrip.id), newKey());
    const third = s.bookings.createHold(holdBody('B3', phone), newKey());
    expect(await errorCode(third)).toBe('LIMIT_EXCEEDED');
    expect((await s.trips.seatMap(seed.bedTrip.id)).seats.find((x) => x.code === 'B3')!.status).toBe('AVAILABLE');
  });

  it('frees a slot once a hold expires', async () => {
    const phone = freshPhone();
    await s.bookings.createHold(holdBody('B5', phone), newKey());
    await s.bookings.createHold(holdBody('B7', phone), newKey());
    s.clock.advanceMinutes(10);
    await s.bookings.createHold(holdBody('B9', phone), newKey());
  });

  it('holds the cap under concurrency: 10 parallel holds for one phone on two trips → at most 2 succeed', async () => {
    const phone = freshPhone();
    const attempts = [2, 3, 4, 5, 6].flatMap((n) => [
      s.bookings.createHold(holdBody(`D${n}`, phone), newKey()),
      s.bookings.createHold(holdBody(`A${2 * n - 2}`, phone, seed.limoTrip.id), newKey()),
    ]);
    const results = await Promise.all(attempts.map((p) => errorCode(p)));
    expect(results.filter((r) => r === 'NO_ERROR').length).toBeLessThanOrEqual(2);
    expect(results.filter((r) => r === 'NO_ERROR').length).toBeGreaterThanOrEqual(1);
    const { rows } = await s.db.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM bookings WHERE contact_phone = $1 AND status = 'HOLDING'",
      [norm(phone)],
    );
    expect(rows[0]!.n).toBeLessThanOrEqual(2);
  });

  it('an idempotent replay is not blocked by the cap', async () => {
    const phone = freshPhone();
    const key = newKey();
    await s.bookings.createHold(holdBody('A8', phone), key);
    await s.bookings.createHold(holdBody('A10', phone), newKey());
    const replay = await s.bookings.createHold(holdBody('A8', phone), key);
    expect(replay.replayed).toBe(true);
  });
});

describe('peak mode: phone OTP', () => {
  beforeAll(async () => {
    await s.operators.updatePolicy(seed.op.id, { ...POLICY, maxActiveHoldsPerPhone: 2, requirePhoneOtp: true });
  });
  afterAll(async () => {
    await s.operators.updatePolicy(seed.op.id, { ...POLICY, maxActiveHoldsPerPhone: 2, requirePhoneOtp: false });
  });

  async function otpFor(phone: string) {
    const start = await http().post('/api/v1/phone-verifications').send({ operatorCode: 'PN', phone }).expect(201);
    return { id: start.body.verificationId as string, code: sms.lastCodeFor(norm(phone))! };
  }

  it('the seat map tells the client that OTP is required', async () => {
    const r = await http().get(`/api/v1/trips/${seed.bedTrip.id}/seats`).expect(200);
    expect(r.body.booking).toMatchObject({ requiresPhoneOtp: true, maxUnitsPerBooking: 5, holdMinutes: 10 });
  });

  it('rejects a hold without a phone token', async () => {
    const r = await http().post('/api/v1/bookings').set('Idempotency-Key', newKey()).send(holdBody('C2', freshPhone())).expect(403);
    expect(r.body.error.code).toBe('PHONE_VERIFICATION_REQUIRED');
  });

  it('OTP → token → hold succeeds only for the verified phone', async () => {
    const phone = freshPhone();
    const { id, code } = await otpFor(phone);
    expect(sms.sent.at(-1)!.text).toContain('Nhà xe PN');
    const v = await http().post('/api/v1/phone-verifications/verify').send({ verificationId: id, code }).expect(200);
    const token = v.body.phoneToken as string;
    await http()
      .post('/api/v1/bookings').set('Idempotency-Key', newKey()).set('X-Phone-Token', token)
      .send(holdBody('C4', freshPhone()))
      .expect(403);
    await http()
      .post('/api/v1/bookings').set('Idempotency-Key', newKey()).set('X-Phone-Token', token)
      .send(holdBody('C4', phone.replace(/^0/, '+84 ')))
      .expect(201);
  });

  it('a code works once; a tampered or expired token is rejected', async () => {
    const phone = freshPhone();
    const { id, code } = await otpFor(phone);
    const v = await http().post('/api/v1/phone-verifications/verify').send({ verificationId: id, code }).expect(200);
    await http().post('/api/v1/phone-verifications/verify').send({ verificationId: id, code }).expect(400);
    const token = v.body.phoneToken as string;
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ op: seed.op.id, phone: norm(freshPhone()), exp: 9_999_999_999 })).toString('base64url');
    expect(s.phones.verifyToken(`${forged}.${sig}`, seed.op.id, norm(phone))).toBe(false);
    expect(s.phones.verifyToken(`${payload}.${sig}`, seed.op.id, norm(phone))).toBe(true);
    expect(s.phones.verifyToken(token, '00000000-0000-4000-8000-000000000000', norm(phone))).toBe(false);
    s.clock.advanceMinutes(31);
    expect(s.phones.verifyToken(token, seed.op.id, norm(phone))).toBe(false);
  });

  it('locks a code after too many wrong attempts, even if the right code comes later', async () => {
    const phone = freshPhone();
    const { id, code } = await otpFor(phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) await http().post('/api/v1/phone-verifications/verify').send({ verificationId: id, code: wrong }).expect(400);
    await http().post('/api/v1/phone-verifications/verify').send({ verificationId: id, code }).expect(400);
  });

  it('parallel wrong guesses cannot exceed the attempt limit', async () => {
    const phone = freshPhone();
    const { id, code } = await otpFor(phone);
    const guesses = Array.from({ length: 20 }, (_, i) => String(i).padStart(6, '0')).filter((g) => g !== code);
    await Promise.all(guesses.map((g) => http().post('/api/v1/phone-verifications/verify').send({ verificationId: id, code: g })));
    const { rows } = await s.db.query<{ attempts: number }>('SELECT attempts FROM phone_verifications WHERE id = $1', [id]);
    expect(rows[0]!.attempts).toBe(3);
  });

  it('expires codes after the TTL', async () => {
    const phone = freshPhone();
    const { id, code } = await otpFor(phone);
    s.clock.advanceMinutes(6);
    await http().post('/api/v1/phone-verifications/verify').send({ verificationId: id, code }).expect(400);
  });

  it('limits OTP sending: one per minute per phone, 3 per hour', async () => {
    const phone = freshPhone();
    await otpFor(phone);
    const again = await http().post('/api/v1/phone-verifications').send({ operatorCode: 'PN', phone }).expect(429);
    expect(again.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    s.clock.advanceMinutes(1);
    await otpFor(phone);
    s.clock.advanceMinutes(1);
    await otpFor(phone);
    s.clock.advanceMinutes(1);
    await http().post('/api/v1/phone-verifications').send({ operatorCode: 'PN', phone }).expect(429);
  });

  it('never stores the code in clear text and rejects malformed input', async () => {
    const phone = freshPhone();
    const { id, code } = await otpFor(phone);
    const { rows } = await s.db.query<{ code_hash: string }>('SELECT code_hash FROM phone_verifications WHERE id = $1', [id]);
    expect(rows[0]!.code_hash).not.toContain(code);
    await http().post('/api/v1/phone-verifications/verify').send({ verificationId: 'nope', code }).expect(400);
    await http().post('/api/v1/phone-verifications').send({ operatorCode: 'ZZ', phone }).expect(404);
    await http().post('/api/v1/phone-verifications').send({ operatorCode: 'PN', phone: '123' }).expect(400);
  });
});

describe('peak mode needs an SMS provider', () => {
  it('returns 503 SERVICE_UNAVAILABLE when no SMS provider is configured', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot({ databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, clock: s.clock, abuse: LIMITS })],
    }).compile();
    const bare = moduleRef.createNestApplication({ logger: false });
    bare.useGlobalFilters(new HttpErrorFilter());
    await bare.init();
    try {
      const r = await request(bare.getHttpServer()).post('/api/v1/phone-verifications').send({ operatorCode: 'PN', phone: freshPhone() }).expect(503);
      expect(r.body.error.code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      await bare.close();
    }
  });
});

describe('login rate limit by IP', () => {
  it('blocks the 6th login attempt in 15 minutes from one IP, across different phones', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await http().post('/api/v1/auth/login').send({ phone: freshPhone(), password: 'whatever-123' });
      codes.push(r.status);
    }
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });
});
