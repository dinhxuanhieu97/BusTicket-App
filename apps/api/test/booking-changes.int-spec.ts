import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import {
  AUTH_SECRET, BED_FARES, LIMO_FARES, RELAXED_ABUSE, Services, T0, TEST_DB_URL, TOKEN_SECRET,
  buildServices, newKey, newRetryToken, resetDatabase, seedOperatorWithTrips,
} from './helpers';

let s: Services;
let app: INestApplication;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let other: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
/** Chuyến Limousine ngày khác (03/02), giá cao hơn. */
let laterTrip: { id: string };
const tokens: Record<string, string> = {};
const PASSWORD = 'booking-changes-test-password-1';
const STAFF = {
  owner: { role: 'OWNER', phone: '0908100001' },
  dispatcher: { role: 'DISPATCHER', phone: '0908100002' },
  seller: { role: 'SELLER', phone: '0908100003' },
  accountant: { role: 'ACCOUNTANT', phone: '0908100004' },
} as const;
const LATER_FARES = LIMO_FARES.map((f) => ({ ...f, price: f.price + 100_000 }));

const http = () => request(app.getHttpServer());
const bearer = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
const opBase = (op = seed.op.id) => `/api/v1/admin/operators/${op}`;

async function sell(tripId: string, seats: string[], opts: { paid?: number; confirm?: boolean; occupancy?: number } = {}) {
  const r = await http()
    .post(`${opBase()}/trips/${tripId}/bookings`)
    .set(bearer('seller'))
    .set('Idempotency-Key', newKey())
    .send({
      contactName: 'Khách Đổi Vé', contactPhone: '0913000222', items: seats.map((seatCode) => ({ seatCode, occupancy: opts.occupancy ?? 1 })),
      paidAmount: opts.paid ?? 0, confirm: opts.confirm ?? true, notifyCustomer: false,
    })
    .expect(200);
  return r.body.booking as { code: string; seats: string[]; totalAmount: number; depositAmount: number; paidAmount: number; status: string };
}

function change(code: string, body: object, who = 'dispatcher', opts: { dryRun?: boolean; key?: string; op?: string } = {}) {
  const req = http()
    .post(`${opBase(opts.op)}/bookings/${code}/change${opts.dryRun ? '?dryRun=true' : ''}`)
    .set(bearer(who));
  if (!opts.dryRun) req.set('Idempotency-Key', opts.key ?? newKey());
  return req.send(body);
}

const row = async (code: string) =>
  (await s.db.query<{
    id: string; trip_id: string; status: string; total_amount: number; deposit_amount: number; paid_amount: number; payment_status: string;
    hold_expires_at: Date | null; release_at: Date | null;
  }>(
    `SELECT id, trip_id, status, total_amount, deposit_amount, paid_amount, payment_status, hold_expires_at, release_at
     FROM bookings WHERE code = $1`, [code],
  )).rows[0]!;
const heldSeats = async (code: string) =>
  (await s.db.query<{ trip_id: string; seat_code: string }>(
    `SELECT ts.trip_id, ts.seat_code FROM trip_seats ts JOIN bookings b ON b.id = ts.booking_id WHERE b.code = $1
     ORDER BY ts.trip_id, ts.seat_code`, [code],
  )).rows.map((r) => `${r.seat_code}@${r.trip_id === seed.limoTrip.id ? 'limo' : r.trip_id === seed.bedTrip.id ? 'bed' : r.trip_id === laterTrip.id ? 'later' : r.trip_id}`);
const freeSeats = async (tripId: string, n: number) =>
  (await s.db.query<{ seat_code: string }>(
    `SELECT seat_code FROM trip_seats WHERE trip_id = $1 AND sellable AND booking_id IS NULL ORDER BY length(seat_code), seat_code LIMIT $2`,
    [tripId, n],
  )).rows.map((r) => r.seat_code);
const items = async (code: string) =>
  (await s.db.query<{ trip_id: string; seat_code: string; line_total: number }>(
    `SELECT i.trip_id, i.seat_code, i.line_total FROM booking_items i JOIN bookings b ON b.id = i.booking_id WHERE b.code = $1
     ORDER BY i.trip_id, i.seat_code`, [code],
  )).rows;
const refunds = async (code: string) =>
  (await s.db.query<{ kind: string; amount: number; reason: string; status: string }>(
    `SELECT r.kind, r.amount, r.reason, r.status FROM refund_obligations r JOIN bookings b ON b.id = r.booking_id
     WHERE b.code = $1 ORDER BY r.created_at, r.kind`, [code],
  )).rows;
const setDepart = (tripId: string, at: Date) =>
  s.db.query(`UPDATE trips SET depart_at = $2, sales_close_at = $2::timestamptz - interval '1 hour' WHERE id = $1`, [tripId, at]);
const seatFree = async (tripId: string, seat: string) =>
  (await s.db.query<{ booking_id: string | null }>('SELECT booking_id FROM trip_seats WHERE trip_id = $1 AND seat_code = $2', [tripId, seat]))
    .rows[0]!.booking_id === null;

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  other = await seedOperatorWithTrips(s, 'AB');
  // Cọc 50%: giống đơn thật PNMX2TDH (đã cọc một nửa).
  await s.operators.updatePolicy(seed.op.id, {
    holdMinutes: 10, maxUnitsPerBooking: 5, maxActiveHoldsPerPhone: 20, depositPercent: 50,
    childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false },
  });
  laterTrip = await s.trips.createTrip(seed.op.id, {
    routeId: seed.route.id, vehicleId: seed.limo.id, name: 'TP.HCM → Hoài Ân 18:00 (03/02)',
    departAt: new Date('2027-02-03T11:00:00Z'), salesCloseAt: new Date('2027-02-03T10:00:00Z'),
    salesOpenAt: new Date('2027-01-01T00:00:00Z'), fares: LATER_FARES,
  });
  const users = new UsersService(s.db, s.clock);
  for (const [key, v] of Object.entries(STAFF)) {
    await users.createStaff(seed.op.id, { fullName: `NV ${key}`, role: v.role, phone: v.phone, password: PASSWORD });
  }
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET,
      abuse: RELAXED_ABUSE, clock: s.clock, authRequireMfa: false,
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  s.clock.set(T0);
  for (const [key, v] of Object.entries(STAFF)) {
    const r = await http().post('/api/v1/auth/login').send({ phone: v.phone, password: PASSWORD }).expect(200);
    tokens[key] = r.body.accessToken;
  }
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

beforeEach(() => s.clock.set(T0));

describe('change seats on the same trip', () => {
  it('moves a deposit-paid booking to other seats, keeps the money, frees old seats, logs audit/outbox/history', async () => {
    const b = await sell(seed.limoTrip.id, ['A3', 'A4'], { paid: 450_000 });
    expect(b).toMatchObject({ totalAmount: 900_000, depositAmount: 450_000, paidAmount: 450_000, status: 'CONFIRMED' });

    const r = await change(b.code, { items: [{ seatCode: 'A5' }, { seatCode: 'A6' }], notifyCustomer: false }).expect(200);
    expect(r.body).toMatchObject({
      replayed: false, refundAmount: 0, changed: ['seats'],
      booking: { code: b.code, status: 'CONFIRMED', totalAmount: 900_000, depositAmount: 450_000, paidAmount: 450_000, dueAmount: 450_000, paymentStatus: 'DEPOSIT_PAID' },
      before: { seats: [{ seatCode: 'A3' }, { seatCode: 'A4' }] },
    });
    expect(await heldSeats(b.code)).toEqual(['A5@limo', 'A6@limo']);
    expect(await seatFree(seed.limoTrip.id, 'A3')).toBe(true);
    expect(await seatFree(seed.limoTrip.id, 'A4')).toBe(true);
    expect((await items(b.code)).map((i) => i.seat_code)).toEqual(['A5', 'A6']);

    const id = (await row(b.code)).id;
    const { rows: ev } = await s.db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_events WHERE type = 'booking.changed' AND aggregate_id = $1`, [id],
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ bookingCode: b.code, by: 'STAFF', changed: ['seats'], notifyCustomer: false, seats: ['A5', 'A6'] });
    const { rows: audit } = await s.db.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM audit_logs WHERE action = 'booking.change_staff' AND entity_id = $1`, [id],
    );
    expect(audit[0]!.data).toMatchObject({ bookingCode: b.code, changed: ['seats'], refundAmount: 0 });
    // Nhật ký không chứa họ tên/SĐT.
    expect(JSON.stringify(audit[0]!.data)).not.toMatch(/Khách|0913/);
    const { rows: hist } = await s.db.query('SELECT 1 FROM booking_changes WHERE booking_id = $1', [id]);
    expect(hist).toHaveLength(1);
  });

  it('swaps within its own seats (A3,A4 → A4,A5) and reprices a double room', async () => {
    const b = await sell(seed.limoTrip.id, ['A7', 'A8']);
    const r = await change(b.code, { items: [{ seatCode: 'A8', occupancy: 2 }, { seatCode: 'A9' }] }).expect(200);
    expect(r.body.booking).toMatchObject({ totalAmount: 700_000 + 450_000, depositAmount: 575_000, paidAmount: 0, paymentStatus: 'UNPAID' });
    expect(await heldSeats(b.code)).toEqual(['A8@limo', 'A9@limo']);
  });

  it('replays the same Idempotency-Key and rejects it for a different body', async () => {
    const b = await sell(seed.limoTrip.id, ['A10']);
    const key = newKey();
    const first = await change(b.code, { items: [{ seatCode: 'A11' }] }, 'dispatcher', { key }).expect(200);
    const again = await change(b.code, { items: [{ seatCode: 'A11' }] }, 'dispatcher', { key }).expect(200);
    expect(again.body).toEqual({ ...first.body, replayed: true });
    const conflict = await change(b.code, { items: [{ seatCode: 'A12' }] }, 'dispatcher', { key }).expect(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const { rows } = await s.db.query('SELECT 1 FROM booking_changes WHERE booking_id = $1', [(await row(b.code)).id]);
    expect(rows).toHaveLength(1);
  });

  it('dry run previews without writing anything', async () => {
    const b = await sell(seed.limoTrip.id, ['B1']);
    const r = await change(b.code, { items: [{ seatCode: 'A1' }] }, 'dispatcher', { dryRun: true }).expect(200);
    expect(r.body.booking).toMatchObject({ totalAmount: 450_000, seats: [{ seatCode: 'A1', lineTotal: 450_000 }] });
    expect(r.body.before).toMatchObject({ totalAmount: 420_000 });
    expect(await heldSeats(b.code)).toEqual(['B1@limo']);
    expect((await row(b.code)).total_amount).toBe(420_000);
  });

  it('refuses a seat held by another booking, an unsellable seat and duplicates, leaving everything unchanged', async () => {
    const mine = await sell(seed.limoTrip.id, ['B2']);
    const theirs = await sell(seed.limoTrip.id, ['B3']);
    const taken = await change(mine.code, { items: [{ seatCode: 'B3' }] }).expect(409);
    expect(taken.body.error).toMatchObject({ code: 'SEAT_UNAVAILABLE' });
    expect(taken.body.error.message).toContain(theirs.code);
    await s.db.query(`UPDATE trip_seats SET sellable = false WHERE trip_id = $1 AND seat_code = 'B12'`, [seed.limoTrip.id]);
    expect((await change(mine.code, { items: [{ seatCode: 'B12' }] }).expect(409)).body.error.code).toBe('SEAT_UNAVAILABLE');
    await s.db.query(`UPDATE trip_seats SET sellable = true WHERE trip_id = $1 AND seat_code = 'B12'`, [seed.limoTrip.id]);
    expect((await change(mine.code, { items: [{ seatCode: 'B4' }, { seatCode: 'B4' }] }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await change(mine.code, { items: [{ seatCode: 'Z99' }] }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect(await heldSeats(mine.code)).toEqual(['B2@limo']);
  });

  it('takes a seat whose previous hold has passed its release time', async () => {
    const stale = await sell(seed.limoTrip.id, ['B5'], { confirm: false });
    const mine = await sell(seed.limoTrip.id, ['B6']);
    s.clock.set(new Date(T0.getTime() + 60 * 60_000));
    await change(mine.code, { items: [{ seatCode: 'B5' }] }).expect(200);
    expect(await heldSeats(mine.code)).toEqual(['B5@limo']);
    expect((await row(stale.code)).status).toBe('EXPIRED');
  });

  it('rejects "no change", boarded passengers, closed bookings and departed trips', async () => {
    const b = await sell(seed.limoTrip.id, ['B7']);
    expect((await change(b.code, { items: [{ seatCode: 'B7' }] }).expect(400)).body.error.message).toBe('Chưa có thay đổi nào.');
    await s.db.query(`UPDATE booking_items SET boarded_at = $2 WHERE booking_id = $1`, [(await row(b.code)).id, T0]);
    expect((await change(b.code, { items: [{ seatCode: 'B8' }] }).expect(409)).body.error.message).toContain('lên xe');
    await s.db.query(`UPDATE booking_items SET boarded_at = NULL WHERE booking_id = $1`, [(await row(b.code)).id]);

    // Tua giờ chạy của chuyến thay vì tua đồng hồ (token đăng nhập sẽ hết hạn).
    await setDepart(seed.limoTrip.id, new Date(T0.getTime() - 60_000));
    expect((await change(b.code, { items: [{ seatCode: 'B8' }] }).expect(409)).body.error.message).toContain('khởi hành');
    await setDepart(seed.limoTrip.id, new Date('2027-02-01T11:00:00Z'));

    await http().post(`${opBase()}/bookings/${b.code}/cancel`).set(bearer('dispatcher')).send({ reason: 'Khách hủy', notifyCustomer: false }).expect(200);
    expect((await change(b.code, { items: [{ seatCode: 'B8' }] }).expect(409)).body.error.code).toBe('CONFLICT');
  });
});

describe('change to another trip / date', () => {
  it('moves to a later date keeping the seat codes, reprices, keeps the deposit paid and stays confirmed', async () => {
    // Như đơn PNMX2TDH: 2 chỗ, đã cọc 50%.
    const b = await sell(seed.limoTrip.id, ['A2', 'B9'], { paid: 435_000 });
    expect(b).toMatchObject({ totalAmount: 870_000, depositAmount: 435_000, status: 'CONFIRMED' });
    const r = await change(b.code, { toTripId: laterTrip.id }).expect(200);
    expect(r.body).toMatchObject({
      changed: expect.arrayContaining(['trip', 'seats', 'totalAmount', 'depositAmount']),
      booking: { tripId: laterTrip.id, status: 'CONFIRMED', totalAmount: 1_070_000, depositAmount: 535_000, paidAmount: 435_000, dueAmount: 635_000, paymentStatus: 'PARTIAL' },
    });
    const rr = await row(b.code);
    expect(rr).toMatchObject({ trip_id: laterTrip.id, total_amount: 1_070_000, paid_amount: 435_000 });
    expect(await heldSeats(b.code)).toEqual(['A2@later', 'B9@later']);
    expect(await seatFree(seed.limoTrip.id, 'A2')).toBe(true);
    expect(await seatFree(seed.limoTrip.id, 'B9')).toBe(true);
    expect((await items(b.code)).map((i) => i.line_total)).toEqual([550_000, 520_000]);
  });

  it('moves to a cheaper trip: the overpaid part becomes an ADJUST refund, then a cancel refunds only what is left', async () => {
    const b = await sell(seed.limoTrip.id, ['A12'], { paid: 450_000 });
    const noReason = await change(b.code, { toTripId: seed.bedTrip.id, items: [{ seatCode: 'D1' }] }, 'owner').expect(400);
    expect(noReason.body.error.details).toMatchObject({ field: 'reason' });
    const preview = await change(b.code, { toTripId: seed.bedTrip.id, items: [{ seatCode: 'D1' }] }, 'owner', { dryRun: true }).expect(200);
    expect(preview.body).toMatchObject({ refundAmount: 70_000, booking: { paidAmount: 380_000 } });

    const r = await change(b.code, { toTripId: seed.bedTrip.id, items: [{ seatCode: 'D1' }], reason: 'Khách đổi sang giường nằm' }, 'owner').expect(200);
    expect(r.body).toMatchObject({
      refundAmount: 70_000,
      booking: { tripId: seed.bedTrip.id, totalAmount: 380_000, paidAmount: 380_000, dueAmount: 0, paymentStatus: 'PAID' },
    });
    expect(await refunds(b.code)).toEqual([{ kind: 'ADJUST', amount: 70_000, reason: 'Khách đổi sang giường nằm', status: 'OPEN' }]);

    const c = await http().post(`${opBase()}/bookings/${b.code}/cancel`).set(bearer('dispatcher')).send({ reason: 'Khách hủy hẳn', notifyCustomer: false }).expect(200);
    expect(c.body.refund).toMatchObject({ kind: 'CANCEL', amount: 380_000 });
    expect((await refunds(b.code)).map((x) => [x.kind, x.amount])).toEqual([['ADJUST', 70_000], ['CANCEL', 380_000]]);
    // Gửi lại lệnh hủy vẫn trả đúng khoản CANCEL.
    const again = await http().post(`${opBase()}/bookings/${b.code}/cancel`).set(bearer('dispatcher')).send({ reason: 'Khách hủy hẳn' }).expect(200);
    expect(again.body).toMatchObject({ alreadyCancelled: true, refund: { kind: 'CANCEL', amount: 380_000 } });
    // Kế toán xử lý khoản ADJUST: trả lại đúng khoản đó.
    const { rows } = await s.db.query<{ id: string }>(`SELECT r.id FROM refund_obligations r JOIN bookings b ON b.id = r.booking_id WHERE b.code = $1 AND kind = 'ADJUST'`, [b.code]);
    const resolved = await http().post(`${opBase()}/refunds/${rows[0]!.id}/resolve`).set(bearer('owner')).send({ status: 'REFUNDED' }).expect(200);
    expect(resolved.body.refund).toMatchObject({ kind: 'ADJUST', amount: 70_000, status: 'REFUNDED' });
  });

  it('lets a seller or dispatcher change a booking only when it creates no refund', async () => {
    const b = await sell(seed.limoTrip.id, ['A12'], { paid: 450_000 });
    const body = { toTripId: seed.bedTrip.id, items: [{ seatCode: 'D4' }], reason: 'Khách đổi sang giường nằm' };
    for (const who of ['seller', 'dispatcher']) {
      const denied = await change(b.code, body, who).expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
      await change(b.code, body, who, { dryRun: true }).expect(403);
    }
    expect(await refunds(b.code)).toEqual([]);
    expect((await row(b.code)).trip_id).toBe(seed.limoTrip.id);

    // Đổi chỗ cùng chuyến, số tiền không đổi: không tạo khoản cần hoàn nên nhân viên bán vé vẫn làm được.
    const same = await sell(seed.limoTrip.id, ['B7'], { paid: 0 });
    const r = await change(same.code, { items: [{ seatCode: 'B8' }] }, 'seller').expect(200);
    expect(r.body).toMatchObject({ refundAmount: 0, changed: ['seats'], booking: { seats: [{ seatCode: 'B8' }] } });
  });

  it('keeps a deposit set by hand when the seats change, and warns when the policy would set another one', async () => {
    const b = await sell(seed.limoTrip.id, ['B9'], { paid: 0 });
    await change(b.code, { depositAmount: 300_000, reason: 'Khách thỏa thuận cọc 300k' }, 'owner').expect(200);
    const r = await change(b.code, { items: [{ seatCode: 'B4' }] }).expect(200);
    expect(r.body.booking).toMatchObject({ depositAmount: 300_000 });
    expect(r.body.warnings).toEqual([expect.stringMatching(/^Giữ cọc 300\.000đ; theo chính sách mới cọc sẽ là /)]);
  });

  it('refuses draft, cancelled, departed and foreign target trips', async () => {
    const b = await sell(seed.limoTrip.id, ['B10']);
    await s.db.query(`UPDATE trips SET status = 'CANCELLED' WHERE id = $1`, [laterTrip.id]);
    expect((await change(b.code, { toTripId: laterTrip.id }).expect(409)).body.error.code).toBe('TRIP_NOT_ON_SALE');
    await s.db.query(`UPDATE trips SET status = 'DRAFT' WHERE id = $1`, [laterTrip.id]);
    expect((await change(b.code, { toTripId: laterTrip.id }).expect(409)).body.error.code).toBe('TRIP_NOT_ON_SALE');
    await s.db.query(`UPDATE trips SET status = 'OPEN' WHERE id = $1`, [laterTrip.id]);
    await setDepart(seed.bedTrip.id, new Date(T0.getTime() - 60_000));
    expect((await change(b.code, { toTripId: seed.bedTrip.id, items: [{ seatCode: 'D2' }], reason: 'abc' }).expect(409)).body.error.message)
      .toBe('Chuyến mới đã khởi hành.');
    await setDepart(seed.bedTrip.id, new Date('2027-02-01T12:30:00Z'));
    expect((await change(b.code, { toTripId: other.limoTrip.id }).expect(404)).body.error.code).toBe('NOT_FOUND');
    expect(await heldSeats(b.code)).toEqual(['B10@limo']);
  });

  it('lets exactly one of two concurrent changes take the same seat', async () => {
    const x = await sell(seed.limoTrip.id, ['B11']);
    const y = await sell(seed.bedTrip.id, ['D3']);
    const [rx, ry] = await Promise.all([
      change(x.code, { toTripId: laterTrip.id, items: [{ seatCode: 'A1' }] }),
      change(y.code, { toTripId: laterTrip.id, items: [{ seatCode: 'A1' }], reason: 'đổi chuyến' }),
    ]);
    expect([rx.status, ry.status].sort()).toEqual([200, 409]);
    const { rows } = await s.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM booking_items WHERE trip_id = $1 AND seat_code = 'A1'`, [laterTrip.id],
    );
    expect(rows[0]!.n).toBe(1);
    const loser = rx.status === 200 ? y.code : x.code;
    expect(await heldSeats(loser)).toEqual([loser === x.code ? 'B11@limo' : 'D3@bed']);
  });

  it('changes only the return leg of a round trip', async () => {
    const back = await s.trips.createRoute(seed.op.id, { code: 'HA-HCM', origin: 'Hoài Ân', destination: 'TP.HCM' });
    const inbound = await s.trips.createTrip(seed.op.id, {
      routeId: back.id, vehicleId: seed.bed.id, name: 'Hoài Ân → TP.HCM', departAt: new Date('2027-02-05T11:00:00Z'),
      salesCloseAt: new Date('2027-02-05T10:00:00Z'), salesOpenAt: new Date('2027-01-01T00:00:00Z'), fares: BED_FARES,
    });
    const r0 = await s.bookings.createHold(
      { contactName: 'Khứ Hồi', contactPhone: '0912 345 678', tripId: seed.limoTrip.id, items: [{ seatCode: 'A1' }], returnLeg: { tripId: inbound.id, items: [{ seatCode: 'D4' }] } },
      newKey(), { retryToken: newRetryToken() },
    );
    const code = r0.booking.code;
    const r = await change(code, { fromTripId: inbound.id, items: [{ seatCode: 'D5' }] }).expect(200);
    expect(r.body.booking.tripId).toBe(seed.limoTrip.id);
    expect(r.body.booking.seats.map((x: { seatCode: string; tripId: string }) => `${x.seatCode}@${x.tripId === inbound.id ? 'in' : 'out'}`).sort())
      .toEqual(['A1@out', 'D5@in']);
    expect(await seatFree(inbound.id, 'D4')).toBe(true);
    // Không gộp hai chặng vào một chuyến.
    expect((await change(code, { fromTripId: inbound.id, toTripId: seed.limoTrip.id, items: [{ seatCode: 'A5' }] }).expect(400)).body.error.details)
      .toMatchObject({ field: 'toTripId' });
    expect((await change(code, { fromTripId: laterTrip.id, toTripId: seed.limoTrip.id }).expect(400)).body.error.details)
      .toMatchObject({ field: 'fromTripId' });
  });

  it('keeps round-trip legs in opposite directions with the return after the outbound', async () => {
    const back = await s.trips.createRoute(seed.op.id, { code: 'HA-HCM2', origin: 'Hoài Ân', destination: 'TP.HCM' });
    const inbound = await s.trips.createTrip(seed.op.id, {
      routeId: back.id, vehicleId: seed.bed.id, name: 'Hoài Ân → TP.HCM (05/02)', departAt: new Date('2027-02-05T11:00:00Z'),
      salesCloseAt: new Date('2027-02-05T10:00:00Z'), salesOpenAt: new Date('2027-01-01T00:00:00Z'), fares: BED_FARES,
    });
    const afterReturn = await s.trips.createTrip(seed.op.id, {
      routeId: seed.route.id, vehicleId: seed.limo.id, name: 'TP.HCM → Hoài Ân (07/02)', departAt: new Date('2027-02-07T11:00:00Z'),
      salesCloseAt: new Date('2027-02-07T10:00:00Z'), salesOpenAt: new Date('2027-01-01T00:00:00Z'), fares: LIMO_FARES,
    });
    const r0 = await s.bookings.createHold(
      { contactName: 'Khứ Hồi Hai', contactPhone: '0912 345 679', tripId: seed.limoTrip.id, items: [{ seatCode: 'A2' }], returnLeg: { tripId: inbound.id, items: [{ seatCode: 'D6' }] } },
      newKey(), { retryToken: newRetryToken() },
    );
    const code = r0.booking.code;
    const msg = 'Chuyến về phải đúng tuyến ngược chiều và khởi hành sau chuyến đi.';
    // Chặng về chuyển sang chuyến cùng chiều chặng đi.
    expect((await change(code, { fromTripId: inbound.id, toTripId: laterTrip.id, items: [{ seatCode: 'A3' }] }).expect(400)).body.error.message).toBe(msg);
    // Chặng đi dời sang sau chặng về.
    expect((await change(code, { toTripId: afterReturn.id }).expect(400)).body.error.message).toBe(msg);
    // Dời chặng đi sang 03/02 (vẫn trước chặng về 05/02) thì được.
    const [late] = await freeSeats(laterTrip.id, 1);
    const ok = await change(code, { toTripId: laterTrip.id, items: [{ seatCode: late! }] }).expect(200);
    expect(ok.body.booking.tripId).toBe(laterTrip.id);
  });

  it('replays a retry with the same key that races the first request', async () => {
    const [s1, s2] = await freeSeats(seed.bedTrip.id, 2);
    const a = await sell(seed.bedTrip.id, [s1!]);
    const key1 = newKey();
    const [r1, r2] = await Promise.all([
      change(a.code, { items: [{ seatCode: s2! }] }, 'dispatcher', { key: key1 }),
      change(a.code, { items: [{ seatCode: s2! }] }, 'dispatcher', { key: key1 }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect([r1.body.replayed, r2.body.replayed].sort()).toEqual([false, true]);
    const later = new Set(await freeSeats(laterTrip.id, 100));
    const s3 = (await freeSeats(seed.limoTrip.id, 100)).find((x) => later.has(x));
    const b = await sell(seed.limoTrip.id, [s3!]);
    const key2 = newKey();
    const [m1, m2] = await Promise.all([
      change(b.code, { toTripId: laterTrip.id }, 'dispatcher', { key: key2 }),
      change(b.code, { toTripId: laterTrip.id }, 'dispatcher', { key: key2 }),
    ]);
    expect([m1.status, m2.status]).toEqual([200, 200]);
    expect(await heldSeats(b.code)).toEqual([`${s3}@later`]);
  });
});

describe('money adjustments', () => {
  it('needs payment.manage to override amounts; booking.update alone cannot', async () => {
    const b = await sell(seed.bedTrip.id, ['D6']);
    expect((await change(b.code, { totalAmount: 1, reason: 'giảm giá' }, 'seller').expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await change(b.code, { totalAmount: 1, reason: 'giảm giá' }, 'dispatcher').expect(403)).body.error.code).toBe('FORBIDDEN');
    await change(b.code, { items: [{ seatCode: 'D7' }] }, 'accountant').expect(403); // không có booking.update
    expect((await change(b.code, { totalAmount: 300_000 }, 'owner').expect(400)).body.error.details).toMatchObject({ field: 'reason' });
    const r = await change(b.code, { totalAmount: 300_000, reason: 'Khách quen giảm giá' }, 'owner').expect(200);
    expect(r.body.booking).toMatchObject({ totalAmount: 300_000, depositAmount: 150_000, paidAmount: 0 });
    expect(r.body.before).toMatchObject({ totalAmount: 350_000 });
  });

  it('rejects a deposit above the total and a refund above what was paid', async () => {
    const b = await sell(seed.bedTrip.id, ['D8'], { paid: 100_000 });
    expect((await change(b.code, { depositAmount: 400_000, reason: 'abc' }, 'owner').expect(400)).body.error.details).toMatchObject({ field: 'depositAmount' });
    expect((await change(b.code, { refundAmount: 100_001, reason: 'abc' }, 'owner').expect(400)).body.error.details).toMatchObject({ field: 'refundAmount' });
  });

  it('reduces "paid" through an ADJUST refund instead of editing the cash book', async () => {
    const b = await sell(seed.bedTrip.id, ['D9'], { paid: 350_000 }); // tầng 2: 350k
    const r = await change(b.code, { refundAmount: 50_000, reason: 'Ghi nhầm tiền mặt' }, 'owner').expect(200);
    expect(r.body).toMatchObject({ refundAmount: 50_000, changed: ['paidAmount'], booking: { paidAmount: 300_000, dueAmount: 50_000, paymentStatus: 'DEPOSIT_PAID' } });
    expect(await refunds(b.code)).toEqual([{ kind: 'ADJUST', amount: 50_000, reason: 'Ghi nhầm tiền mặt', status: 'OPEN' }]);
    const { rows } = await s.db.query<{ amount: string }>(`SELECT sum(amount)::text AS amount FROM payments WHERE content = $1`, [b.code]);
    expect(rows[0]!.amount).toBe('350000');
  });

  it('confirms a holding booking when the deposit is lowered to what was already paid', async () => {
    const b = await sell(seed.bedTrip.id, ['D10'], { confirm: false, paid: 100_000 });
    expect(b.status).toBe('HOLDING');
    const r = await change(b.code, { depositAmount: 100_000, reason: 'Nhận cọc 100k' }, 'owner').expect(200);
    expect(r.body.booking).toMatchObject({ status: 'CONFIRMED', depositAmount: 100_000, paymentStatus: 'DEPOSIT_PAID' });
    const rr = await row(b.code);
    expect(rr).toMatchObject({ status: 'CONFIRMED', hold_expires_at: null, release_at: null });
    const { rows } = await s.db.query(`SELECT 1 FROM outbox_events WHERE type = 'booking.confirmed' AND aggregate_id = $1`, [rr.id]);
    expect(rows).toHaveLength(1);
  });

  it('does not confirm an unpaid holding booking just because the deposit is lowered to 0', async () => {
    const [seat] = await freeSeats(seed.bedTrip.id, 1);
    const b = await sell(seed.bedTrip.id, [seat!], { confirm: false });
    expect(b).toMatchObject({ status: 'HOLDING', paidAmount: 0 });
    const r = await change(b.code, { depositAmount: 0, reason: 'Khách quen' }, 'owner').expect(200);
    expect(r.body.booking).toMatchObject({ status: 'HOLDING', depositAmount: 0, paidAmount: 0, paymentStatus: 'UNPAID' });
    expect(r.body.changed).toEqual(['depositAmount']);
    const rr = await row(b.code);
    expect(rr.status).toBe('HOLDING');
    expect(rr.release_at).not.toBeNull();
  });

  it('lets a manager confirm without a deposit only on purpose, with payment.manage and a reason', async () => {
    const [seat] = await freeSeats(seed.bedTrip.id, 1);
    const b = await sell(seed.bedTrip.id, [seat!], { confirm: false });
    expect((await change(b.code, { confirmWithoutDeposit: true, reason: 'Nhà xe cho giữ không cọc' }, 'dispatcher').expect(403)).body.error.code)
      .toBe('FORBIDDEN');
    expect((await change(b.code, { confirmWithoutDeposit: true }, 'owner').expect(400)).body.error.details).toMatchObject({ field: 'reason' });
    const preview = await change(b.code, { confirmWithoutDeposit: true }, 'owner', { dryRun: true }).expect(200);
    expect(preview.body.booking).toMatchObject({ status: 'CONFIRMED', paidAmount: 0 });
    expect(await row(b.code)).toMatchObject({ status: 'HOLDING' });
    const r = await change(b.code, { confirmWithoutDeposit: true, reason: 'Nhà xe cho giữ không cọc' }, 'owner').expect(200);
    expect(r.body.booking).toMatchObject({ status: 'CONFIRMED', paidAmount: 0, paymentStatus: 'UNPAID' });
    expect(r.body.changed).toEqual(['status']);
    expect(await row(b.code)).toMatchObject({ status: 'CONFIRMED', hold_expires_at: null, release_at: null });
    // Đã xác nhận rồi thì không bật lại được.
    expect((await change(b.code, { confirmWithoutDeposit: true, reason: 'lặp lại' }, 'owner').expect(400)).body.error.details)
      .toMatchObject({ field: 'confirmWithoutDeposit' });
  });

  it('hides other operators\' bookings', async () => {
    const [seat] = await freeSeats(seed.bedTrip.id, 1);
    const b = await sell(seed.bedTrip.id, [seat!]);
    await change(b.code, { items: [{ seatCode: 'A3' }] }, 'dispatcher', { op: other.op.id }).expect(404);
    const { rows } = await s.db.query<{ code: string }>(`SELECT code FROM bookings WHERE operator_id = $1 LIMIT 1`, [other.op.id]);
    if (rows[0]) await change(rows[0].code, { items: [{ seatCode: 'A3' }] }).expect(404);
  });
});

describe('pickup/dropoff', () => {
  it('accepts free-text stops when the route has no stop list, and re-matches stops when moving to another trip', async () => {
    const b = await sell(seed.limoTrip.id, ['B12']);
    const r = await http().patch(`${opBase()}/bookings/${b.code}`).set(bearer('seller')).send({ pickupStop: ' Ngã tư  Bình Phước ' }).expect(200);
    expect(r.body.booking.pickupStop).toEqual({ name: 'Ngã tư Bình Phước', time: '', day: 0 });

    await s.db.query(
      `UPDATE trips SET stops_snapshot = $2::jsonb WHERE id = $1`,
      [laterTrip.id, JSON.stringify({ pickup: [{ name: 'Bến xe An Sương', time: '17:30', day: 0 }], dropoff: [] })],
    );
    const moved = await change(b.code, { toTripId: laterTrip.id }).expect(200);
    expect(moved.body.warnings).toEqual(['Điểm đón "Ngã tư Bình Phước" không có trên chuyến mới, đã bỏ trống.']);
    expect(moved.body.booking.pickupStop).toBeNull();
    // Tuyến đã có danh sách thì vẫn bắt buộc chọn đúng điểm.
    await http().patch(`${opBase()}/bookings/${b.code}`).set(bearer('seller')).send({ pickupStop: 'Chỗ lạ' }).expect(400);
    const ok = await http().patch(`${opBase()}/bookings/${b.code}`).set(bearer('seller')).send({ pickupStop: 'bến xe an sương' }).expect(200);
    expect(ok.body.booking.pickupStop).toEqual({ name: 'Bến xe An Sương', time: '17:30', day: 0 });
  });
});

describe('prices and amounts kept from the booking (review F82)', () => {
  it('keeps the booked price of seats that stay when another seat on the same trip changes', async () => {
    const [x, y, z] = await freeSeats(seed.bedTrip.id, 3);
    const b = await sell(seed.bedTrip.id, [x!, y!]);
    const before = new Map((await items(b.code)).map((i) => [i.seat_code, i.line_total]));
    await s.db.query('UPDATE trip_fares SET price = price + 50000 WHERE trip_id = $1', [seed.bedTrip.id]);
    try {
      const r = await change(b.code, { items: [{ seatCode: x! }, { seatCode: z! }] }).expect(200);
      const after = new Map((await items(b.code)).map((i) => [i.seat_code, i.line_total]));
      expect(after.get(x!)).toBe(before.get(x!));
      expect(r.body.booking.totalAmount).toBe([...after.values()].reduce((n, v) => n + v, 0));
    } finally {
      await s.db.query('UPDATE trip_fares SET price = price - 50000 WHERE trip_id = $1', [seed.bedTrip.id]);
    }
  });

  it('warns when a seat change recomputes a total that was set by hand', async () => {
    const [x, y] = await freeSeats(seed.bedTrip.id, 2);
    const b = await sell(seed.bedTrip.id, [x!]);
    await change(b.code, { totalAmount: b.totalAmount - 10_000, reason: 'Khách quen giảm giá' }, 'owner').expect(200);
    const r = await change(b.code, { items: [{ seatCode: y! }] }).expect(200);
    expect(r.body.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^Tổng tiền đã chỉnh tay /)]));
  });

  it('keeps a hand-set deposit when only the total changes, and warns', async () => {
    const [x] = await freeSeats(seed.bedTrip.id, 1);
    const b = await sell(seed.bedTrip.id, [x!]);
    await change(b.code, { depositAmount: 100_000, reason: 'Khách thỏa thuận cọc' }, 'owner').expect(200);
    const r = await change(b.code, { totalAmount: b.totalAmount - 10_000, reason: 'Giảm giá' }, 'owner').expect(200);
    expect(r.body.booking.depositAmount).toBe(100_000);
    expect(r.body.warnings).toEqual([expect.stringMatching(/^Giữ cọc 100\.000đ; theo chính sách mới cọc sẽ là /)]);
  });
});
