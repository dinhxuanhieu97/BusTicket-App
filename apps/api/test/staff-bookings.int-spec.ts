import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import {
  AUTH_SECRET, RELAXED_ABUSE, Services, T0, TEST_DB_URL, TOKEN_SECRET,
  buildServices, errorCode, newKey, resetDatabase, seedOperatorWithTrips,
} from './helpers';

let s: Services;
let app: INestApplication;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let other: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
const tokens: Record<string, string> = {};
const PASSWORD = 'staff-booking-test-password-1';
const STAFF = {
  owner: { role: 'OWNER', phone: '0907000001' },
  dispatcher: { role: 'DISPATCHER', phone: '0907000002' },
  seller: { role: 'SELLER', phone: '0907000003' },
  accountant: { role: 'ACCOUNTANT', phone: '0907000004' },
  assistant: { role: 'ASSISTANT', phone: '0907000005' },
} as const;
const STOPS = {
  pickup: [
    { name: 'Bến xe Miền Đông', time: '17:30', day: 0 },
    { name: 'Ngã tư Thủ Đức', time: '18:15', day: 0 },
  ],
  dropoff: [{ name: 'Hoài Ân', time: '05:30', day: 1 }],
};

const http = () => request(app.getHttpServer());
const bearer = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
const base = (tripId: string, op = seed.op.id) => `/api/v1/admin/operators/${op}/trips/${tripId}`;
const counter = (who: string, tripId: string, body: object, opts: { dryRun?: boolean; key?: string | null; op?: string } = {}) => {
  const r = http().post(`${base(tripId, opts.op)}/bookings${opts.dryRun ? '?dryRun=true' : ''}`).set(bearer(who));
  if (!opts.dryRun && opts.key !== null) r.set('Idempotency-Key', opts.key ?? newKey());
  return r.send(body);
};
const importRows = (who: string, tripId: string, body: object, opts: { dryRun?: boolean; key?: string | null } = {}) => {
  const r = http().post(`${base(tripId)}/passengers/import${opts.dryRun ? '?dryRun=true' : ''}`).set(bearer(who));
  if (!opts.dryRun && opts.key !== null) r.set('Idempotency-Key', opts.key ?? newKey());
  return r.send(body);
};

async function login(who: string, phone: string) {
  const r = await http().post('/api/v1/auth/login').send({ phone, password: PASSWORD }).expect(200);
  tokens[who] = r.body.accessToken;
}

async function freeSeats(tripId: string, n: number, floor?: string) {
  const { rows } = await s.db.query<{ seat_code: string }>(
    `SELECT seat_code FROM trip_seats WHERE trip_id = $1 AND sellable AND booking_id IS NULL AND ($2::text IS NULL OR floor = $2)
     ORDER BY length(seat_code), seat_code LIMIT $3`,
    [tripId, floor ?? null, n],
  );
  if (rows.length < n) throw new Error('not enough free seats');
  return rows.map((r) => r.seat_code);
}

async function price(tripId: string, seat: string, occupancy = 1) {
  const { rows } = await s.db.query<{ price: number }>(
    `SELECT f.price FROM trip_fares f JOIN trip_seats ts ON ts.trip_id = f.trip_id AND ts.floor = f.floor
     WHERE f.trip_id = $1 AND ts.seat_code = $2 AND f.occupancy = $3`,
    [tripId, seat, occupancy],
  );
  return rows[0]!.price;
}

const countBookings = async (tripId: string) =>
  (await s.db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM bookings WHERE trip_id = $1 AND channel = $2', [tripId, 'STAFF'])).rows[0]!.n;

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  other = await seedOperatorWithTrips(s, 'AB');
  await s.trips.saveStops(seed.op.id, seed.route.id, STOPS);
  const users = new UsersService(s.db, s.clock);
  for (const [key, v] of Object.entries(STAFF))
    await users.createStaff(seed.op.id, { fullName: `NV ${key}`, role: v.role, phone: v.phone, password: PASSWORD });
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
  for (const [key, v] of Object.entries(STAFF)) await login(key, v.phone);
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

beforeEach(() => s.clock.set(T0));

describe('counter sales (C1)', () => {
  it('creates a confirmed STAFF booking with cash, pickup/drop-off snapshot, creator and audit', async () => {
    const tripId = seed.limoTrip.id;
    const [seat] = await freeSeats(tripId, 1, '1');
    const total = await price(tripId, seat!);
    const r = await counter('seller', tripId, {
      contactName: 'Khách Quầy', contactPhone: '0913 111 001', items: [{ seatCode: seat }], paidAmount: total,
      pickupStop: 'ngã tư  thủ đức', dropoffStop: 'Hoài Ân', note: 'Mang 2 kiện hàng',
    }).expect(200);
    expect(r.body.replayed).toBe(false);
    expect(r.body.booking).toMatchObject({
      status: 'CONFIRMED', seats: [seat], totalAmount: total, paidAmount: total, dueAmount: 0, paymentStatus: 'PAID', holdUntil: null,
    });
    const code = r.body.booking.code as string;
    expect(code).toMatch(/^PN[A-Z0-9]{6}$/);

    const { rows: [b] } = await s.db.query(
      `SELECT b.channel, b.contact_phone, b.pickup_stop, b.dropoff_stop, b.confirmed_at, u.full_name AS creator
       FROM bookings b JOIN users u ON u.id = b.created_by WHERE b.code = $1`, [code],
    );
    expect(b).toMatchObject({
      channel: 'STAFF', contact_phone: '+84913111001', creator: 'NV seller',
      pickup_stop: { name: 'Ngã tư Thủ Đức', time: '18:15', day: 0 }, dropoff_stop: { name: 'Hoài Ân', time: '05:30', day: 1 },
    });
    expect(b!.confirmed_at).not.toBeNull();
    const { rows: pays } = await s.db.query(
      `SELECT p.method, p.amount::int AS amount, p.allocated_amount::int AS allocated, a.amount AS alloc
       FROM payments p JOIN payment_allocations a ON a.payment_id = p.id JOIN bookings b ON b.id = a.booking_id WHERE b.code = $1`, [code],
    );
    expect(pays).toEqual([{ method: 'CASH', amount: total, allocated: total, alloc: total }]);
    const { rows: seats } = await s.db.query(
      'SELECT b.code FROM trip_seats ts JOIN bookings b ON b.id = ts.booking_id WHERE ts.trip_id = $1 AND ts.seat_code = $2', [tripId, seat],
    );
    expect(seats).toEqual([{ code }]);
    const { rows: events } = await s.db.query('SELECT type, payload FROM outbox_events WHERE payload->>\'bookingCode\' = $1 ORDER BY id', [code]);
    expect(events.map((e) => e.type)).toEqual(['payment.allocated', 'booking.confirmed']);
    expect(events[1]!.payload).toMatchObject({ channel: 'STAFF', notifyCustomer: true });
    const { rows: audit } = await s.db.query(`SELECT data FROM audit_logs WHERE action = 'booking.create_staff' AND data->>'bookingCode' = $1`, [code]);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain('Khách Quầy');

    const detail = await http().get(base(tripId)).set(bearer('seller')).expect(200);
    expect(detail.body.stops).toEqual(STOPS);
    // Danh sách khách hiện điểm đón và người tạo đơn; phụ xe thấy điểm đón nhưng không thấy người tạo.
    const list = await http().get(`${base(tripId)}/passengers`).set(bearer('owner')).expect(200);
    expect(list.body.bookings.find((x: { code: string }) => x.code === code)).toMatchObject({
      channel: 'STAFF', createdBy: 'NV seller', pickupStop: { name: 'Ngã tư Thủ Đức' }, dropoffStop: { name: 'Hoài Ân' },
    });
  });

  it('confirms without payment by default and holds with a deadline when asked to wait for a transfer', async () => {
    const tripId = seed.limoTrip.id;
    const [a, b, c] = await freeSeats(tripId, 3, '1');
    const unpaid = await counter('dispatcher', tripId, { contactName: 'Thu Trên Xe', contactPhone: '0913111002', items: [{ seatCode: a }] }).expect(200);
    expect(unpaid.body.booking).toMatchObject({ status: 'CONFIRMED', paidAmount: 0, paymentStatus: 'UNPAID' });
    expect(unpaid.body.booking.dueAmount).toBe(unpaid.body.booking.totalAmount);

    const held = await counter('seller', tripId, { contactName: 'Chờ Chuyển Khoản', contactPhone: '0913111003', items: [{ seatCode: b }], confirm: false }).expect(200);
    expect(held.body.booking.status).toBe('HOLDING');
    expect(new Date(held.body.booking.holdUntil).getTime()).toBe(T0.getTime() + 10 * 60_000);
    // Đơn giữ chỗ tại quầy hết hạn và nhả chỗ như đơn online.
    s.clock.set(new Date(T0.getTime() + 3600_000));
    const after = await counter('seller', tripId, { contactName: 'Khách Sau', contactPhone: '0913111004', items: [{ seatCode: b }] }).expect(200);
    expect(after.body.booking.status).toBe('CONFIRMED');

    // Không xác nhận ngay nhưng đã trả đủ cọc → xác nhận.
    const deposit = await counter('seller', tripId, {
      contactName: 'Trả Cọc', contactPhone: '0913111005', items: [{ seatCode: c }], confirm: false, paidAmount: await price(tripId, c!),
    }).expect(200);
    expect(deposit.body.booking).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
  });

  it('quotes with dryRun without writing and reports seats that are already taken', async () => {
    const tripId = seed.bedTrip.id;
    const [free, taken] = await freeSeats(tripId, 2);
    await s.bookings.createHold({ tripId, contactName: 'Online', contactPhone: '0913111010', items: [{ seatCode: taken! }] }, newKey());
    const before = await countBookings(tripId);
    const ok = await counter('seller', tripId, { contactName: 'Hỏi Giá', contactPhone: '0913111011', items: [{ seatCode: free }] }, { dryRun: true }).expect(200);
    expect(ok.body).toMatchObject({ ok: true, issues: [], quote: { status: 'CONFIRMED', totalAmount: await price(tripId, free!) } });
    const bad = await counter('seller', tripId, { contactName: 'Hỏi Giá', contactPhone: '0913111011', items: [{ seatCode: taken }] }, { dryRun: true }).expect(200);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.issues[0].message).toMatch(new RegExp(`chỗ ${taken} đã có đơn PN`));
    expect(await countBookings(tripId)).toBe(before);
    const write = await counter('seller', tripId, { contactName: 'Hỏi Giá', contactPhone: '0913111011', items: [{ seatCode: taken }] }).expect(409);
    expect(write.body.error.code).toBe('SEAT_UNAVAILABLE');
  });

  it('replays the same Idempotency-Key and rejects it for a different request', async () => {
    const tripId = seed.bedTrip.id;
    const [seat] = await freeSeats(tripId, 1);
    const key = newKey();
    const body = { contactName: 'Bấm Hai Lần', contactPhone: '0913111020', items: [{ seatCode: seat }], paidAmount: 100_000 };
    const first = await counter('seller', tripId, body, { key }).expect(200);
    const again = await counter('seller', tripId, body, { key }).expect(200);
    expect(again.body).toMatchObject({ replayed: true, booking: { code: first.body.booking.code, paidAmount: 100_000 } });
    const { rows } = await s.db.query('SELECT COUNT(*)::int AS n FROM payments WHERE content = $1', [first.body.booking.code]);
    expect(rows[0]!.n).toBe(1);
    const changed = await counter('seller', tripId, { ...body, paidAmount: 0 }, { key }).expect(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await counter('seller', tripId, body, { key: null }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
  });

  it('lets exactly one of two clerks selling the same seat at the same time succeed', async () => {
    const tripId = seed.bedTrip.id;
    const [seat] = await freeSeats(tripId, 1);
    const results = await Promise.all(
      ['seller', 'dispatcher', 'owner'].map((who, i) =>
        counter(who, tripId, { contactName: `Song Song ${i}`, contactPhone: `091311103${i}`, items: [{ seatCode: seat }] })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('SEAT_UNAVAILABLE');
    const { rows } = await s.db.query(
      `SELECT COUNT(*)::int AS n FROM booking_items i JOIN bookings b ON b.id = i.booking_id
       WHERE i.trip_id = $1 AND i.seat_code = $2 AND b.status = 'CONFIRMED'`, [tripId, seat],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('enforces permission, tenant isolation, trip state, stops and money limits', async () => {
    const tripId = seed.bedTrip.id;
    const [seat] = await freeSeats(tripId, 1);
    const body = { contactName: 'Khách', contactPhone: '0913111040', items: [{ seatCode: seat }] };
    const before = await countBookings(tripId);
    expect((await counter('accountant', tripId, body).expect(403)).body.error.code).toBe('FORBIDDEN');
    await counter('assistant', tripId, body).expect(403);
    // Chuyến của nhà xe khác → 404, kể cả khi đổi :operatorId trên đường dẫn (guard không cho ra ngoài nhà xe mình).
    await counter('seller', other.bedTrip.id, body).expect(404);
    await counter('seller', other.bedTrip.id, body, { op: other.op.id }).expect(404);

    const bad = async (patch: object, code = 'VALIDATION_FAILED') =>
      expect((await counter('seller', tripId, { ...body, ...patch })).body.error.code).toBe(code);
    await bad({ pickupStop: 'Chợ Lớn' });
    await bad({ contactPhone: '12345' });
    await bad({ paidAmount: 99_000_000 });
    await bad({ items: [{ seatCode: seat }, { seatCode: seat }] });
    await bad({ items: [{ seatCode: 'ZZ99' }] });
    expect(await countBookings(tripId)).toBe(before);

    // Đóng bán online: quầy vẫn bán. Nháp/đã hủy/đã khởi hành: không.
    await s.trips.setStatus(seed.op.id, tripId, 'CLOSED');
    const soldKey = newKey();
    const sold = await counter('seller', tripId, body, { key: soldKey }).expect(200);
    await s.trips.setStatus(seed.op.id, tripId, 'OPEN');
    const [next] = await freeSeats(tripId, 1);
    for (const status of ['DRAFT', 'CANCELLED']) {
      await s.db.query('UPDATE trips SET status = $2 WHERE id = $1', [tripId, status]);
      expect((await counter('seller', tripId, { ...body, items: [{ seatCode: next }] }).expect(409)).body.error.code).toBe('TRIP_NOT_ON_SALE');
    }
    await s.db.query(`UPDATE trips SET status = 'OPEN' WHERE id = $1`, [tripId]);
    // Đã qua giờ khởi hành (dời giờ chuyến về trước T0 thay vì tua đồng hồ để phiên đăng nhập còn hạn).
    const { rows: [orig] } = await s.db.query('SELECT depart_at, sales_close_at FROM trips WHERE id = $1', [tripId]);
    await s.db.query('UPDATE trips SET sales_close_at = $2, depart_at = $3 WHERE id = $1',
      [tripId, new Date(T0.getTime() - 120_000), new Date(T0.getTime() - 60_000)]);
    try {
      expect((await counter('seller', tripId, { ...body, items: [{ seatCode: next }] }).expect(409)).body.error.code).toBe('TRIP_NOT_ON_SALE');
      // Gửi lại đúng yêu cầu đã bán sau giờ chạy vẫn nhận lại kết quả cũ.
      const again = await counter('seller', tripId, body, { key: soldKey }).expect(200);
      expect(again.body).toMatchObject({ replayed: true, booking: { code: sold.body.booking.code } });
    } finally {
      await s.db.query('UPDATE trips SET depart_at = $2, sales_close_at = $3 WHERE id = $1', [tripId, orig!.depart_at, orig!.sales_close_at]);
    }
  });
});

describe('online pickup / drop-off (C3)', () => {
  it('stores the chosen stops on an online hold and rejects stops outside the route', async () => {
    const tripId = seed.limoTrip.id;
    const [seat, seat2] = await freeSeats(tripId, 2, '2');
    const r = await s.bookings.createHold(
      { tripId, contactName: 'Online Đón', contactPhone: '0913111050', items: [{ seatCode: seat! }], pickupStop: 'Bến xe Miền Đông' },
      newKey(),
    );
    expect(r.booking.pickupStop).toEqual({ name: 'Bến xe Miền Đông', time: '17:30', day: 0 });
    expect(r.booking).not.toHaveProperty('dropoffStop');
    expect(await errorCode(s.bookings.createHold(
      { tripId, contactName: 'Online Sai', contactPhone: '0913111051', items: [{ seatCode: seat2! }], dropoffStop: 'Quy Nhơn' }, newKey(),
    ))).toBe('VALIDATION_FAILED');
  });
});

describe('import new passengers (B3)', () => {
  it('previews grouped bookings, per-row errors and price warnings without writing anything', async () => {
    const tripId = seed.limoTrip.id;
    const [a, b, c, d, onlineSeat] = await freeSeats(tripId, 5, '1');
    const online = await s.bookings.createHold({ tripId, contactName: 'Online', contactPhone: '0913111060', items: [{ seatCode: onlineSeat! }] }, newKey());
    const before = await countBookings(tripId);
    const total = (await price(tripId, a!)) + (await price(tripId, b!));
    const r = await importRows('seller', tripId, {
      fileName: 'danh-sach.xlsx',
      rows: [
        { row: 2, seatCode: a, contactName: 'Nguyễn Văn Nhập', contactPhone: 912222001, totalAmount: 1, paidAmount: '200.000', pickupStop: 'Bến xe Miền Đông' },
        { row: 3, seatCode: ` ${b!.toLowerCase()} `, contactName: 'nguyễn  văn nhập', contactPhone: '0912 222 001' },
        { row: 4, seatCode: onlineSeat, contactName: 'Trùng Online', contactPhone: '0912222002' },
        { row: 5, seatCode: c, contactName: 'Khách Lỗi', contactPhone: 'abc' },
        { row: 6, seatCode: 'ZZ9', contactName: 'Không Có Chỗ', contactPhone: '0912222003' },
        { row: 7, seatCode: d, contactName: 'Khách D', contactPhone: '0912222004', pickupStop: 'Chợ Lớn' },
        { row: 8, seatCode: d, contactName: '', contactPhone: '0912222005' },
        { row: 9, seatCode: c, contactName: 'Trả Dư', contactPhone: '0912222006', paidAmount: 99_000_000 },
      ],
    }, { dryRun: true }).expect(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.bookings).toHaveLength(1);
    expect(r.body.bookings[0]).toMatchObject({
      rows: [2, 3], contactName: 'Nguyễn Văn Nhập', contactPhone: '+84912222001', status: 'CONFIRMED',
      totalAmount: total, paidAmount: 200_000, dueAmount: total - 200_000, pickupStop: { name: 'Bến xe Miền Đông' },
    });
    expect(r.body.bookings[0].seats.map((x: { code: string }) => x.code)).toEqual([a, b]);
    const messages = r.body.issues.map((i: { message: string }) => i.message);
    expect(messages).toEqual([
      `Dòng 4: chỗ ${onlineSeat} đã có đơn ${online.booking.code}.`,
      'Dòng 5: SĐT không hợp lệ.',
      `Dòng 6: chỗ ZZ9 không có trên xe này.`,
      'Dòng 7: điểm đón không có trong tuyến của chuyến.',
      'Dòng 8: thiếu Họ tên khách.',
      'Dòng 9: đã trả 99.000.000đ lớn hơn tổng tiền ' + `${(await price(tripId, c!)).toLocaleString('vi-VN')}đ.`,
    ]);
    expect(r.body.warnings).toEqual([{ rows: [2, 3], message: expect.stringContaining('dùng giá hệ thống') }]);
    // Thông báo lỗi không chứa họ tên/SĐT khách.
    expect(JSON.stringify(r.body.issues)).not.toMatch(/Khách Lỗi|0912222/);
    expect(await countBookings(tripId)).toBe(before);

    const dup = await importRows('seller', tripId, {
      rows: [{ row: 2, seatCode: a, contactName: 'X', contactPhone: '0912222010' }, { row: 5, seatCode: a, contactName: 'Y', contactPhone: '0912222011' }],
    }, { dryRun: true }).expect(200);
    expect(dup.body.issues).toEqual([{ rows: [2, 5], message: `Dòng 2 và 5 cùng chỗ ${a}.` }]);
  });

  it('names the rows whose pickup points conflict and reads money/phone cells strictly', async () => {
    const tripId = seed.limoTrip.id;
    const [a, b, c, d] = await freeSeats(tripId, 4, '1');
    const r = await importRows('seller', tripId, {
      rows: [
        { row: 2, seatCode: a, contactName: 'Khách Gộp', contactPhone: '0912333001' },
        { row: 3, seatCode: b, contactName: 'Khách Gộp', contactPhone: '912 333 001', pickupStop: 'Bến xe Miền Đông' },
        { row: 4, seatCode: c, contactName: 'Khách Gộp', contactPhone: '0912333001', pickupStop: 'Ngã tư Thủ Đức' },
        { row: 5, seatCode: d, contactName: 'Tiền Lẻ', contactPhone: '0912333002', paidAmount: '5000.00' },
      ],
    }, { dryRun: true }).expect(200);
    expect(r.body.issues.map((i: { message: string }) => i.message)).toEqual([
      'Dòng 3 và 4 cùng khách nhưng khác điểm đón.',
      'Dòng 5: Đã trả phải là số tiền không âm.',
    ]);
    expect(r.body.bookings).toHaveLength(0);
  });

  it('writes all rows or none, and replays the same file without creating duplicates', async () => {
    const tripId = seed.bedTrip.id;
    const [a, b, c] = await freeSeats(tripId, 3);
    const rows = [
      { row: 2, seatCode: a, contactName: 'Nhập Một', contactPhone: '0912333001', paidAmount: 50_000 },
      { row: 3, seatCode: b, contactName: 'Nhập Hai', contactPhone: '0912333002' },
    ];
    const before = await countBookings(tripId);
    // Còn dòng lỗi → không tạo đơn nào.
    const failed = await importRows('owner', tripId, { rows: [...rows, { row: 4, seatCode: c, contactName: 'Lỗi', contactPhone: 'x' }] }).expect(400);
    expect(failed.body.error.details.issues).toEqual([{ rows: [4], message: 'Dòng 4: SĐT không hợp lệ.' }]);
    expect(await countBookings(tripId)).toBe(before);

    const key = newKey();
    const ok = await importRows('owner', tripId, { fileName: 'khach.xlsx', rows, notifyCustomer: false }, { key }).expect(200);
    expect(ok.body.replayed).toBe(false);
    expect(ok.body.bookings.map((x: { rows: number[]; status: string }) => [x.rows, x.status])).toEqual([[[2], 'CONFIRMED'], [[3], 'CONFIRMED']]);
    expect(await countBookings(tripId)).toBe(before + 2);
    const again = await importRows('owner', tripId, { fileName: 'khach.xlsx', rows, notifyCustomer: false }, { key }).expect(200);
    expect(again.body).toEqual({ ...ok.body, replayed: true });
    expect(await countBookings(tripId)).toBe(before + 2);
    expect((await importRows('owner', tripId, { rows: rows.slice(0, 1) }, { key }).expect(409)).body.error.code).toBe('IDEMPOTENCY_CONFLICT');

    const { rows: events } = await s.db.query(
      `SELECT payload FROM outbox_events WHERE type = 'booking.confirmed' AND payload->>'bookingCode' = ANY($1)`,
      [ok.body.bookings.map((x: { code: string }) => x.code)],
    );
    expect(events.map((e) => e.payload.notifyCustomer)).toEqual([false, false]);
    const { rows: log } = await s.db.query(`SELECT data FROM audit_logs WHERE action = 'booking.import' ORDER BY at DESC LIMIT 1`);
    expect(log[0]!.data).toMatchObject({ fileName: 'khach.xlsx', rows: 2, bookings: 2, seats: 2 });
  });

  it('rejects the whole file when an online customer takes a seat after the preview', async () => {
    const tripId = seed.bedTrip.id;
    const [a, b] = await freeSeats(tripId, 2);
    const body = { rows: [
      { row: 2, seatCode: a, contactName: 'Chậm Một', contactPhone: '0912444001' },
      { row: 3, seatCode: b, contactName: 'Chậm Hai', contactPhone: '0912444002' },
    ] };
    expect((await importRows('seller', tripId, body, { dryRun: true }).expect(200)).body.ok).toBe(true);
    const online = await s.bookings.createHold({ tripId, contactName: 'Nhanh Tay', contactPhone: '0912444003', items: [{ seatCode: b! }] }, newKey());
    const before = await countBookings(tripId);
    const r = await importRows('seller', tripId, body).expect(409);
    expect(r.body.error.code).toBe('SEAT_UNAVAILABLE');
    expect(r.body.error.details.issues).toEqual([{ rows: [3], message: `Dòng 3: chỗ ${b} đã có đơn ${online.booking.code}.` }]);
    expect(await countBookings(tripId)).toBe(before);
    const { rows } = await s.db.query('SELECT booking_id FROM trip_seats WHERE trip_id = $1 AND seat_code = $2', [tripId, a]);
    expect(rows[0]!.booking_id).toBeNull();
  });

  it('creates bookings once when the same file is submitted twice at the same time', async () => {
    const tripId = seed.limoTrip.id;
    const seats = await freeSeats(tripId, 3, '2');
    const body = { rows: seats.map((seatCode, i) => ({ row: i + 2, seatCode, contactName: `Đồng Thời ${i}`, contactPhone: `091255500${i}` })) };
    const key = newKey();
    const before = await countBookings(tripId);
    const [x, y] = await Promise.all([importRows('seller', tripId, body, { key }), importRows('dispatcher', tripId, body, { key })]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect([x.body.replayed, y.body.replayed].sort()).toEqual([false, true]);
    expect(await countBookings(tripId)).toBe(before + 3);
  });

  it('limits file size and needs booking.create', async () => {
    const tripId = seed.bedTrip.id;
    const many = Array.from({ length: 201 }, (_, i) => ({ row: i + 2, seatCode: 'A1', contactName: 'X', contactPhone: '0912666000' }));
    expect((await importRows('seller', tripId, { rows: many }, { dryRun: true }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    await importRows('accountant', tripId, { rows: many.slice(0, 1) }, { dryRun: true }).expect(403);
    await importRows('seller', tripId, { rows: [{ row: 2, seatCode: 'A1', contactName: 'X', contactPhone: '0912666000', extra: 1 }] }, { dryRun: true }).expect(400);
  });
});
