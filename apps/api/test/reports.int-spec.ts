import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { ReportsService } from '../src/reports/reports.service';
import {
  AUTH_SECRET, RELAXED_ABUSE, Services, T0, TEST_DB_URL, TOKEN_SECRET,
  buildServices, newKey, resetDatabase, seedOperatorWithTrips,
} from './helpers';

let s: Services;
let app: INestApplication;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let other: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
const tokens: Record<string, string> = {};
const PASSWORD = 'reports-test-password-1';
const STAFF = {
  owner: { role: 'OWNER', phone: '0908100001' },
  dispatcher: { role: 'DISPATCHER', phone: '0908100002' },
  seller: { role: 'SELLER', phone: '0908100003' },
  accountant: { role: 'ACCOUNTANT', phone: '0908100004' },
  assistant: { role: 'ASSISTANT', phone: '0908100005' },
} as const;
const DAY = 86_400_000;

const http = () => request(app.getHttpServer());
const bearer = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
const opBase = (op = seed.op.id) => `/api/v1/admin/operators/${op}`;

async function sell(tripId: string, opts: { paid?: number; confirm?: boolean; seats?: number; name?: string } = {}) {
  const { rows } = await s.db.query<{ seat_code: string }>(
    `SELECT seat_code FROM trip_seats WHERE trip_id = $1 AND sellable AND booking_id IS NULL ORDER BY length(seat_code), seat_code LIMIT $2`,
    [tripId, opts.seats ?? 1],
  );
  const r = await http()
    .post(`${opBase()}/trips/${tripId}/bookings`)
    .set(bearer('seller'))
    .set('Idempotency-Key', newKey())
    .send({
      contactName: opts.name ?? 'Khách Báo Cáo', contactPhone: '0913222333', items: rows.map((x) => ({ seatCode: x.seat_code })),
      paidAmount: opts.paid ?? 0, confirm: opts.confirm ?? true, notifyCustomer: false,
    })
    .expect(200);
  return r.body.booking as { code: string };
}
const ACCOUNTS: Record<string, string> = { ...Object.fromEntries(Object.entries(STAFF).map(([k, v]) => [k, v.phone])), otherOwner: '0908100009' };
async function login(...who: string[]) {
  for (const key of who) {
    const r = await http().post('/api/v1/auth/login').send({ phone: ACCOUNTS[key], password: PASSWORD }).expect(200);
    tokens[key] = r.body.accessToken;
  }
}
const cancel = (code: string) =>
  http().post(`${opBase()}/bookings/${code}/cancel`).set(bearer('dispatcher')).send({ reason: 'Khách đổi lịch' }).expect(200);

let paidCode = '';
let refundedCode = '';

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  other = await seedOperatorWithTrips(s, 'AB');
  const users = new UsersService(s.db, s.clock);
  for (const [key, v] of Object.entries(STAFF)) {
    await users.createStaff(seed.op.id, { fullName: `NV ${key}`, role: v.role, phone: v.phone, password: PASSWORD });
  }
  await users.createStaff(other.op.id, { fullName: 'NV khác', role: 'OWNER', phone: '0908100009', password: PASSWORD });
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
  await login(...Object.keys(ACCOUNTS));

  // Ngày 20/01/2027 (giờ VN, 10:00): 4 đơn thật + 1 đơn đang giữ + 1 giữ chỗ hết hạn.
  paidCode = (await sell(seed.limoTrip.id, { paid: 100_000, seats: 2, name: 'Trần Thị Mai' })).code; // xác nhận, 2 chỗ
  await sell(seed.bedTrip.id); // xác nhận, chưa trả
  await cancel((await sell(seed.bedTrip.id, { confirm: false })).code); // nhân viên hủy giữ chỗ
  refundedCode = (await sell(seed.bedTrip.id, { paid: 50_000 })).code;
  await cancel(refundedCode); // nhân viên hủy, phát sinh khoản cần hoàn 50.000
  await sell(seed.bedTrip.id, { confirm: false }); // vẫn đang giữ
  const expired = await sell(seed.bedTrip.id, { confirm: false });
  await s.db.query(`UPDATE bookings SET status = 'EXPIRED' WHERE code = $1`, [expired.code]);

  // Ngày 21/01: một khoản chuyển khoản chưa khớp đơn + hoàn xong khoản 50.000.
  const next = new Date(T0.getTime() + DAY);
  await s.db.query(
    `INSERT INTO payments (operator_id, method, amount, reference_code, transaction_at, received_at, review_status, review_reason)
     VALUES ($1, 'MANUAL_BANK', 30000, 'FT-REPORT-1', $2, $2, 'NEEDS_REVIEW', 'UNMATCHED')`,
    [seed.op.id, next],
  );
  const list = await http().get(`${opBase()}/refunds`).set(bearer('accountant')).expect(200);
  const refund = list.body.refunds.find((r: { bookingCode: string }) => r.bookingCode === refundedCode);
  await http().post(`${opBase()}/refunds/${refund.id}/resolve`).set(bearer('accountant')).send({ status: 'REFUNDED' }).expect(200);
  // Token truy cập ngắn hạn: không tua đồng hồ qua ngày, chỉ dời thời điểm hoàn sang 21/01.
  await s.db.query('UPDATE refund_obligations SET resolved_at = $2 WHERE id = $1', [refund.id, next]);

  // Nhà xe khác có tiền cùng ngày: không được lẫn vào báo cáo.
  await s.db.query(
    `INSERT INTO payments (operator_id, method, amount, transaction_at, received_at) VALUES ($1, 'CASH', 999000, $2, $2)`,
    [other.op.id, T0],
  );
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

beforeEach(() => s.clock.set(T0));

describe('revenue report', () => {
  const url = `/reports/revenue?from=2027-01-20&to=2027-01-22`;

  it('returns net = received − refunded per day, method, hour and route', async () => {
    const r = await http().get(`${opBase()}${url}`).set(bearer('accountant')).expect(200);
    expect(r.body.totals).toEqual({ received: 180_000, refunded: 50_000, net: 130_000, payments: 3, refunds: 1 });
    expect(r.body.byDay).toEqual([
      { date: '2027-01-20', received: 150_000, refunded: 0, net: 150_000, payments: 2, refunds: 0 },
      { date: '2027-01-21', received: 30_000, refunded: 50_000, net: -20_000, payments: 1, refunds: 1 },
    ]);
    expect(r.body.byMethod).toEqual([
      { method: 'CASH', amount: 150_000, count: 2 },
      { method: 'MANUAL_BANK', amount: 30_000, count: 1 },
    ]);
    expect(r.body.byHour).toEqual([{ hour: 10, amount: 180_000, count: 3 }]);
    expect(r.body.byRoute).toEqual([
      { code: 'HCM-HA', origin: 'TP.HCM', destination: 'Hoài Ân', received: 150_000, refunded: 50_000, net: 100_000, bookings: 2 },
    ]);
    expect(r.body.unallocated).toBe(30_000);
  });

  it('fills empty days and keeps the Vietnam-day boundary exclusive', async () => {
    const r = await http().get(`${opBase()}/reports/revenue?from=2027-01-19&to=2027-01-20`).set(bearer('owner')).expect(200);
    expect(r.body.byDay).toEqual([{ date: '2027-01-19', received: 0, refunded: 0, net: 0, payments: 0, refunds: 0 }]);
    expect(r.body.byRoute).toEqual([]);
  });

  it('rejects unbounded or reversed ranges', async () => {
    for (const q of ['from=2027-01-20&to=2027-01-20', 'from=2027-01-01&to=2028-02-01', 'from=2027-02-30&to=2027-03-01', 'from=2027-01-01', 'from=2027-01-01&to=2027-01-02&x=1']) {
      const r = await http().get(`${opBase()}/reports/revenue?${q}`).set(bearer('owner')).expect(400);
      expect(r.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('needs payment.read and stays inside the operator', async () => {
    await http().get(`${opBase()}${url}`).set(bearer('seller')).expect(200);
    for (const who of ['dispatcher', 'assistant']) await http().get(`${opBase()}${url}`).set(bearer(who)).expect(403);
    await http().get(`${opBase()}${url}`).set(bearer('otherOwner')).expect(404);
    const mine = await http().get(`${opBase(other.op.id)}${url}`).set(bearer('otherOwner')).expect(200);
    expect(mine.body.totals.received).toBe(999_000);
  });
});

describe('bookings report', () => {
  it('counts bookings created in the period and the staff cancel rate', async () => {
    const r = await http().get(`${opBase()}/reports/bookings?from=2027-01-20&to=2027-01-22`).set(bearer('dispatcher')).expect(200);
    expect(r.body.totals).toEqual({ bookings: 4, cancelled: 2, abandoned: 1, holding: 1, seats: 3, cancelRate: 0.5 });
    expect(r.body.byDay).toEqual([
      { date: '2027-01-20', bookings: 4, cancelled: 2, abandoned: 1, holding: 1, seats: 3 },
      { date: '2027-01-21', bookings: 0, cancelled: 0, abandoned: 0, holding: 0, seats: 0 },
    ]);
    const empty = await http().get(`${opBase()}/reports/bookings?from=2027-01-10&to=2027-01-11`).set(bearer('owner')).expect(200);
    expect(empty.body.totals.cancelRate).toBeNull();
  });

  it('needs booking.read', async () => {
    await http().get(`${opBase()}/reports/bookings?from=2027-01-20&to=2027-01-21`).set(bearer('assistant')).expect(403);
    await http().get(`${opBase()}/reports/bookings?from=2027-01-20&to=2027-01-21`).set(bearer('otherOwner')).expect(404);
  });
});

describe('counters', () => {
  it('counts trips closing within 2 hours and, for money roles, payments by review status', async () => {
    s.clock.set(new Date('2027-02-01T09:00:00Z')); // limo đóng bán 10:00Z (trong 2 giờ), giường 11:30Z (ngoài)
    await login('accountant', 'dispatcher', 'assistant', 'otherOwner');
    const money = await http().get(`${opBase()}/counters`).set(bearer('accountant')).expect(200);
    expect(money.body).toEqual({
      tripsClosingSoon: 1,
      payments: { total: 3, NONE: 2, NEEDS_REVIEW: 1, RESOLVED: 0 },
      refundsOpen: 0,
    });
    const ops = await http().get(`${opBase()}/counters`).set(bearer('dispatcher')).expect(200);
    expect(ops.body).toEqual({ tripsClosingSoon: 1, payments: null, refundsOpen: null });
    await http().get(`${opBase()}/counters`).set(bearer('assistant')).expect(403);
    await http().get(`${opBase()}/counters`).set(bearer('otherOwner')).expect(404);
  });

  it('counts open refunds', async () => {
    await login('seller', 'dispatcher', 'owner', 'accountant', 'assistant', 'otherOwner');
    const b = await sell(seed.limoTrip.id, { paid: 20_000 });
    await cancel(b.code);
    const r = await http().get(`${opBase()}/counters`).set(bearer('owner')).expect(200);
    expect(r.body.refundsOpen).toBe(1);
  });
});

describe('quick search', () => {
  type Hit = { code: string; contactName: string; contactPhone: string; trip: { id: string } };
  const search = (q: string, who = 'seller') => http().get(`${opBase()}/search`).query({ q }).set(bearer(who));

  it('finds bookings by ticket code, phone and name, and trips by code or name', async () => {
    const byCode = await search(paidCode.toLowerCase()).expect(200);
    expect(byCode.body.bookings[0]).toMatchObject({ code: paidCode, contactName: 'Trần Thị Mai', trip: { id: seed.limoTrip.id } });
    const byPhone = await search('0913 222').expect(200);
    expect(byPhone.body.bookings.length).toBeGreaterThan(0);
    expect(byPhone.body.bookings.every((b: Hit) => b.contactPhone === '+84913222333')).toBe(true);
    const byName = await search('thị mai').expect(200);
    expect(byName.body.bookings.map((b: Hit) => b.code)).toEqual([paidCode]);

    const { rows } = await s.db.query<{ code: string }>('SELECT code FROM trips WHERE id = $1', [seed.limoTrip.id]);
    const trips = await search(rows[0]!.code.slice(0, 8)).expect(200);
    expect(trips.body.trips.map((t: { id: string }) => t.id)).toContain(seed.limoTrip.id);
    const byTripName = await search('19:30').expect(200);
    expect(byTripName.body.trips.map((t: { id: string }) => t.id)).toEqual([seed.bedTrip.id]);
  });

  it('logs searches that return customers without storing the query', async () => {
    await search('Trần Thị').expect(200);
    const { rows } = await s.db.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM audit_logs WHERE action = 'booking.search' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0]!.data).toEqual({ bookings: 1 });
  });

  it('limits searches per user per minute and lets other users search (GB8)', async () => {
    s.clock.set(new Date('2027-01-20T06:00:00.000Z'));
    for (let i = 0; i < 60; i++) await search(`PN${i}`, 'seller').expect(200);
    const blocked = await search('PN', 'seller').expect(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    await search('PN', 'owner').expect(200);
    s.clock.set(new Date('2027-01-20T06:01:00.000Z'));
    await search('PN', 'seller').expect(200);
  });

  it('treats LIKE wildcards literally and hides erased contacts except by code', async () => {
    const wild = await search('%%').expect(200);
    expect(wild.body).toMatchObject({ trips: [], bookings: [] });
    await s.db.query(
      `UPDATE bookings SET contact_name = 'Khách đã xóa thông tin', contact_phone = '', contact_erased_at = now() WHERE code = $1`,
      [refundedCode],
    );
    const byName = await search('đã xóa').expect(200);
    expect(byName.body.bookings).toEqual([]);
    const byCode = await search(refundedCode).expect(200);
    expect(byCode.body.bookings.map((b: Hit) => b.code)).toEqual([refundedCode]);
  });

  it('scopes by role and operator', async () => {
    await search('a').expect(400);
    await search('PN', 'assistant').expect(403);
    await search('PN', 'otherOwner').expect(404);
    const otherOp = await http().get(`${opBase(other.op.id)}/search`).query({ q: paidCode }).set(bearer('otherOwner')).expect(200);
    expect(otherOp.body.bookings).toEqual([]);
  });
});

describe('review findings', () => {
  it('counts holds past their release time as abandoned before the sweeper runs', async () => {
    const reports = new ReportsService(s.db, s.clock);
    s.clock.set(new Date(T0.getTime() + DAY));
    const r = await reports.bookings(seed.op.id, { from: '2027-01-20', to: '2027-01-21' });
    expect(r.totals).toMatchObject({ holding: 0, abandoned: 2 });
  });

  it('splits a round-trip booking across the outbound and return routes', async () => {
    const reports = new ReportsService(s.db, s.clock);
    const back = await s.trips.createRoute(seed.op.id, { code: 'HA-HCM', origin: 'Hoài Ân', destination: 'TP.HCM' });
    const ret = await s.trips.createTrip(seed.op.id, {
      routeId: back.id, vehicleId: seed.bed.id, name: 'Hoài Ân → TP.HCM', departAt: new Date('2027-02-03T10:30:00Z'),
      salesOpenAt: new Date('2027-01-01T00:00:00Z'), salesCloseAt: new Date('2027-02-03T10:30:00Z'),
      fares: [{ floor: '1', occupancy: 1, price: 380_000 }, { floor: '2', occupancy: 1, price: 350_000 }],
    }, newKey());
    const day = new Date(T0.getTime() + 3 * DAY); // 23/01, chưa có số liệu khác
    s.clock.set(day);
    await login('seller');
    const b = await sell(seed.bedTrip.id, { paid: 100_000 });
    // Chặng về cùng giá chặng đi (đơn khứ hồi lưu thêm dòng đơn trên chuyến về).
    await s.db.query(
      `INSERT INTO booking_items (booking_id, trip_id, seat_code, occupancy, unit_price, line_total)
       SELECT bi.booking_id, $2, bi.seat_code, bi.occupancy, bi.unit_price, bi.line_total
       FROM booking_items bi JOIN bookings x ON x.id = bi.booking_id WHERE x.code = $1`,
      [b.code, ret.id],
    );
    const r = await reports.revenue(seed.op.id, { from: '2027-01-23', to: '2027-01-24' });
    expect(r.byRoute.map((x) => [x.code, x.received])).toEqual([['HA-HCM', 50_000], ['HCM-HA', 50_000]]);
    expect(r.unallocated).toBe(0);
  });
});

describe('authentication and authorization', () => {
  const urls = ['/reports/revenue?from=2027-01-20&to=2027-01-21', '/reports/bookings?from=2027-01-20&to=2027-01-21', '/counters', '/search?q=PN'];

  it('rejects requests without a valid bearer token', async () => {
    for (const url of urls) {
      await http().get(`${opBase()}${url}`).expect(401);
      await http().get(`${opBase()}${url}`).set({ Authorization: 'Bearer not-a-token' }).expect(401);
    }
  });

  it('gives the platform admin no money or customer data on any operator', async () => {
    ACCOUNTS.platform = '0908100010';
    await new UsersService(s.db, s.clock).createPlatformAdmin({ fullName: 'Quản trị nền tảng', phone: ACCOUNTS.platform, password: PASSWORD });
    await login('platform');
    await http().get(`${opBase()}${urls[0]}`).set(bearer('platform')).expect(403);
    await http().get(`${opBase()}${urls[1]}`).set(bearer('platform')).expect(403);
    const c = await http().get(`${opBase()}/counters`).set(bearer('platform')).expect(200);
    expect(c.body).toMatchObject({ payments: null, refundsOpen: null });
    const r = await http().get(`${opBase()}/search`).query({ q: paidCode }).set(bearer('platform')).expect(200);
    expect(r.body.bookings).toBeNull();
  });
});
