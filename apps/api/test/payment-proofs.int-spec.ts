import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { TRANSFER_CLAIM_EXTENSION_MS } from '../src/bookings/payment-proofs.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import {
  AUTH_SECRET, buildServices, newKey, RELAXED_ABUSE, resetDatabase, seedOperatorWithTrips, Services, T0, TEST_DB_URL, TOKEN_SECRET,
} from './helpers';

// Khách báo "đã chuyển khoản" kèm ảnh lệnh chuyển; nhà xe xem ảnh để đối chiếu. Lần đầu gia hạn giữ chỗ tối đa 2 giờ.

let s: Services;
let app: INestApplication;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let other: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let ownerToken: string;
let assistantToken: string;
let otherOwnerToken: string;
let phoneSeq = 100;
const LIMO_CLOSE = new Date('2027-02-01T10:00:00Z'); // giờ đóng bán chuyến Limousine trong seedOperatorWithTrips

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, n)]);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const http = () => request(app.getHttpServer());
const binary = (r: request.Test) => r.buffer(true).parse((res, cb) => {
  const parts: Buffer[] = [];
  res.on('data', (c: Buffer) => parts.push(c));
  res.on('end', () => cb(null, Buffer.concat(parts)));
});
const submit = (code: string, token: string | undefined, data: Buffer, type = 'image/jpeg') => {
  const r = http().post(`/api/v1/bookings/${code}/payment-proofs`).set('Content-Type', type);
  return (token === undefined ? r : r.set('X-Booking-Token', token)).send(data);
};

async function hold(tripId = seed.limoTrip.id, seat = 'A1') {
  const res = await s.bookings.createHold(
    { tripId, contactName: 'Khách', contactPhone: `09137${String(phoneSeq++).padStart(5, '0')}`, items: [{ seatCode: seat }] },
    newKey(),
  );
  return { code: res.booking.code, token: res.accessToken, booking: res.booking };
}

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  other = await seedOperatorWithTrips(s, 'AB');
  const users = new UsersService(s.db, s.clock);
  await users.createStaff(seed.op.id, { fullName: 'Chủ', role: 'OWNER', phone: '0907100001', password: 'owner-password-1' });
  await users.createStaff(seed.op.id, { fullName: 'Phụ xe', role: 'ASSISTANT', phone: '0907100002', password: 'assist-password-1' });
  await users.createStaff(other.op.id, { fullName: 'Chủ khác', role: 'OWNER', phone: '0907100003', password: 'other-password-1' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, abuse: RELAXED_ABUSE, clock: s.clock,
      authRequireMfa: false,
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  const login = (phone: string, password: string) => http().post('/api/v1/auth/login').send({ phone, password }).expect(200);
  ownerToken = (await login('0907100001', 'owner-password-1')).body.accessToken;
  assistantToken = (await login('0907100002', 'assist-password-1')).body.accessToken;
  otherOwnerToken = (await login('0907100003', 'other-password-1')).body.accessToken;
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

beforeEach(() => s.clock.set(T0));

it('first proof marks the transfer claim and extends the hold by two hours; the view reports it', async () => {
  const h = await hold(seed.limoTrip.id, 'A1');
  expect(h.booking).toMatchObject({ transferClaimedAt: null, paymentProofCount: 0 });
  const before = new Date(h.booking.holdExpiresAt!).getTime();
  const graceMs = new Date(h.booking.releaseAt!).getTime() - before;

  const res = await submit(h.code, h.token, JPEG).expect(201);
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(res.body.duplicate).toBe(false);
  expect(res.body.proof).toMatchObject({ mime: 'image/jpeg', bytes: JPEG.length });
  const expected = T0.getTime() + TRANSFER_CLAIM_EXTENSION_MS;
  expect(new Date(res.body.booking.holdExpiresAt).getTime()).toBe(expected);
  // Ân hạn tiền về chậm giữ nguyên sau khi gia hạn.
  expect(new Date(res.body.booking.releaseAt).getTime()).toBe(expected + graceMs);
  expect(expected).toBeGreaterThan(before);
  expect(res.body.booking).toMatchObject({ status: 'HOLDING', transferClaimedAt: T0.toISOString(), paymentProofCount: 1 });

  // Ảnh thứ hai (chuyển thêm lần nữa) không gia hạn thêm.
  s.clock.advanceMinutes(30);
  const second = await submit(h.code, h.token, PNG, 'image/png').expect(201);
  expect(new Date(second.body.booking.holdExpiresAt).getTime()).toBe(expected);
  expect(second.body.booking).toMatchObject({ transferClaimedAt: T0.toISOString(), paymentProofCount: 2 });

  // Sau giờ hạn cũ (10 phút) chỗ vẫn được giữ.
  expect((await s.trips.seatMap(seed.limoTrip.id)).seats.find((x) => x.code === 'A1')!.status).toBe('HELD');
});

it('the same image twice is stored once; a booking accepts at most three images', async () => {
  const h = await hold(seed.limoTrip.id, 'A2');
  const first = await submit(h.code, h.token, jpeg(5)).expect(201);
  const again = await submit(h.code, h.token, jpeg(5)).expect(201);
  expect(again.body).toMatchObject({ duplicate: true, proof: { id: first.body.proof.id } });
  expect(again.body.booking.paymentProofCount).toBe(1);
  await submit(h.code, h.token, jpeg(6)).expect(201);
  await submit(h.code, h.token, jpeg(7)).expect(201);
  const over = await submit(h.code, h.token, jpeg(8)).expect(409);
  expect(over.body.error.code).toBe('CONFLICT');
});

it('the extension never passes the earliest sales close of the booking', async () => {
  // 20 phút trước giờ đóng bán chuyến Limousine (10:00Z): gia hạn chỉ tới đúng giờ đóng bán.
  s.clock.set(new Date(LIMO_CLOSE.getTime() - 20 * 60_000));
  const h = await hold(seed.limoTrip.id, 'B1');
  const res = await submit(h.code, h.token, JPEG).expect(201);
  expect(res.body.booking.holdExpiresAt).toBe(LIMO_CLOSE.toISOString());
});

it('rejects bad images, wrong tokens and bookings that are no longer held', async () => {
  const h = await hold(seed.limoTrip.id, 'B2');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  for (const [data, type] of [
    [svg, 'image/svg+xml'],
    [svg, 'image/png'],
    [JPEG, 'image/png'],
    [Buffer.alloc(0), 'image/jpeg'],
  ] as const) {
    const res = await submit(h.code, h.token, data, type).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  }
  await http().post(`/api/v1/bookings/${h.code}/payment-proofs`).set('X-Booking-Token', h.token).send({ proof: 'x' }).expect(400);
  await submit(h.code, undefined, JPEG).expect(404);
  // Thân quá lớn bị từ chối theo Content-Length trước khi đọc (máy chủ có thể đóng kết nối khi client còn gửi).
  const big = await submit(h.code, h.token, Buffer.concat([JPEG, Buffer.alloc(1_600_000)])).then(
    (r) => r.status, (e: NodeJS.ErrnoException) => e.code,
  );
  expect([400, 'EPIPE', 'ECONNRESET']).toContain(big);
  await submit(h.code, 'not-a-token', JPEG).expect(404);
  const otherBooking = await hold(seed.limoTrip.id, 'A5');
  await submit(h.code, otherBooking.token, JPEG).expect(404);

  s.clock.advanceMinutes(60); // giữ chỗ 10 phút đã hết (cả thời gian ân hạn)
  const expired = await submit(h.code, h.token, JPEG).expect(409);
  expect(expired.body.error.code).toBe('CONFLICT');
  const { rows } = await s.db.query('SELECT 1 FROM booking_payment_proofs bp JOIN bookings b ON b.id = bp.booking_id WHERE b.code = $1', [h.code]);
  expect(rows).toHaveLength(0);
});

it('operator staff with payment.read list and view the images; others cannot', async () => {
  const h = await hold(seed.limoTrip.id, 'A6');
  const up = await submit(h.code, h.token, JPEG).expect(201);
  const listPath = `/api/v1/admin/operators/${seed.op.id}/bookings/${h.code}/payment-proofs`;
  const list = await http().get(listPath).set(bearer(ownerToken)).expect(200);
  expect(list.body).toEqual({
    transferClaimedAt: T0.toISOString(),
    proofs: [{ id: up.body.proof.id, mime: 'image/jpeg', bytes: JPEG.length, createdAt: T0.toISOString() }],
  });

  const imgPath = `/api/v1/admin/operators/${seed.op.id}/payment-proofs/${up.body.proof.id}`;
  const img = await binary(http().get(imgPath).set(bearer(ownerToken))).expect(200);
  expect(img.headers['content-type']).toBe('image/jpeg');
  expect(img.headers['cache-control']).toBe('private, no-store');
  expect(img.headers['x-content-type-options']).toBe('nosniff');
  expect(img.headers['content-security-policy']).toContain('sandbox');
  expect(Buffer.compare(img.body as Buffer, JPEG)).toBe(0);

  await http().get(listPath).set(bearer(assistantToken)).expect(403);
  await http().get(imgPath).set(bearer(assistantToken)).expect(403);
  await http().get(imgPath).expect(401);
  // Chủ xe khác: không được mở nhà xe này, và tra đúng ảnh trong nhà xe mình cũng không thấy.
  await http().get(imgPath).set(bearer(otherOwnerToken)).expect(404);
  await http().get(`/api/v1/admin/operators/${other.op.id}/payment-proofs/${up.body.proof.id}`).set(bearer(otherOwnerToken)).expect(404);
  await http().get(`/api/v1/admin/operators/${other.op.id}/bookings/${h.code}/payment-proofs`).set(bearer(otherOwnerToken)).expect(404);
  await http().get(`/api/v1/admin/operators/${seed.op.id}/payment-proofs/not-a-uuid`).set(bearer(ownerToken)).expect(404);

  // Danh sách khách theo chuyến báo khách đã gửi ảnh.
  const passengers = await http().get(`/api/v1/admin/operators/${seed.op.id}/trips/${seed.limoTrip.id}/passengers`)
    .set(bearer(ownerToken)).expect(200);
  const row = JSON.stringify(passengers.body);
  expect(row).toContain(`"code":"${h.code}"`);
  const items: { code: string; transferClaimedAt: string | null; paymentProofCount: number }[] =
    passengers.body.bookings ?? passengers.body.items ?? passengers.body;
  const mine = (Array.isArray(items) ? items : []).find((b) => b.code === h.code);
  expect(mine).toMatchObject({ transferClaimedAt: T0.toISOString(), paymentProofCount: 1 });
});

it('opening an image is written to the audit log', async () => {
  const h = await hold(seed.limoTrip.id, 'A7');
  const up = await submit(h.code, h.token, jpeg(9)).expect(201);
  await http().get(`/api/v1/admin/operators/${seed.op.id}/payment-proofs/${up.body.proof.id}`).set(bearer(ownerToken)).expect(200);
  const { rows } = await s.db.query<{ data: { bookingCode: string } }>(
    `SELECT data FROM audit_logs WHERE operator_id = $1 AND action = 'payment_proof.view' AND entity_id = $2`,
    [seed.op.id, up.body.proof.id],
  );
  expect(rows).toEqual([{ data: { bookingCode: h.code } }]);
});

it('a public client is rate limited per booking before the image is read', async () => {
  const h = await hold(seed.limoTrip.id, 'A8');
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) codes.push((await submit(h.code, 'not-a-token', JPEG)).status);
  expect(codes.slice(0, 10).every((c) => c === 404)).toBe(true);
  expect(codes.slice(10)).toEqual([429, 429]);
});
