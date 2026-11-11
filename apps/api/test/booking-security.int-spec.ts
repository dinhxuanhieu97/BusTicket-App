import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { Db, DbConfig } from '../src/db/db';
import {
  AUTH_SECRET, buildServices, newKey, newRetryToken, resetDatabase, seedOperatorWithTrips, Services, T0, TEST_DB_URL, TOKEN_SECRET,
} from './helpers';

let app: INestApplication;
let services: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
const phone = '0912345678';
const verifiedPhone = '+84912345678';
const startOtp = (number: string) => request(app.getHttpServer())
  .post('/api/v1/phone-verifications').send({ operatorCode: 'PN', phone: number });
const postHold = (key: string) => request(app.getHttpServer()).post('/api/v1/bookings').set('Idempotency-Key', key);
const hold = (seatCode: string) => ({
  tripId: seed.limoTrip.id, contactName: 'Test passenger', contactPhone: phone, items: [{ seatCode }],
});

beforeAll(async () => {
  await resetDatabase();
  const abuse = { phoneTokenTtlSeconds: 60 };
  services = buildServices(undefined, abuse);
  seed = await seedOperatorWithTrips(services, 'PN');
  const { operatorId, version, ...policy } = await services.operators.currentPolicy(seed.op.id);
  await services.operators.updatePolicy(seed.op.id, { ...policy, requirePhoneOtp: true });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET,
      clock: services.clock, abuse, smsSender: services.sms,
    })],
  }).overrideProvider(DbConfig).useValue(new DbConfig(TEST_DB_URL, 1)).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.get(Db).pool.options.connectionTimeoutMillis = 1_000;
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
});

beforeEach(() => services.clock.set(T0));

afterAll(async () => {
  await app?.close();
  await services?.db.close();
});

it('sends OTP and enforces the resend interval with one available database connection', async () => {
  const number = '0912345679';
  const responses = await Promise.all([startOtp(number), startOtp(number)]);
  expect(responses.map((response) => response.status).sort()).toEqual([201, 429]);
  expect(responses.find((response) => response.status === 429)?.headers['retry-after']).toBe('60');
  expect(services.sms.sent.filter((message) => message.phone === '+84912345679')).toHaveLength(1);
});

it.each(['items', 'returnLeg.items'])('rejects oversized %s before validating individual seats', async (field) => {
  const input = hold('A1');
  const items = Array(1_000).fill(0);
  const body = field === 'items' ? { ...input, items } : { ...input, returnLeg: { tripId: seed.bedTrip.id, items } };
  const response = await postHold(newKey()).send(body).expect(400);
  expect(response.body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field } });
});

it('rejects a body over the HTTP parser limit before booking validation', async () => {
  const response = await postHold(newKey()).send({ ...hold('A1'), note: 'x'.repeat(110 * 1024) }).expect(413);
  expect(response.body.error.code).toBe('HTTP_413');
});

it('rejects a malformed replay credential before accepting a hold', async () => {
  const response = await postHold(newKey()).set('X-Booking-Retry-Token', 'weak').send(hold('A1')).expect(400);
  expect(response.body.error.details).toEqual({ field: 'X-Booking-Retry-Token' });
});

it('recovers a lost response after OTP expiry only with the original replay credential', async () => {
  const key = newKey();
  const retryToken = newRetryToken();
  const phoneToken = services.phones.issueToken(seed.op.id, verifiedPhone).phoneToken;
  const input = hold('A1');
  const original = await postHold(key).set('X-Booking-Retry-Token', retryToken)
    .set('X-Phone-Token', phoneToken).send(input).expect(201);

  const keyOnly = await postHold(key).send(input).expect(409);
  const wrongSecret = await postHold(key).set('X-Booking-Retry-Token', newRetryToken())
    .set('X-Phone-Token', phoneToken).send(input).expect(409);
  for (const response of [keyOnly, wrongSecret]) {
    expect(response.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(response.body).not.toHaveProperty('accessToken');
  }

  services.clock.advanceMinutes(2);
  const retry = await postHold(key).set('X-Booking-Retry-Token', retryToken).send(input).expect(201);
  expect(retry.body).toMatchObject({
    booking: { code: original.body.booking.code, status: 'HOLDING', holdExpiresAt: original.body.booking.holdExpiresAt },
    accessToken: original.body.accessToken, replayed: true,
  });
  await postHold(newKey()).set('X-Booking-Retry-Token', retryToken).send(hold('A4')).expect(403);
});

it('replays a legacy hold only after verifying the original phone number for its operator', async () => {
  const key = newKey();
  const input = hold('A2');
  const phoneToken = services.phones.issueToken(seed.op.id, verifiedPhone).phoneToken;
  const original = await postHold(key).set('X-Phone-Token', phoneToken).send(input).expect(201);
  const wrongPhone = services.phones.issueToken(seed.op.id, '+84912345679').phoneToken;
  await postHold(key).set('X-Booking-Retry-Token', newRetryToken()).send(input).expect(409);
  await postHold(key).set('X-Phone-Token', wrongPhone).send(input).expect(409);
  const retry = await postHold(key).set('X-Phone-Token', phoneToken).send(input).expect(201);
  expect(retry.body).toMatchObject({ accessToken: original.body.accessToken, replayed: true });
});

it('serves concurrent retries from one hold when the API pool has a single connection', async () => {
  const key = newKey();
  const retryToken = newRetryToken();
  const phoneToken = services.phones.issueToken(seed.op.id, verifiedPhone).phoneToken;
  const input = hold('A3');
  const responses = await Promise.all(Array.from({ length: 3 }, () => postHold(key)
    .set('X-Booking-Retry-Token', retryToken).set('X-Phone-Token', phoneToken).send(input).expect(201)));
  expect(responses.filter((response) => !response.body.replayed)).toHaveLength(1);
  expect(new Set(responses.map((response) => response.body.booking.code)).size).toBe(1);
});

it('revokes checkout recovery when the booking access token is revoked', async () => {
  const key = newKey();
  const retryToken = newRetryToken();
  const phoneToken = services.phones.issueToken(seed.op.id, verifiedPhone).phoneToken;
  const input = hold('A5');
  const original = await postHold(key).set('X-Booking-Retry-Token', retryToken)
    .set('X-Phone-Token', phoneToken).send(input).expect(201);
  await services.db.query('UPDATE bookings SET access_token_version = access_token_version + 1 WHERE code = $1', [original.body.booking.code]);
  const replay = await postHold(key).set('X-Booking-Retry-Token', retryToken)
    .set('X-Phone-Token', phoneToken).send(input).expect(409);
  expect(replay.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  expect(replay.body).not.toHaveProperty('accessToken');
});
