import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { ticketProof } from '../src/common/codes';
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
const userIds: Record<string, string> = {};
const PASSWORD = 'passenger-ops-test-password-1';
const STAFF = {
  owner: { role: 'OWNER', phone: '0908000001' },
  dispatcher: { role: 'DISPATCHER', phone: '0908000002' },
  seller: { role: 'SELLER', phone: '0908000003' },
  accountant: { role: 'ACCOUNTANT', phone: '0908000004' },
  assistant: { role: 'ASSISTANT', phone: '0908000005' },
  assistant2: { role: 'ASSISTANT', phone: '0908000006' },
} as const;

const http = () => request(app.getHttpServer());
const bearer = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
const opBase = (op = seed.op.id) => `/api/v1/admin/operators/${op}`;
const tripBase = (tripId: string, op = seed.op.id) => `${opBase(op)}/trips/${tripId}`;

async function sell(tripId: string, opts: { paid?: number; confirm?: boolean; seats?: number } = {}) {
  const { rows } = await s.db.query<{ seat_code: string }>(
    `SELECT seat_code FROM trip_seats WHERE trip_id = $1 AND sellable AND booking_id IS NULL ORDER BY length(seat_code), seat_code LIMIT $2`,
    [tripId, opts.seats ?? 1],
  );
  const r = await http()
    .post(`${tripBase(tripId)}/bookings`)
    .set(bearer('seller'))
    .set('Idempotency-Key', newKey())
    .send({
      contactName: 'Khách Test', contactPhone: '0913000111', items: rows.map((x) => ({ seatCode: x.seat_code })),
      paidAmount: opts.paid ?? 0, confirm: opts.confirm ?? true, notifyCustomer: false,
    })
    .expect(200);
  return r.body.booking as { code: string; seats: string[]; totalAmount: number; paidAmount: number };
}

const bookingRow = async (code: string) =>
  (await s.db.query<{ id: string; status: string; paid_amount: number; access_token_version: number; cancel_reason: string | null }>(
    'SELECT id, status, paid_amount, access_token_version, cancel_reason FROM bookings WHERE code = $1', [code],
  )).rows[0]!;
const qrOf = async (code: string) => {
  const b = await bookingRow(code);
  return `https://api.example.vn/api/v1/tickets/${code}/verify?proof=${ticketProof(TOKEN_SECRET, b.id, b.access_token_version)}`;
};

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  other = await seedOperatorWithTrips(s, 'AB');
  const users = new UsersService(s.db, s.clock);
  for (const [key, v] of Object.entries(STAFF)) {
    const u = await users.createStaff(seed.op.id, { fullName: `NV ${key}`, role: v.role, phone: v.phone, password: PASSWORD });
    userIds[key] = (u as { id: string }).id;
  }
  await s.db.query('INSERT INTO trip_assistants (operator_id, trip_id, user_id) VALUES ($1, $2, $3)', [
    seed.op.id, seed.limoTrip.id, userIds.assistant,
  ]);
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

describe('staff cancel (C2)', () => {
  it('cancels a paid booking, frees the seats, records a refund obligation, outbox and audit', async () => {
    const b = await sell(seed.limoTrip.id, { paid: 100_000, seats: 2 });
    const r = await http().post(`${opBase()}/bookings/${b.code}/cancel`).set(bearer('dispatcher'))
      .send({ reason: 'Khách báo bận việc', notifyCustomer: false }).expect(200);
    expect(r.body).toMatchObject({
      alreadyCancelled: false,
      booking: { code: b.code, status: 'CANCELLED', paidAmount: 100_000 },
      refund: { bookingCode: b.code, amount: 100_000, status: 'OPEN', reason: 'Khách báo bận việc', createdBy: 'NV dispatcher' },
    });
    const row = await bookingRow(b.code);
    expect(row).toMatchObject({ status: 'CANCELLED', cancel_reason: 'Khách báo bận việc' });
    const { rows: held } = await s.db.query('SELECT 1 FROM trip_seats WHERE booking_id = $1', [row.id]);
    expect(held).toHaveLength(0);
    const { rows: ev } = await s.db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_events WHERE type = 'booking.cancelled' AND aggregate_id = $1`, [row.id],
    );
    expect(ev[0]!.payload).toMatchObject({ by: 'STAFF', refundAmount: 100_000, notifyCustomer: false });
    const { rows: audit } = await s.db.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM audit_logs WHERE action = 'booking.cancel_staff' AND entity_id = $1`, [row.id],
    );
    expect(audit[0]!.data).toEqual({ bookingCode: b.code, previousStatus: 'CONFIRMED', refundAmount: 100_000 });

    // Gửi lại: không tạo khoản hoàn thứ hai.
    const again = await http().post(`${opBase()}/bookings/${b.code}/cancel`).set(bearer('dispatcher'))
      .send({ reason: 'Gửi lại' }).expect(200);
    expect(again.body).toMatchObject({ alreadyCancelled: true, refund: { amount: 100_000 } });
    const { rows: n } = await s.db.query<{ n: number }>('SELECT count(*)::int AS n FROM refund_obligations WHERE booking_id = $1', [row.id]);
    expect(n[0]!.n).toBe(1);
  });

  it('cancels an unpaid hold without a refund and requires a reason', async () => {
    const b = await sell(seed.limoTrip.id, { confirm: false });
    const bad = await http().post(`${opBase()}/bookings/${b.code}/cancel`).set(bearer('owner')).send({ reason: ' a ' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    const r = await http().post(`${opBase()}/bookings/${b.code}/cancel`).set(bearer('owner')).send({ reason: 'Không liên lạc được' }).expect(200);
    expect(r.body.refund).toBeNull();
    expect((await bookingRow(b.code)).status).toBe('CANCELLED');
  });

  it('only dispatchers/owners cancel; another operator URL gets 404', async () => {
    const b = await sell(seed.limoTrip.id);
    for (const who of ['seller', 'accountant', 'assistant']) {
      await http().post(`${opBase()}/bookings/${b.code}/cancel`).set(bearer(who)).send({ reason: 'Thử quyền' }).expect(403);
    }
    await http().post(`${opBase(other.op.id)}/bookings/${b.code}/cancel`).set(bearer('owner')).send({ reason: 'Nhà xe khác' }).expect(404);
    await http().post(`${opBase()}/bookings/ZZZZZZZZ/cancel`).set(bearer('owner')).send({ reason: 'Không có' }).expect(404);
  });

  it('refuses to cancel a boarded booking until it is unboarded', async () => {
    const b = await sell(seed.limoTrip.id);
    await http().post(`${tripBase(seed.limoTrip.id)}/boarding`).set(bearer('seller')).send({ bookingCode: b.code }).expect(200);
    const r = await http().post(`${opBase()}/bookings/${b.code}/cancel`).set(bearer('dispatcher')).send({ reason: 'Khách đổi ý' }).expect(409);
    expect(r.body.error.message).toMatch(/lên xe/);
    await http().post(`${tripBase(seed.limoTrip.id)}/boarding`).set(bearer('seller')).send({ bookingCode: b.code, boarded: false }).expect(200);
    await http().post(`${opBase()}/bookings/${b.code}/cancel`).set(bearer('dispatcher')).send({ reason: 'Khách đổi ý' }).expect(200);
  });
});

describe('refund obligations', () => {
  it('lists open refunds for money roles and resolves them once', async () => {
    const b = await sell(seed.bedTrip.id, { paid: 50_000 });
    await http().post(`${opBase()}/bookings/${b.code}/cancel`).set(bearer('dispatcher')).send({ reason: 'Chuyến đổi giờ' }).expect(200);
    const list = await http().get(`${opBase()}/refunds`).set(bearer('accountant')).expect(200);
    const item = list.body.refunds.find((r: { bookingCode: string }) => r.bookingCode === b.code);
    expect(item).toMatchObject({ amount: 50_000, status: 'OPEN', contactName: 'Khách Test', contactPhone: '+84913000111' });
    await http().get(`${opBase()}/refunds`).set(bearer('dispatcher')).expect(403);
    await http().post(`${opBase()}/refunds/${item.id}/resolve`).set(bearer('seller')).send({ status: 'REFUNDED' }).expect(403);

    const done = await http().post(`${opBase()}/refunds/${item.id}/resolve`).set(bearer('accountant'))
      .send({ status: 'REFUNDED', note: 'CK lại ngày 20/1' }).expect(200);
    expect(done.body).toMatchObject({ replayed: false, refund: { status: 'REFUNDED', resolvedBy: 'NV accountant', resolveNote: 'CK lại ngày 20/1' } });
    const replay = await http().post(`${opBase()}/refunds/${item.id}/resolve`).set(bearer('accountant')).send({ status: 'REFUNDED' }).expect(200);
    expect(replay.body.replayed).toBe(true);
    await http().post(`${opBase()}/refunds/${item.id}/resolve`).set(bearer('accountant')).send({ status: 'WAIVED' }).expect(409);
    const open = await http().get(`${opBase()}/refunds`).set(bearer('accountant')).expect(200);
    expect(open.body.refunds.some((r: { id: string }) => r.id === item.id)).toBe(false);
    const all = await http().get(`${opBase()}/refunds?status=ALL`).set(bearer('accountant')).expect(200);
    expect(all.body.refunds.some((r: { id: string }) => r.id === item.id)).toBe(true);
  });
});

describe('boarding (C4)', () => {
  it('staff boards all seats with the button, shows it in the passenger list, and can undo', async () => {
    const tripId = seed.limoTrip.id;
    const b = await sell(tripId, { seats: 2 });
    const r = await http().post(`${tripBase(tripId)}/boarding`).set(bearer('seller')).send({ bookingCode: b.code.toLowerCase() }).expect(200);
    expect(r.body.changed).toBe(2);
    expect(r.body.booking.seats.every((x: { boardedAt: string | null }) => x.boardedAt === T0.toISOString())).toBe(true);
    const again = await http().post(`${tripBase(tripId)}/boarding`).set(bearer('seller')).send({ bookingCode: b.code }).expect(200);
    expect(again.body.changed).toBe(0);
    const list = await http().get(`${tripBase(tripId)}/passengers`).set(bearer('dispatcher')).expect(200);
    const mine = list.body.bookings.find((x: { code: string }) => x.code === b.code);
    expect(mine.seats.map((x: { boardedAt: string | null }) => x.boardedAt)).toEqual([T0.toISOString(), T0.toISOString()]);
    expect(list.body.summary.boarded).toBeGreaterThanOrEqual(2);
    const undo = await http().post(`${tripBase(tripId)}/boarding`).set(bearer('seller'))
      .send({ bookingCode: b.code, seatCodes: [b.seats[0]], boarded: false }).expect(200);
    expect(undo.body.changed).toBe(1);
  });

  it('rejects unconfirmed, cancelled, foreign-seat and wrong-trip bookings; accountants cannot board', async () => {
    const hold = await sell(seed.limoTrip.id, { confirm: false });
    const r1 = await http().post(`${tripBase(seed.limoTrip.id)}/boarding`).set(bearer('seller')).send({ bookingCode: hold.code }).expect(409);
    expect(r1.body.error.message).toMatch(/chưa được xác nhận/);
    const onBed = await sell(seed.bedTrip.id);
    const r2 = await http().post(`${tripBase(seed.limoTrip.id)}/boarding`).set(bearer('seller')).send({ bookingCode: onBed.code }).expect(404);
    expect(r2.body.error.message).toMatch(/không thuộc chuyến này/);
    const b = await sell(seed.limoTrip.id);
    await http().post(`${tripBase(seed.limoTrip.id)}/boarding`).set(bearer('seller')).send({ bookingCode: b.code, seatCodes: ['Z9'] }).expect(400);
    await http().post(`${tripBase(seed.limoTrip.id)}/boarding`).set(bearer('accountant')).send({ bookingCode: b.code }).expect(403);
    await http().post(`${tripBase(seed.limoTrip.id, other.op.id)}/boarding`).set(bearer('seller')).send({ bookingCode: b.code }).expect(404);
  });

  it('assigned assistant boards by scanning the ticket QR; bad proof, other trips and unassigned assistants are refused', async () => {
    const tripId = seed.limoTrip.id;
    const b = await sell(tripId);
    const qr = await qrOf(b.code);
    const mine = `${opBase()}/my-trips/${tripId}/boarding`;
    const r = await http().post(mine).set(bearer('assistant')).send({ qr }).expect(200);
    expect(r.body).toMatchObject({ changed: 1, booking: { code: b.code, contactName: 'Khách Test' } });
    const { rows: audit } = await s.db.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM audit_logs WHERE action = 'booking.board' AND data->>'bookingCode' = $1`, [b.code],
    );
    expect(audit[0]!.data).toMatchObject({ via: 'QR' });

    const bad = qr.replace(/proof=(.)/, (_m, c: string) => `proof=${c === 'A' ? 'B' : 'A'}`);
    await http().post(mine).set(bearer('assistant')).send({ qr: bad }).expect(404);
    await http().post(mine).set(bearer('assistant')).send({ qr: 'https://evil.example/x' }).expect(400);
    await http().post(mine).set(bearer('assistant')).send({ qr, bookingCode: b.code }).expect(400);
    // Phụ xe chưa được giao chuyến này; phụ xe không dùng được API của văn phòng.
    await http().post(mine).set(bearer('assistant2')).send({ qr }).expect(404);
    await http().post(`${tripBase(tripId)}/boarding`).set(bearer('assistant')).send({ bookingCode: b.code }).expect(403);
    // Vé của chuyến khác (phụ xe được giao chuyến limo) → báo không thuộc chuyến.
    const onBed = await sell(seed.bedTrip.id);
    await http().post(`${opBase()}/my-trips/${seed.bedTrip.id}/boarding`).set(bearer('assistant')).send({ qr: await qrOf(onBed.code) }).expect(404);
    const wrong = await http().post(mine).set(bearer('assistant')).send({ qr: await qrOf(onBed.code) }).expect(404);
    expect(wrong.body.error.message).toMatch(/không thuộc chuyến này/);
    // Vé đã cấp lại (đổi version) → proof cũ không còn hiệu lực.
    await s.db.query('UPDATE bookings SET access_token_version = access_token_version + 1 WHERE code = $1', [b.code]);
    await http().post(mine).set(bearer('assistant')).send({ qr, boarded: false }).expect(404);
  });

  it('assistants see boardedAt but not the office-only fields', async () => {
    const r = await http().get(`${opBase()}/my-trips/${seed.limoTrip.id}/passengers`).set(bearer('assistant')).expect(200);
    const one = r.body.bookings[0];
    expect(one).not.toHaveProperty('onboardCollected');
    expect(one).not.toHaveProperty('cancelReason');
    expect(one.seats[0]).toHaveProperty('boardedAt');
  });
});

describe('re-import boarding + cash collected on board (B2)', () => {
  const imp = (tripId: string, rows: object[], opts: { dryRun?: boolean; key?: string; who?: string } = {}) => {
    const r = http().post(`${tripBase(tripId)}/passengers/boarding-import${opts.dryRun ? '?dryRun=true' : ''}`).set(bearer(opts.who ?? 'seller'));
    if (!opts.dryRun) r.set('Idempotency-Key', opts.key ?? newKey());
    return r.send({ fileName: 'chuyen.xlsx', rows });
  };

  it('previews without writing, then boards and records only the cash difference', async () => {
    const tripId = seed.bedTrip.id;
    const b = await sell(tripId, { seats: 2, paid: 0 });
    const rows = [
      { row: 2, code: b.code, seatCode: b.seats[0], boarded: 'x', collected: 100_000 },
      { row: 3, code: b.code, seatCode: b.seats[1], boarded: '', collected: null },
    ];
    const pre = await imp(tripId, rows, { dryRun: true }).expect(200);
    expect(pre.body).toMatchObject({
      ok: true, issues: [], unchanged: 0,
      updates: [{ code: b.code, rows: [2, 3], boardSeats: [b.seats[0]], collectAmount: 100_000 }],
      totals: { bookings: 1, boardSeats: 1, collectAmount: 100_000 },
    });
    expect((await bookingRow(b.code)).paid_amount).toBe(0);

    const key = newKey();
    const done = await imp(tripId, rows, { key }).expect(200);
    expect(done.body).toMatchObject({ replayed: false, totals: { collectAmount: 100_000 } });
    const row = await bookingRow(b.code);
    expect(row.paid_amount).toBe(100_000);
    const { rows: pays } = await s.db.query(
      `SELECT p.method, p.amount::int AS amount, p.collected_onboard FROM payments p WHERE p.matched_booking_id = $1`, [row.id],
    );
    expect(pays).toEqual([{ method: 'CASH', amount: 100_000, collected_onboard: true }]);
    const replay = await imp(tripId, rows, { key }).expect(200);
    expect(replay.body.replayed).toBe(true);
    await imp(tripId, [rows[0]!], { key }).expect(409);

    // Cùng file, khóa mới: không ghi thêm gì.
    const same = await imp(tripId, rows).expect(200);
    expect(same.body).toMatchObject({ unchanged: 2, totals: { bookings: 0, collectAmount: 0 } });
    // Tổng thực thu tăng lên 150k → chỉ ghi thêm 50k.
    const more = await imp(tripId, [{ row: 2, code: b.code, seatCode: b.seats[0], boarded: 'x', collected: '150.000' }]).expect(200);
    expect(more.body.totals.collectAmount).toBe(50_000);
    expect((await bookingRow(b.code)).paid_amount).toBe(150_000);
    const list = await http().get(`${tripBase(tripId)}/passengers`).set(bearer('dispatcher')).expect(200);
    expect(list.body.bookings.find((x: { code: string }) => x.code === b.code).onboardCollected).toBe(150_000);
  });

  it('rejects the whole file on bad rows, over-collection or a lower total; needs booking.board', async () => {
    const tripId = seed.bedTrip.id;
    const b = await sell(tripId, { paid: 0 });
    const other1 = await sell(seed.limoTrip.id);
    const total = b.totalAmount;
    const r = await imp(tripId, [
      { row: 2, code: b.code, seatCode: b.seats[0], boarded: 'x', collected: total + 1 },
      { row: 3, code: other1.code, seatCode: null, boarded: 'x', collected: null },
      { row: 4, code: 'ZZZZ', seatCode: null, boarded: null, collected: null },
      { row: 5, code: b.code, seatCode: 'Z9', boarded: 'maybe', collected: -1 },
    ]);
    expect(r.status).toBe(400);
    const msgs = r.body.error.details.issues.map((i: { message: string }) => i.message).join('\n');
    expect(msgs).toMatch(/Dòng 3: mã vé không thuộc chuyến này/);
    expect(msgs).toMatch(/Dòng 4: mã vé không thuộc chuyến này/);
    expect(msgs).toMatch(/Dòng 5: chỗ không thuộc đơn .*Đã lên xe.*không âm/);
    expect((await bookingRow(b.code)).paid_amount).toBe(0);
    const over = await imp(tripId, [{ row: 2, code: b.code, seatCode: b.seats[0], boarded: 'x', collected: total + 1 }]).expect(400);
    expect(over.body.error.details.issues[0].message).toMatch(/lớn hơn số còn phải thu/);
    await imp(tripId, [{ row: 2, code: b.code, seatCode: b.seats[0], boarded: null, collected: 20_000 }]).expect(200);
    const lower = await imp(tripId, [{ row: 2, code: b.code, seatCode: b.seats[0], boarded: null, collected: 10_000 }]).expect(400);
    expect(lower.body.error.details.issues[0].message).toMatch(/nhỏ hơn số đã ghi/);
    await imp(tripId, [{ row: 2, code: b.code, boarded: 'x' }], { who: 'accountant' }).expect(403);
  });

  it('skips untouched rows of held or cancelled bookings in the exported file, but refuses to board or collect on them', async () => {
    const tripId = seed.bedTrip.id;
    const hold = await sell(tripId, { confirm: false });
    const ok = await imp(tripId, [{ row: 2, code: hold.code, seatCode: hold.seats[0], boarded: null, collected: null }], { dryRun: true }).expect(200);
    expect(ok.body).toMatchObject({ ok: true, unchanged: 1, updates: [] });
    const bad = await imp(tripId, [{ row: 2, code: hold.code, seatCode: hold.seats[0], boarded: 'x', collected: null }], { dryRun: true }).expect(200);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.issues[0].message).toMatch(/chưa được xác nhận/);
  });
});
