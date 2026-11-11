import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { AUTH_SECRET, RELAXED_ABUSE, buildServices, resetDatabase, seedOperatorWithTrips, Services, T0, TEST_DB_URL, TOKEN_SECRET } from './helpers';

// Khách tự xóa họ tên, số điện thoại trong đơn đã xong (Thỏa thuận Zalo Mini App 5.3.3(d)).

let app: INestApplication;
let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let n = 0;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, abuse: RELAXED_ABUSE, clock: s.clock })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
});
afterAll(async () => {
  await app?.close();
  await s?.db.close();
});
beforeEach(() => s.clock.set(T0));

async function hold(seatCode: string) {
  n += 1;
  const res = await http()
    .post('/api/v1/bookings')
    .set('Idempotency-Key', `erase-contact-${String(n).padStart(4, '0')}`)
    .send({ tripId: seed.limoTrip.id, contactName: 'Trần Thị B', contactPhone: '0987654321', note: 'Đón ở cổng', items: [{ seatCode }] })
    .expect(201);
  return { code: res.body.booking.code as string, token: res.body.accessToken as string };
}
const erase = (code: string, token: string) =>
  http().post(`/api/v1/bookings/${code}/erase-contact`).set('X-Booking-Token', token);
const contactRow = async (code: string) =>
  (await s.db.query<{ contact_name: string; contact_phone: string; passenger_note: string | null; contact_erased_at: Date | null }>(
    'SELECT contact_name, contact_phone, passenger_note, contact_erased_at FROM bookings WHERE code = $1', [code],
  )).rows[0]!;

it('keeps contact on an active hold or an upcoming confirmed ticket', async () => {
  const a = await hold('A1');
  const res = await erase(a.code, a.token).expect(409);
  expect(res.body.error.code).toBe('CONFLICT');
  expect(res.body.error.message).toContain('Chuyến chưa khởi hành');
  await s.db.query(`UPDATE bookings SET status = 'CONFIRMED', hold_expires_at = NULL, release_at = NULL WHERE code = $1`, [a.code]);
  await erase(a.code, a.token).expect(409);
  expect(await contactRow(a.code)).toMatchObject({ contact_name: 'Trần Thị B', contact_erased_at: null });
});

it('keeps contact on a cancelled booking that still has money to reconcile', async () => {
  const a = await hold('A2');
  await s.db.query(`UPDATE bookings SET status = 'CANCELLED', paid_amount = 100000, payment_status = 'PARTIAL' WHERE code = $1`, [a.code]);
  const res = await erase(a.code, a.token).expect(409);
  expect(res.body.error.message).toContain('đối soát');
  expect((await contactRow(a.code)).contact_erased_at).toBeNull();
});

it('keeps contact of an expired or cancelled hold until departure, since a late transfer can still reinstate it', async () => {
  const a = await hold('A6');
  const b = await hold('A7');
  await http().post(`/api/v1/bookings/${b.code}/release`).set('X-Booking-Token', b.token).expect(200);
  await s.db.query(`UPDATE bookings SET release_at = $2 WHERE code = $1`, [a.code, T0]); // quá hạn nhả chỗ
  s.clock.advanceMinutes(1);
  for (const x of [a, b]) {
    const res = await erase(x.code, x.token).expect(409);
    expect(res.body.error.message).toContain('Chuyến chưa khởi hành');
  }
  expect((await contactRow(a.code)).contact_erased_at).toBeNull();
});

it('keeps contact of a paid ticket whose trip was cancelled (deposit to refund)', async () => {
  const a = await hold('A8');
  await s.db.query(
    `UPDATE bookings SET status = 'CONFIRMED', hold_expires_at = NULL, release_at = NULL, paid_amount = 100000, payment_status = 'PARTIAL' WHERE code = $1`,
    [a.code],
  );
  await s.db.query(`UPDATE trips SET status = 'CANCELLED' WHERE id = $1`, [seed.limoTrip.id]);
  try {
    s.clock.set(new Date('2027-02-01T11:30:00Z'));
    const res = await erase(a.code, a.token).expect(409);
    expect(res.body.error.message).toContain('đối soát');
  } finally {
    await s.db.query(`UPDATE trips SET status = 'OPEN' WHERE id = $1`, [seed.limoTrip.id]);
  }
});

it('erases name, phone and note of an unpaid cancelled booking after departure; repeat calls are idempotent', async () => {
  const a = await hold('A3');
  const other = await hold('A4');
  await http().post(`/api/v1/bookings/${a.code}/release`).set('X-Booking-Token', a.token).expect(200);
  const departed = new Date('2027-02-01T11:30:00Z');
  s.clock.set(departed);
  await erase(a.code, other.token).expect(404); // token của đơn khác
  await erase(a.code, 'x').expect(404);
  expect((await contactRow(a.code)).passenger_note).toBe('Đón ở cổng');
  const first = await erase(a.code, a.token).expect(200);
  expect(first.body).toEqual({ code: a.code, erasedAt: departed.toISOString() });
  expect(await contactRow(a.code)).toEqual({
    contact_name: 'Khách đã xóa thông tin', contact_phone: '', passenger_note: null, contact_erased_at: departed,
  });
  s.clock.advanceMinutes(5);
  expect((await erase(a.code, a.token).expect(200)).body.erasedAt).toBe(departed.toISOString());
  expect((await http().get(`/api/v1/bookings/${a.code}/contact`).set('X-Booking-Token', a.token).expect(200)).body)
    .toEqual({ name: '', phone: '' });
  await http().get(`/api/v1/bookings/${a.code}`).set('X-Booking-Token', a.token).expect(200);
  expect((await contactRow(other.code)).contact_name).toBe('Trần Thị B');
});

it('erases a completed booking even before the stored departure time', async () => {
  const a = await hold('A10');
  await s.db.query(`UPDATE bookings SET status = 'COMPLETED', hold_expires_at = NULL, release_at = NULL WHERE code = $1`, [a.code]);
  await erase(a.code, a.token).expect(200);
});

it('erases a confirmed ticket after the trip departed', async () => {
  const a = await hold('A5');
  await s.db.query(`UPDATE bookings SET status = 'CONFIRMED', hold_expires_at = NULL, release_at = NULL WHERE code = $1`, [a.code]);
  s.clock.set(new Date('2027-02-01T11:30:00Z'));
  await erase(a.code, a.token).expect(200);
  expect((await contactRow(a.code)).contact_phone).toBe('');
});
