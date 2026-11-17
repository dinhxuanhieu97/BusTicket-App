import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import {
  AUTH_SECRET, RELAXED_ABUSE, Services, T0, TEST_DB_URL, TOKEN_SECRET,
  buildServices, newKey, resetDatabase, seedOperatorWithTrips,
} from './helpers';

let s: Services;
let app: INestApplication;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let other: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
const tokens: Record<string, string> = {};

const http = () => request(app.getHttpServer());
const bearer = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
const listPath = (tripId: string, op = seed.op.id) => `/api/v1/admin/operators/${op}/trips/${tripId}/passengers`;
const list = (who: string, tripId: string, query = '', op = seed.op.id) =>
  http().get(`${listPath(tripId, op)}${query}`).set(bearer(who));
const exportList = (who: string, tripId: string, query = '', op = seed.op.id) =>
  http().get(`${listPath(tripId, op)}/export${query}`).set(bearer(who));

const STAFF = {
  owner: { role: 'OWNER', phone: '0908000001' },
  dispatcher: { role: 'DISPATCHER', phone: '0908000002' },
  seller: { role: 'SELLER', phone: '0908000003' },
  accountant: { role: 'ACCOUNTANT', phone: '0908000004' },
  assistant: { role: 'ASSISTANT', phone: '0908000005' },
} as const;
const PASSWORD = 'passenger-test-password-1';

async function login(who: string, phone: string) {
  const r = await http().post('/api/v1/auth/login').send({ phone, password: PASSWORD }).expect(200);
  tokens[who] = r.body.accessToken;
}

async function hold(tripId: string, name: string, phone: string, seats: string[]) {
  const r = await s.bookings.createHold(
    { tripId, contactName: name, contactPhone: phone, items: seats.map((seatCode) => ({ seatCode })) },
    newKey(),
  );
  return r.booking.code as string;
}

/** Đơn đã xác nhận: giữ chỗ qua service thật rồi chuyển trạng thái (thanh toán được kiểm tra ở bộ test riêng). */
async function confirmed(tripId: string, name: string, phone: string, seats: string[], paid = 0) {
  const code = await hold(tripId, name, phone, seats);
  await s.db.query(
    `UPDATE bookings SET status = 'CONFIRMED', paid_amount = $2,
       payment_status = CASE WHEN $2 = 0 THEN 'UNPAID' WHEN $2 >= total_amount THEN 'PAID' ELSE 'PARTIAL' END
     WHERE code = $1`,
    [code, paid],
  );
  return code;
}

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  other = await seedOperatorWithTrips(s, 'AB');
  const users = new UsersService(s.db, s.clock);
  for (const [key, v] of Object.entries(STAFF))
    await users.createStaff(seed.op.id, { fullName: `NV ${key}`, role: v.role, phone: v.phone, password: PASSWORD });
  await users.createStaff(other.op.id, { fullName: 'Chủ AB', role: 'OWNER', phone: '0908000101', password: PASSWORD });

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
  await login('otherOwner', '0908000101');
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

beforeEach(() => s.clock.set(T0));

it('lists confirmed and live-held bookings with contact details for operator staff, and counts them apart', async () => {
  const paid = await confirmed(seed.limoTrip.id, 'Khách Một', '0912100001', ['A1', 'A2'], 50_000);
  await confirmed(seed.limoTrip.id, 'Khách Hai', '0912100002', ['B1']);
  const held = await hold(seed.limoTrip.id, 'Khách Giữ', '0912100003', ['A5']);
  await confirmed(seed.bedTrip.id, 'Khách Chuyến Khác', '0912100004', [(await firstSellable(seed.bedTrip.id))]);

  for (const who of ['owner', 'dispatcher', 'seller', 'accountant']) {
    const r = await list(who, seed.limoTrip.id).expect(200);
    expect(r.body.trip).toMatchObject({ id: seed.limoTrip.id, route: { code: 'HCM-HA' } });
    expect(r.body.bookings.map((b: { contactName: string }) => b.contactName).sort()).toEqual(['Khách Giữ', 'Khách Hai', 'Khách Một']);
  }
  const r = await list('seller', seed.limoTrip.id).expect(200);
  const one = r.body.bookings.find((b: { code: string }) => b.code === paid);
  expect(one).toMatchObject({
    status: 'CONFIRMED', channel: 'ONLINE', contactPhone: '+84912100001', contactErased: false,
    paidAmount: 50_000, paymentStatus: 'PARTIAL', holdUntil: null,
  });
  expect(one.dueAmount).toBe(one.totalAmount - 50_000);
  expect(one.seats.map((x: { code: string }) => x.code)).toEqual(['A1', 'A2']);
  const h = r.body.bookings.find((b: { code: string }) => b.code === held);
  expect(h).toMatchObject({ status: 'HOLDING', paidAmount: 0 });
  expect(new Date(h.holdUntil).getTime()).toBeGreaterThan(T0.getTime());
  // Tổng chỉ tính đơn đã xác nhận (người sẽ lên xe); đơn giữ chỗ đếm riêng.
  expect(r.body.summary).toMatchObject({ bookings: 2, seats: 3 });
  expect(r.body.holding).toEqual({ bookings: 1, seats: 1 });
  expect(JSON.stringify(r.body)).not.toContain('Khách Chuyến Khác');
});

it('drops expired holds from the default list and shows every booking with status=all', async () => {
  const tripId = seed.bedTrip.id;
  const seat = await firstSellable(tripId);
  const code = await hold(tripId, 'Hết Hạn', '0912100011', [seat]);
  const cancelledCode = await hold(tripId, 'Đã Hủy', '0912100012', [await firstSellable(tripId)]);
  await s.db.query(`UPDATE bookings SET status = 'CANCELLED' WHERE code = $1`, [cancelledCode]);

  s.clock.set(new Date(T0.getTime() + 6 * 3600_000));
  const active = await list('owner', tripId).expect(200);
  const codes = active.body.bookings.map((b: { code: string }) => b.code);
  expect(codes).not.toContain(code);
  expect(codes).not.toContain(cancelledCode);
  expect(active.body.holding).toEqual({ bookings: 0, seats: 0 });

  const all = await list('owner', tripId, '?status=all').expect(200);
  const byCode = new Map(all.body.bookings.map((b: { code: string; status: string }) => [b.code, b.status]));
  // Đơn quá hạn chưa được tác vụ dọn chuyển trạng thái vẫn hiện là EXPIRED, không phải HOLDING.
  expect(byCode.get(code)).toBe('EXPIRED');
  expect(byCode.get(cancelledCode)).toBe('CANCELLED');
  // Đơn hết hạn/đã hủy không được tính vào tổng hay số đang giữ.
  expect(all.body.holding).toEqual({ bookings: 0, seats: 0 });
  expect(all.body.summary.bookings).toBe(active.body.summary.bookings);
});

it('flags bookings whose contact the customer erased without exposing old data', async () => {
  const code = await confirmed(seed.limoTrip.id, 'Sẽ Xóa', '0912100021', [await firstSellable(seed.limoTrip.id)]);
  await s.db.query(
    `UPDATE bookings SET contact_name = 'Khách đã xóa thông tin', contact_phone = '', passenger_note = NULL,
       contact_erased_at = $2 WHERE code = $1`,
    [code, T0],
  );
  const r = await list('owner', seed.limoTrip.id).expect(200);
  expect(r.body.bookings.find((b: { code: string }) => b.code === code))
    .toMatchObject({ contactErased: true, contactName: 'Khách đã xóa thông tin', contactPhone: '', note: null });
  expect(JSON.stringify(r.body)).not.toContain('0912100021');
});

it('keeps the list inside the operator and away from assistants', async () => {
  await list('assistant', seed.limoTrip.id).expect(403);
  await exportList('assistant', seed.limoTrip.id).expect(403);
  await list('owner', other.limoTrip.id).expect(404);
  await list('owner', other.limoTrip.id, '', other.op.id).expect(404);
  await list('otherOwner', seed.limoTrip.id, '', other.op.id).expect(404);
  await list('owner', 'not-a-uuid').expect(404);
  await http().get(listPath(seed.limoTrip.id)).expect(401);
});

it('validates the query', async () => {
  for (const q of ['?status=foo', '?status=active&x=1', '?status[]=all']) {
    expect((await list('owner', seed.limoTrip.id, q).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
  }
  await exportList('owner', seed.limoTrip.id, '?format=pdf').expect(400);
});

it('records who viewed and who exported the passenger list', async () => {
  await s.db.query(`DELETE FROM audit_logs WHERE entity_id = $1`, [seed.bedTrip.id]);
  await list('seller', seed.bedTrip.id, '?status=all').expect(200);
  const exported = await exportList('accountant', seed.bedTrip.id, '?format=csv').expect(200);
  expect(exported.body.trip.id).toBe(seed.bedTrip.id);
  await exportList('seller', seed.bedTrip.id).expect(200);

  const { rows } = await s.db.query<{ action: string; actor_role: string; data: Record<string, unknown> }>(
    `SELECT a.action, u.role AS actor_role, a.data FROM audit_logs a JOIN users u ON u.id = a.actor_user_id
     WHERE a.entity_id = $1 ORDER BY a.id`,
    [seed.bedTrip.id],
  );
  expect(rows.map((r) => [r.action, r.actor_role, r.data.status, r.data.format])).toEqual([
    ['passenger.list.view', 'SELLER', 'all', undefined],
    ['passenger.list.export', 'ACCOUNTANT', 'active', 'csv'],
    ['passenger.list.export', 'SELLER', 'active', 'xlsx'],
  ]);
  // Nhật ký không chứa tên/SĐT khách.
  expect(JSON.stringify(rows)).not.toMatch(/\+849/);
});

async function firstSellable(tripId: string) {
  const { rows } = await s.db.query<{ seat_code: string }>(
    'SELECT seat_code FROM trip_seats WHERE trip_id = $1 AND sellable AND booking_id IS NULL ORDER BY seat_code LIMIT 1',
    [tripId],
  );
  return rows[0]!.seat_code;
}
