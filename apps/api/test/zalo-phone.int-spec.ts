/**
 * Lấy SĐT từ Zalo Mini App (`getPhoneNumber`): đổi token lấy số, số do Zalo xác nhận được dùng thay OTP.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AbuseConfig } from '../src/abuse/abuse-config';
import { FakeZaloPhoneResolver } from '../src/abuse/zalo-phone';
import { AppModule } from '../src/app.module';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import {
  AUTH_SECRET, buildServices, newKey, resetDatabase, seedOperatorWithTrips, Services, TEST_DB_URL, TOKEN_SECRET,
} from './helpers';

const LIMITS: Partial<AbuseConfig> = {
  bookingsPerIpPerMinute: 100,
  bookingsPerPhonePerHour: 100,
  zaloPhonePerIpPerHour: 3,
  phoneTokenTtlSeconds: 1800,
};
const POLICY = {
  holdMinutes: 10, maxUnitsPerBooking: 5, maxActiveHoldsPerPhone: 5, requirePhoneOtp: true,
  childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false },
};

let app: INestApplication;
let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
const zalo = new FakeZaloPhoneResolver();
const http = () => request(app.getHttpServer());
const exchange = (body: object, ip = '203.0.113.1') =>
  http().post('/api/v1/zalo/phone').set('X-Forwarded-For', ip).send(body);

const holdBody = (seat: string, phone: string) => ({
  tripId: seed.bedTrip.id,
  contactName: 'Khách Zalo',
  contactPhone: phone,
  items: [{ seatCode: seat }],
});

beforeAll(async () => {
  await resetDatabase();
  s = buildServices(undefined, LIMITS);
  seed = await seedOperatorWithTrips(s, 'PN');
  await s.operators.create({ code: 'NOZL', name: 'Nhà xe chưa cấu hình Zalo' });
  await s.operators.updatePolicy(seed.op.id, POLICY);
  zalo.numbers.set('code-a', '84912000001');
  zalo.numbers.set('code-b', '84912000002');
  zalo.numbers.set('code-foreign', '14155550100');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET,
      clock: s.clock, abuse: LIMITS, zaloPhoneResolver: zalo,
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
});
afterAll(async () => {
  await app.close();
  await s.db.close();
});

describe('POST /api/v1/zalo/phone', () => {
  it('returns the Zalo phone in local format with a phone token that replaces OTP', async () => {
    const r = await exchange({ operatorCode: 'PN', accessToken: 'acc', code: 'code-a' }).expect(200);
    expect(r.body.phone).toBe('0912000001');
    expect(zalo.calls.at(-1)).toEqual({ operatorCode: 'PN', accessToken: 'acc', code: 'code-a' });

    // Chế độ cao điểm: không có token → bị chặn; có token Zalo → giữ chỗ được.
    await http().post('/api/v1/bookings').set('Idempotency-Key', newKey())
      .send(holdBody('C2', '0912000001')).expect(403);
    await http().post('/api/v1/bookings').set('Idempotency-Key', newKey()).set('X-Phone-Token', r.body.phoneToken)
      .send(holdBody('C2', '0912 000 001')).expect(201);
  });

  it('the token only covers the phone Zalo confirmed', async () => {
    const r = await exchange({ operatorCode: 'PN', accessToken: 'acc', code: 'code-b' }, '203.0.113.2').expect(200);
    const res = await http().post('/api/v1/bookings').set('Idempotency-Key', newKey()).set('X-Phone-Token', r.body.phoneToken)
      .send(holdBody('C4', '0912000009')).expect(403);
    expect(res.body.error.code).toBe('PHONE_VERIFICATION_REQUIRED');
  });

  it('rejects an invalid Zalo token and a non-Vietnamese number', async () => {
    const bad = await exchange({ operatorCode: 'PN', accessToken: 'acc', code: 'unknown' }, '203.0.113.3').expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    const foreign = await exchange({ operatorCode: 'PN', accessToken: 'acc', code: 'code-foreign' }, '203.0.113.3').expect(400);
    expect(foreign.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('validates input, unknown operator and operator without a Zalo secret', async () => {
    await exchange({ operatorCode: 'PN', accessToken: '', code: 'x' }, '203.0.113.4').expect(400);
    await exchange({ operatorCode: 'PN', accessToken: 'a', code: 'x', extra: 1 }, '203.0.113.4').expect(400);
    await exchange({ operatorCode: 'ZZ', accessToken: 'a', code: 'x' }, '203.0.113.4').expect(404);
    const r = await exchange({ operatorCode: 'NOZL', accessToken: 'a', code: 'code-a' }, '203.0.113.4').expect(503);
    expect(r.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('limits attempts per IP', async () => {
    const ip = '198.51.100.7';
    for (let i = 0; i < 3; i++) await exchange({ operatorCode: 'PN', accessToken: 'a', code: 'code-a' }, ip).expect(200);
    const r = await exchange({ operatorCode: 'PN', accessToken: 'a', code: 'code-a' }, ip).expect(429);
    expect(r.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });
});
