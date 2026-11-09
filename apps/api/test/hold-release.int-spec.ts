import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { HoldSweepConfig, HoldSweeper } from '../src/bookings/hold-sweeper';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import {
  AUTH_SECRET, BED_FARES, buildServices, errorCode, newKey, RELAXED_ABUSE, resetDatabase, seedOperatorWithTrips, Services, T0, TEST_DB_URL,
  TOKEN_SECRET,
} from './helpers';

/**
 * Đợt 3C: khách tự nhả chỗ, ân hạn chờ tiền báo chậm, tự xác nhận lại khi tiền về muộn mà chỗ còn trống,
 * tác vụ nền dọn đơn quá hạn — và các cuộc đua giữa chúng không bao giờ cho hai đơn cùng chiếm một chỗ.
 */

let s: Services;
let app: INestApplication;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let seats: string[];
let seatIdx = 0;
let owner: import('../src/auth/auth.service').AuthUser;
let phoneSeq = 100;
let txnSeq = 5000;
const ACC = '0999888777';
const KEY = 'sepay-webhook-key-release-test';
const http = () => request(app.getHttpServer());
const freshPhone = () => `09136${String(phoneSeq++).padStart(5, '0')}`;
const nextSeat = () => seats[seatIdx++]!;

function vnTime(offsetMinutes = 0): string {
  const d = new Date(s.clock.now().getTime() + offsetMinutes * 60_000 + 7 * 3600_000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
const transfer = (content: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id: txnSeq++, gateway: 'MBBank', transactionDate: vnTime(), accountNumber: ACC, code: null, content, transferType: 'in',
  transferAmount: amount, accumulated: 0, subAccount: null, referenceCode: `FT${txnSeq}`, description: '', ...extra,
});
const webhook = (payload: object) =>
  http().post('/api/v1/webhooks/payments/sepay').set('Authorization', `Apikey ${KEY}`).send(payload);
const release = (code: string, token?: string) => {
  const r = http().post(`/api/v1/bookings/${code}/release`);
  return token === undefined ? r : r.set('x-booking-token', token);
};

function hold(seatCodes: string[], tripId = seed.bedTrip.id, phone = freshPhone()) {
  return s.bookings.createHold(
    { tripId, contactName: 'Khách', contactPhone: phone, items: seatCodes.map((seatCode) => ({ seatCode })) },
    newKey(),
  );
}
async function seatStatus(code: string, tripId = seed.bedTrip.id) {
  return (await s.trips.seatMap(tripId)).seats.find((x) => x.code === code)!.status;
}
async function bookingRow(code: string) {
  const { rows } = await s.db.query<{ status: string; paid_amount: number; release_at: Date | null }>(
    'SELECT status, paid_amount, release_at FROM bookings WHERE code = $1',
    [code],
  );
  return rows[0]!;
}
async function payment(code: string) {
  const { rows } = await s.db.query<{ allocated_amount: number; review_status: string; review_reason: string | null }>(
    'SELECT allocated_amount, review_status, review_reason FROM payments WHERE content = $1',
    [code],
  );
  return rows[0]!;
}
/** Số đơn còn hiệu lực (giữ chưa nhả hoặc đã xác nhận) đang chiếm một chỗ — bất biến: không bao giờ > 1. */
async function activeClaims(seatCode: string, tripId = seed.bedTrip.id) {
  const { rows } = await s.db.query<{ n: number }>(
    `SELECT COUNT(DISTINCT b.id)::int AS n FROM booking_items i JOIN bookings b ON b.id = i.booking_id
     WHERE i.trip_id = $1 AND i.seat_code = $2
       AND (b.status = 'CONFIRMED' OR (b.status = 'HOLDING' AND b.release_at > $3))`,
    [tripId, seatCode, s.clock.now()],
  );
  return rows[0]!.n;
}
async function policyInput() {
  const { operatorId: _o, version: _v, ...input } = await s.operators.currentPolicy(seed.op.id);
  return input;
}

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  seats = (await s.trips.seatMap(seed.bedTrip.id)).seats.filter((x) => x.status === 'AVAILABLE').map((x) => x.code);
  const u = await new UsersService(s.db, s.clock).createStaff(seed.op.id, {
    fullName: 'Chủ xe', phone: freshPhone(), password: 'staff-password-1', role: 'OWNER',
  });
  owner = { id: u.id, operatorId: seed.op.id, role: 'OWNER', fullName: 'Chủ xe', phone: u.phone, mfaEnabled: true, scope: 'full' };
  await s.payments.configureAccount(
    owner,
    seed.op.id,
    { bankCode: 'MB', accountNumber: ACC, accountName: 'NHA XE PN', webhookApiKey: KEY },
  );
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, clock: s.clock, abuse: RELAXED_ABUSE,
      sepayClient: s.sepay,
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
beforeEach(() => s.clock.set(T0));

describe('POST /bookings/:code/release', () => {
  it('cancels an unpaid hold, frees the seat at once and is safe to repeat', async () => {
    const seat = nextSeat();
    const h = await hold([seat]);
    expect(await seatStatus(seat)).toBe('HELD');
    const res = await release(h.booking.code, h.accessToken).expect(200);
    expect(res.body).toMatchObject({ code: h.booking.code, status: 'CANCELLED', amountDueNow: 0, releaseAt: null });
    expect(await seatStatus(seat)).toBe('AVAILABLE');
    // Người khác chọn được ngay, không phải chờ hết 10 phút.
    await hold([seat]);
    expect((await release(h.booking.code, h.accessToken).expect(200)).body.status).toBe('CANCELLED');
    expect(await activeClaims(seat)).toBe(1);
  });

  it('answers 404 for a missing or wrong token and for a malformed code, without touching the hold', async () => {
    const seat = nextSeat();
    const h = await hold([seat]);
    await release(h.booking.code).expect(404);
    await release(h.booking.code, 'not-the-token').expect(404);
    await release('pn-bad', h.accessToken).expect(404);
    expect(await seatStatus(seat)).toBe('HELD');
  });

  it('a hold released by the customer after its release time is CANCELLED and never auto-reinstated', async () => {
    const seat = nextSeat();
    const h = await hold([seat]);
    s.clock.advanceMinutes(20);
    expect((await release(h.booking.code, h.accessToken).expect(200)).body.status).toBe('CANCELLED');
    await webhook(transfer(h.booking.code, h.booking.totalAmount)).expect(200);
    expect(await bookingRow(h.booking.code)).toMatchObject({ status: 'CANCELLED', paid_amount: 0 });
    expect(await payment(h.booking.code)).toMatchObject({ review_reason: 'BOOKING_CLOSED', allocated_amount: 0 });
    expect(await seatStatus(seat)).toBe('AVAILABLE');
  });

  it('refuses with 409 once money has been received', async () => {
    const h = await hold([nextSeat()]);
    await webhook(transfer(h.booking.code, h.booking.totalAmount)).expect(200);
    const res = await release(h.booking.code, h.accessToken).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect((await bookingRow(h.booking.code)).status).toBe('CONFIRMED');
  });

  it('releases both legs of a round trip', async () => {
    const route = await s.trips.createRoute(seed.op.id, { code: 'HA-HCM', origin: 'Hoài Ân', destination: 'TP.HCM' });
    const inbound = await s.trips.createTrip(seed.op.id, {
      routeId: route.id, vehicleId: seed.bed.id, name: 'Lượt về', departAt: new Date('2027-02-03T12:30:00Z'),
      salesCloseAt: new Date('2027-02-03T11:30:00Z'), salesOpenAt: new Date('2027-01-01T00:00:00Z'),
      fares: BED_FARES,
    });
    const seat = nextSeat();
    const h = await s.bookings.createHold({
      tripId: seed.bedTrip.id, contactName: 'Khách', contactPhone: freshPhone(), items: [{ seatCode: seat }],
      returnLeg: { tripId: inbound.id, items: [{ seatCode: seat }] },
    }, newKey());
    await release(h.booking.code, h.accessToken).expect(200);
    expect(await seatStatus(seat)).toBe('AVAILABLE');
    expect(await seatStatus(seat, inbound.id)).toBe('AVAILABLE');
  });
});

describe('races never give one seat to two bookings', () => {
  it('release racing many new holds on the same seat: at most one new holder', async () => {
    const seat = nextSeat();
    const h = await hold([seat]);
    const results = await Promise.all([
      release(h.booking.code, h.accessToken).then((r) => r.status),
      ...Array.from({ length: 6 }, () => hold([seat]).then(() => 'OK', (e) => e.code)),
    ]);
    expect(results[0]).toBe(200);
    const winners = results.slice(1).filter((r) => r === 'OK');
    expect(winners.length).toBeLessThanOrEqual(1);
    expect(results.slice(1).every((r) => r === 'OK' || r === 'SEAT_UNAVAILABLE')).toBe(true);
    expect(await activeClaims(seat)).toBe(winners.length);
  });

  it('release racing an on-time payment: either the payment confirms (release refused) or the release wins (money flagged)', async () => {
    for (let i = 0; i < 4; i++) {
      const seat = nextSeat();
      const h = await hold([seat]);
      const [rel, pay] = await Promise.all([
        release(h.booking.code, h.accessToken),
        webhook(transfer(h.booking.code, h.booking.totalAmount)),
      ]);
      expect(pay.status).toBe(200);
      const b = await bookingRow(h.booking.code);
      if (b.status === 'CONFIRMED') {
        expect(rel.status).toBe(409);
        expect(await seatStatus(seat)).toBe('BOOKED');
      } else {
        expect(rel.status).toBe(200);
        expect(b).toMatchObject({ status: 'CANCELLED', paid_amount: 0 });
        expect(await payment(h.booking.code)).toMatchObject({ allocated_amount: 0, review_reason: 'BOOKING_CLOSED' });
        expect(await seatStatus(seat)).toBe('AVAILABLE');
      }
    }
  });

  it('a late payment racing a new buyer for the expired seat: exactly one keeps it', async () => {
    for (let i = 0; i < 4; i++) {
      const seat = nextSeat();
      const h = await hold([seat]);
      s.clock.advanceMinutes(14);
      const [pay, competing] = await Promise.all([
        webhook(transfer(h.booking.code, h.booking.totalAmount)),
        hold([seat]).then(() => 'OK', (e) => e.code),
      ]);
      expect(pay.status).toBe(200);
      const b = await bookingRow(h.booking.code);
      if (b.status === 'CONFIRMED') expect(competing).toBe('SEAT_UNAVAILABLE');
      else {
        expect(competing).toBe('OK');
        expect(await payment(h.booking.code)).toMatchObject({ allocated_amount: 0, review_reason: 'LATE' });
      }
      expect(await activeClaims(seat)).toBe(1);
      s.clock.set(T0);
    }
  });
});

describe('auto-reinstate of late payments', () => {
  it('does not keep half a booking when one of its seats was resold', async () => {
    const [a, b] = [nextSeat(), nextSeat()];
    const h = await hold([a, b]);
    s.clock.advanceMinutes(14);
    const other = await hold([b]);
    await webhook(transfer(h.booking.code, h.booking.totalAmount)).expect(200);
    expect(await bookingRow(h.booking.code)).toMatchObject({ status: 'EXPIRED', paid_amount: 0 });
    expect(await payment(h.booking.code)).toMatchObject({ review_reason: 'LATE', allocated_amount: 0 });
    expect(await seatStatus(a)).toBe('AVAILABLE');
    const { rows } = await s.db.query<{ booking_id: string | null }>(
      'SELECT ts.booking_id FROM trip_seats ts WHERE ts.trip_id = $1 AND ts.seat_code = $2',
      [seed.bedTrip.id, b],
    );
    const { rows: ob } = await s.db.query<{ id: string }>('SELECT id FROM bookings WHERE code = $1', [other.booking.code]);
    expect(rows[0]!.booking_id).toBe(ob[0]!.id);
  });

  it('does not re-book after departure or on a cancelled trip', async () => {
    const h1 = await hold([nextSeat()]);
    const h2 = await hold([nextSeat()]);
    s.clock.set(new Date('2027-02-01T12:31:00Z')); // xe đã chạy
    await webhook(transfer(h1.booking.code, h1.booking.totalAmount)).expect(200);
    expect(await payment(h1.booking.code)).toMatchObject({ review_reason: 'LATE', allocated_amount: 0 });
    s.clock.advanceMinutes(-60 * 24 * 5);
    await s.db.query("UPDATE trips SET status = 'CANCELLED' WHERE id = $1", [seed.bedTrip.id]);
    try {
      await webhook(transfer(h2.booking.code, h2.booking.totalAmount)).expect(200);
      expect(await payment(h2.booking.code)).toMatchObject({ review_reason: 'LATE', allocated_amount: 0 });
    } finally {
      await s.db.query("UPDATE trips SET status = 'OPEN' WHERE id = $1", [seed.bedTrip.id]);
    }
  });
});

describe('manual allocation judges lateness by the transfer time', () => {
  it('an on-time transfer with a mistyped code, matched by staff after the deadline, still confirms', async () => {
    const input = await policyInput();
    await s.operators.updatePolicy(seed.op.id, { ...input, autoReinstateLatePayment: false });
    try {
      const h = await hold([nextSeat()]);
      s.clock.advanceMinutes(5);
      await webhook(transfer('chuyen khoan ve xe', h.booking.totalAmount)).expect(200);
      const { rows } = await s.db.query<{ id: string }>("SELECT id FROM payments WHERE content = 'chuyen khoan ve xe'");
      s.clock.advanceMinutes(20); // kế toán xử lý sau khi đơn đã quá hạn
      await s.payments.allocate(owner, seed.op.id, rows[0]!.id, { bookingCode: h.booking.code });
      expect(await bookingRow(h.booking.code)).toMatchObject({ status: 'CONFIRMED', paid_amount: h.booking.totalAmount });
    } finally {
      await s.operators.updatePolicy(seed.op.id, input);
    }
  });
});

describe('grace period and policy', () => {
  it('counts holds in their grace period toward the per-phone limit until they are released', async () => {
    const input = await policyInput();
    await s.operators.updatePolicy(seed.op.id, { ...input, maxActiveHoldsPerPhone: 1 });
    try {
      const phone = freshPhone();
      await hold([nextSeat()], seed.bedTrip.id, phone);
      s.clock.advanceMinutes(11);
      expect(await errorCode(hold([nextSeat()], seed.bedTrip.id, phone))).toBe('LIMIT_EXCEEDED');
      s.clock.advanceMinutes(2);
      await hold([nextSeat()], seed.bedTrip.id, phone);
    } finally {
      await s.operators.updatePolicy(seed.op.id, input);
    }
  });

  it('keeps grace and auto-reinstate when a policy update omits them; grace 0 releases at the deadline', async () => {
    const input = await policyInput();
    expect(input).toMatchObject({ paymentGraceMinutes: 3, autoReinstateLatePayment: true });
    const { paymentGraceMinutes: _g, autoReinstateLatePayment: _a, ...rest } = input;
    expect(await s.operators.updatePolicy(seed.op.id, rest)).toMatchObject({ paymentGraceMinutes: 3, autoReinstateLatePayment: true });
    expect(await errorCode(s.operators.updatePolicy(seed.op.id, { ...rest, paymentGraceMinutes: 31 }))).toBeDefined();
    await s.operators.updatePolicy(seed.op.id, { ...rest, paymentGraceMinutes: 0 });
    try {
      const seat = nextSeat();
      const h = await hold([seat]);
      expect(h.booking.releaseAt).toBe(h.booking.holdExpiresAt);
      s.clock.advanceMinutes(10);
      expect(await seatStatus(seat)).toBe('AVAILABLE');
    } finally {
      await s.operators.updatePolicy(seed.op.id, input);
    }
  });
});

describe('background hold sweeper', () => {
  it('ignores invalid intervals instead of spinning every millisecond', () => {
    expect(new HoldSweepConfig(Number('abc')).intervalMs).toBe(0);
    expect(new HoldSweepConfig(-5).intervalMs).toBe(0);
    expect(new HoldSweepConfig(500).intervalMs).toBe(0);
    expect(new HoldSweepConfig(60_000).intervalMs).toBe(60_000);
  });

  it('expires overdue holds in the database once, and overlapping sweeps do not double-run', async () => {
    const sweeper = app.get(HoldSweeper);
    s.clock.advanceMinutes(60 * 24);
    await sweeper.sweep(); // dọn đơn tồn từ các test trước
    s.clock.set(T0);
    const seat = nextSeat();
    const h = await hold([seat]);
    s.clock.advanceMinutes(12);
    expect(await sweeper.sweep()).toBe(0); // còn trong ân hạn
    expect((await bookingRow(h.booking.code)).status).toBe('HOLDING');
    s.clock.advanceMinutes(2);
    const [n1, n2] = await Promise.all([sweeper.sweep(), sweeper.sweep()]);
    expect(n1 + n2).toBe(1);
    expect((await bookingRow(h.booking.code)).status).toBe('EXPIRED');
    const { rows } = await s.db.query(
      'SELECT 1 FROM trip_seats ts JOIN bookings b ON b.id = ts.booking_id WHERE b.code = $1',
      [h.booking.code],
    );
    expect(rows).toHaveLength(0);
  });
});
