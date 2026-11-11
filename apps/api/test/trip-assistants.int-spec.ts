import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import {
  AUTH_SECRET, LIMO_FARES, RELAXED_ABUSE, Services, T0, TEST_DB_URL, TOKEN_SECRET,
  buildServices, newKey, resetDatabase, seedOperatorWithTrips,
} from './helpers';

let s: Services;
let app: INestApplication;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let other: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let users: UsersService;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const http = () => request(app.getHttpServer());
const bearer = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
const base = (op = seed.op.id) => `/api/v1/admin/operators/${op}`;
const assignPath = (tripId: string, op = seed.op.id) => `${base(op)}/trips/${tripId}/assistants`;
const assign = (who: string, tripId: string, userIds: string[], op = seed.op.id) =>
  http().put(assignPath(tripId, op)).set(bearer(who)).send({ userIds });
const myTrips = (who: string, op = seed.op.id) => http().get(`${base(op)}/my-trips`).set(bearer(who));
const passengers = (who: string, tripId: string, op = seed.op.id) =>
  http().get(`${base(op)}/my-trips/${tripId}/passengers`).set(bearer(who));

const STAFF = {
  owner: { role: 'OWNER', phone: '0907000001' },
  dispatcher: { role: 'DISPATCHER', phone: '0907000002' },
  seller: { role: 'SELLER', phone: '0907000003' },
  asstA: { role: 'ASSISTANT', phone: '0907000004' },
  asstB: { role: 'ASSISTANT', phone: '0907000005' },
  asstLocked: { role: 'ASSISTANT', phone: '0907000006' },
  asstArchived: { role: 'ASSISTANT', phone: '0907000007' },
} as const;
const PASSWORD = 'assistant-test-password-1';

async function login(who: string, phone: string) {
  const r = await http().post('/api/v1/auth/login').send({ phone, password: PASSWORD }).expect(200);
  tokens[who] = r.body.accessToken;
}

/** Đơn đã xác nhận: giữ chỗ qua service thật rồi chuyển trạng thái (thanh toán được kiểm tra ở bộ test riêng). */
async function confirmedBooking(tripId: string, name: string, phone: string, seats: string[], paid = 0) {
  const r = await s.bookings.createHold(
    { tripId, contactName: name, contactPhone: phone, items: seats.map((seatCode) => ({ seatCode })) },
    newKey(),
  );
  await s.db.query(
    `UPDATE bookings SET status = 'CONFIRMED', paid_amount = $2,
       payment_status = CASE WHEN $2 = 0 THEN 'UNPAID' WHEN $2 >= total_amount THEN 'PAID' ELSE 'PARTIAL' END
     WHERE code = $1`,
    [r.booking.code, paid],
  );
  return r.booking.code as string;
}

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  other = await seedOperatorWithTrips(s, 'AB');
  users = new UsersService(s.db, s.clock);
  for (const [key, v] of Object.entries(STAFF))
    ids[key] = (await users.createStaff(seed.op.id, { fullName: `NV ${key}`, role: v.role, phone: v.phone, password: PASSWORD })).id;
  ids.otherOwner = (await users.createStaff(other.op.id, { fullName: 'Chủ AB', role: 'OWNER', phone: '0907000101', password: PASSWORD })).id;
  ids.otherAsst = (await users.createStaff(other.op.id, { fullName: 'Phụ xe AB', role: 'ASSISTANT', phone: '0907000102', password: PASSWORD })).id;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET,
      abuse: RELAXED_ABUSE, clock: s.clock, authRequireMfa: false,
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  for (const [key, v] of Object.entries(STAFF)) await login(key, v.phone);
  await login('otherOwner', '0907000101');
  await login('otherAsst', '0907000102');
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

beforeEach(() => s.clock.set(T0));

it('lets OWNER and DISPATCHER assign assistants, and forbids SELLER and ASSISTANT', async () => {
  const candidates = await http().get(`${base()}/assistants`).set(bearer('dispatcher')).expect(200);
  expect(candidates.body.assistants.map((a: { id: string }) => a.id).sort())
    .toEqual([ids.asstA, ids.asstB, ids.asstLocked, ids.asstArchived].sort());
  await http().get(`${base()}/assistants`).set(bearer('seller')).expect(403);

  const r = await assign('dispatcher', seed.limoTrip.id, [ids.asstA!]).expect(200);
  expect(r.body.assistants).toEqual([
    { id: ids.asstA, fullName: 'NV asstA', phone: '+84907000004', active: true, assignedAt: T0.toISOString() },
  ]);
  await assign('owner', seed.limoTrip.id, [ids.asstA!, ids.asstB!]).expect(200);
  const listed = await http().get(assignPath(seed.limoTrip.id)).set(bearer('seller')).expect(200);
  expect(listed.body.assistants.map((a: { id: string }) => a.id).sort()).toEqual([ids.asstA, ids.asstB].sort());

  expect((await assign('seller', seed.limoTrip.id, [ids.asstA!]).expect(403)).body.error.code).toBe('FORBIDDEN');
  await assign('asstA', seed.limoTrip.id, [ids.asstA!]).expect(403);

  const { rows } = await s.db.query(
    `SELECT action, data->>'userId' AS user_id FROM audit_logs WHERE entity_id = $1 AND action LIKE 'trip.assistant.%' ORDER BY at, action`,
    [seed.limoTrip.id],
  );
  expect(rows).toEqual(expect.arrayContaining([
    { action: 'trip.assistant.assign', user_id: ids.asstA },
    { action: 'trip.assistant.assign', user_id: ids.asstB },
  ]));
  await assign('owner', seed.limoTrip.id, []).expect(200, { assistants: [] });
});

it('rejects non-assistants, other tenants\' users and trips, duplicates, and cancelled trips', async () => {
  const bad = async (userIds: string[]) =>
    expect((await assign('owner', seed.bedTrip.id, userIds).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
  await bad([ids.seller!]);
  await bad([ids.otherAsst!]);
  await bad([ids.asstA!, ids.asstA!]);
  await bad(['not-a-uuid']);
  await bad(Array.from({ length: 6 }, () => ids.asstA!));

  // Chuyến của nhà xe khác: guard chặn theo :operatorId, và id chuyến lạ dưới nhà xe mình là 404.
  await assign('owner', other.limoTrip.id, [ids.asstA!], other.op.id).expect(404);
  await assign('owner', other.limoTrip.id, [ids.asstA!]).expect(404);
  await assign('otherOwner', seed.limoTrip.id, [ids.otherAsst!], other.op.id).expect(404);

  const cancelled = await s.trips.createTrip(seed.op.id, {
    routeId: seed.route.id, vehicleId: seed.limo.id, name: 'Chuyến hủy',
    departAt: new Date('2027-02-03T11:00:00Z'), salesOpenAt: new Date('2027-01-01T00:00:00Z'),
    salesCloseAt: new Date('2027-02-03T10:00:00Z'), fares: LIMO_FARES,
  });
  await s.db.query(`UPDATE trips SET status = 'CANCELLED' WHERE id = $1`, [cancelled.id]);
  await assign('owner', cancelled.id, [ids.asstA!]).expect(400);
  const { rows } = await s.db.query('SELECT 1 FROM trip_assistants WHERE trip_id = $1', [seed.bedTrip.id]);
  expect(rows).toHaveLength(0);
});

it('shows an assistant only the trips assigned to them and only confirmed passengers of that trip', async () => {
  await assign('owner', seed.limoTrip.id, [ids.asstA!]).expect(200);
  await assign('owner', seed.bedTrip.id, [ids.asstB!]).expect(200);
  const paid = await confirmedBooking(seed.limoTrip.id, 'Khách Một', '0912000001', ['A1', 'A2'], 50_000);
  await confirmedBooking(seed.limoTrip.id, 'Khách Hai', '0912000002', ['B1']);
  await s.bookings.createHold({ tripId: seed.limoTrip.id, contactName: 'Đang giữ', contactPhone: '0912000003', items: [{ seatCode: 'A5' }] }, newKey());
  await confirmedBooking(seed.bedTrip.id, 'Khách Giường', '0912000004', [(await firstSellable(seed.bedTrip.id))]);

  const a = await myTrips('asstA').expect(200);
  expect(a.body.trips).toHaveLength(1);
  expect(a.body.trips[0]).toMatchObject({
    id: seed.limoTrip.id, route: { code: 'HCM-HA', origin: 'TP.HCM', destination: 'Hoài Ân' },
    bookingCount: 2, seatCount: 3,
  });

  const list = await passengers('asstA', seed.limoTrip.id).expect(200);
  expect(list.body.trip.id).toBe(seed.limoTrip.id);
  expect(list.body.bookings.map((b: { contactName: string }) => b.contactName).sort()).toEqual(['Khách Hai', 'Khách Một']);
  const one = list.body.bookings.find((b: { code: string }) => b.code === paid);
  expect(one).toMatchObject({ contactPhone: '+84912000001', paidAmount: 50_000, paymentStatus: 'PARTIAL' });
  expect(one.seats.map((x: { code: string }) => x.code)).toEqual(['A1', 'A2']);
  expect(one.dueAmount).toBe(one.totalAmount - 50_000);
  expect(list.body.summary).toMatchObject({ bookings: 2, seats: 3 });
  expect(JSON.stringify(list.body)).not.toContain('Đang giữ');

  // Không được giao → 404 như chuyến không tồn tại; không dò được chuyến của phụ xe khác hay nhà xe khác.
  await passengers('asstA', seed.bedTrip.id).expect(404);
  await passengers('asstB', seed.limoTrip.id).expect(404);
  await passengers('asstA', other.limoTrip.id).expect(404);
  await passengers('asstA', seed.limoTrip.id, other.op.id).expect(404);
  await passengers('asstA', 'not-a-uuid').expect(404);
  await myTrips('otherAsst', other.op.id).expect(200, { trips: [] });

  // Phụ xe không mở được danh sách chuyến/đơn đầy đủ của nhà xe.
  await http().get(`${base()}/trips/${seed.limoTrip.id}`).set(bearer('asstA')).expect(403);
  await http().get(`${base()}/trips/${seed.limoTrip.id}/assistants`).set(bearer('asstA')).expect(403);
  // Người bán vé không có quyền đọc danh sách "chuyến được giao".
  await myTrips('seller').expect(403);
});

it('drops access immediately when the assignment is revoked or the account is locked or archived', async () => {
  await assign('owner', seed.limoTrip.id, [ids.asstA!, ids.asstLocked!, ids.asstArchived!]).expect(200);
  await passengers('asstLocked', seed.limoTrip.id).expect(200);
  await passengers('asstArchived', seed.limoTrip.id).expect(200);

  await assign('dispatcher', seed.limoTrip.id, [ids.asstLocked!, ids.asstArchived!]).expect(200);
  await myTrips('asstA').expect(200, { trips: [] });
  await passengers('asstA', seed.limoTrip.id).expect(404);

  await http().patch(`${base()}/users/${ids.asstLocked}`).set(bearer('owner')).send({ status: 'DISABLED' }).expect(200);
  await passengers('asstLocked', seed.limoTrip.id).expect(401);
  await http().delete(`${base()}/users/${ids.asstArchived}`).set(bearer('owner')).expect(200);
  await passengers('asstArchived', seed.limoTrip.id).expect(401);

  // Người phân công vẫn thấy phụ xe đã khóa (để gỡ), nhưng không gán thêm được.
  const listed = await http().get(assignPath(seed.limoTrip.id)).set(bearer('owner')).expect(200);
  expect(listed.body.assistants).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.asstLocked, active: false })]));
  await assign('owner', seed.bedTrip.id, [ids.asstLocked!]).expect(400);
  const candidates = await http().get(`${base()}/assistants`).set(bearer('owner')).expect(200);
  expect(candidates.body.assistants.map((a: { id: string }) => a.id)).toEqual(expect.not.arrayContaining([ids.asstLocked, ids.asstArchived]));
  await assign('owner', seed.limoTrip.id, []).expect(200, { assistants: [] });
});

it('serializes concurrent assignment changes so the final state is one of the requests', async () => {
  const sets = [[ids.asstA!], [ids.asstB!], [ids.asstA!, ids.asstB!], []];
  const results = await Promise.all(sets.map((u, i) => assign(i % 2 ? 'dispatcher' : 'owner', seed.bedTrip.id, u)));
  expect(results.every((r) => r.status === 200)).toBe(true);
  const { rows } = await s.db.query<{ user_id: string }>('SELECT user_id FROM trip_assistants WHERE trip_id = $1 ORDER BY user_id', [seed.bedTrip.id]);
  const final = rows.map((r) => r.user_id);
  expect(sets.map((x) => [...x].sort())).toContainEqual(final);
});

it('keeps the database from linking a trip and a user of different operators', async () => {
  await expect(s.db.query(
    'INSERT INTO trip_assistants (operator_id, trip_id, user_id) VALUES ($1, $2, $3)',
    [seed.op.id, seed.limoTrip.id, ids.otherAsst],
  )).rejects.toThrow(/foreign key/);
  await expect(s.db.query(
    'INSERT INTO trip_assistants (operator_id, trip_id, user_id) VALUES ($1, $2, $3)',
    [seed.op.id, other.limoTrip.id, ids.asstA],
  )).rejects.toThrow(/foreign key/);
});

async function firstSellable(tripId: string) {
  const { rows } = await s.db.query<{ seat_code: string }>(
    'SELECT seat_code FROM trip_seats WHERE trip_id = $1 AND sellable AND booking_id IS NULL ORDER BY seat_code LIMIT 1',
    [tripId],
  );
  return rows[0]!.seat_code;
}
