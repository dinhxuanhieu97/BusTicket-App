import { DemoSeeder } from '../src/demo/demo-seed';
import { AuthUser } from '../src/auth/auth.service';
import { Services, T0, buildServices, resetDatabase, seedOperatorWithTrips } from './helpers';

let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let demo: DemoSeeder;

const count = async (sql: string, params: unknown[] = []) =>
  Number((await s.db.query<{ n: string }>(sql, params)).rows[0]!.n);

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s);
  await s.db.query(
    `INSERT INTO users (operator_id, full_name, phone, password_hash, role) VALUES ($1, 'Chủ xe', '+84907000099', 'x', 'OWNER')`,
    [seed.op.id],
  );
  demo = new DemoSeeder(s.db, s.clock);
});

afterAll(async () => {
  await s.db.close();
});

describe('demo data seed', () => {
  it('refuses an operator without an OWNER to attribute bookings to', async () => {
    const other = await s.operators.create({ code: 'XX', name: 'Nhà xe XX' });
    await expect(demo.seed({ operatorCode: other.code, days: 2 })).rejects.toThrow(/OWNER/);
  });

  it('creates vehicles, a route pair with stops, trips and bookings in every state', async () => {
    const summary = await demo.seed({ operatorCode: 'PN', days: 14 });
    expect(summary).toMatchObject({ vehiclesCreated: 3, routesCreated: 2, tripsSkipped: 0 });
    // Clock is 10:00 VN, so today's 19:00 trips are still on sale: 14 days × 2 directions.
    expect(summary.tripsCreated).toBe(28);
    expect(summary.skipped).toBe(0);
    expect(summary.bookings).toBeGreaterThan(28 * 4);

    const vehicles = (await s.db.query('SELECT code, status FROM vehicles WHERE operator_id = $1 ORDER BY code', [seed.op.id])).rows;
    expect(vehicles.filter((v) => /^PN5\d$/.test(v.code)).map((v) => v.status)).toEqual(['ACTIVE', 'ACTIVE', 'MAINTENANCE']);
    const routes = (await s.db.query(`SELECT code, stops FROM routes WHERE operator_id = $1 AND code IN ('SG-QN','QN-SG')`, [seed.op.id])).rows;
    expect(routes).toHaveLength(2);
    for (const r of routes) expect(r.stops.pickup.length).toBeGreaterThan(0);

    const statuses = (await s.db.query<{ status: string; payment_status: string }>(
      `SELECT DISTINCT status, payment_status FROM bookings WHERE operator_id = $1`, [seed.op.id],
    )).rows.map((r) => `${r.status}/${r.payment_status}`);
    expect(statuses).toEqual(expect.arrayContaining(['CONFIRMED/PAID', 'CONFIRMED/UNPAID', 'HOLDING/UNPAID', 'CANCELLED/UNPAID']));
    expect(await count(`SELECT count(*) n FROM bookings WHERE operator_id = $1 AND status = 'CONFIRMED' AND paid_amount > 0 AND paid_amount < total_amount`, [seed.op.id])).toBeGreaterThan(0);
    expect(await count('SELECT count(*) n FROM refund_obligations WHERE operator_id = $1', [seed.op.id])).toBeGreaterThan(0);
    expect(await count('SELECT count(*) n FROM booking_items WHERE boarded_at IS NOT NULL')).toBeGreaterThan(0);
    // The existing real trips of the operator get passengers too.
    expect(await count('SELECT count(*) n FROM bookings WHERE trip_id = $1', [seed.limoTrip.id])).toBeGreaterThan(0);
    // Every booking is marked, customers are never notified, and phones are the fake 0999 range.
    expect(await count(`SELECT count(*) n FROM bookings WHERE operator_id = $1 AND idempotency_key NOT LIKE 'demo-data-%'`, [seed.op.id])).toBe(0);
    expect(await count(`SELECT count(*) n FROM bookings WHERE operator_id = $1 AND contact_phone NOT LIKE '+84999%'`, [seed.op.id])).toBe(0);
    // Nobody is ever messaged about demo data: every outbox event it caused is already processed.
    expect(await count('SELECT count(*) n FROM outbox_events')).toBeGreaterThan(0);
    expect(await count('SELECT count(*) n FROM outbox_events WHERE processed_at IS NULL')).toBe(0);
    // Seat inventory matches live bookings.
    expect(await count(
      `SELECT count(*) n FROM trip_seats ts JOIN bookings b ON b.id = ts.booking_id WHERE b.status IN ('CANCELLED','EXPIRED')`,
    )).toBe(0);
  });

  it('is safe to run again later: nothing is duplicated or reported as a conflict', async () => {
    const before = await count('SELECT count(*) n FROM bookings');
    s.clock.set(new Date(T0.getTime() + 60_000));
    const again = await demo.seed({ operatorCode: 'PN', days: 14 });
    s.clock.set(T0);
    expect(again).toMatchObject({ vehiclesCreated: 0, routesCreated: 0, tripsCreated: 0, tripsSkipped: 0, bookings: 0 });
    expect(await count('SELECT count(*) n FROM bookings')).toBe(before);
  });

  it('refuses to remove while a demo booking holds money that is not demo counter cash', async () => {
    const { rows } = await s.db.query<{ code: string }>(
      `SELECT code FROM bookings WHERE operator_id = $1 AND status = 'CONFIRMED' AND paid_amount < total_amount LIMIT 1`, [seed.op.id],
    );
    const owner = (await s.db.query<{ id: string }>(`SELECT id FROM users WHERE role = 'OWNER' AND operator_id = $1`, [seed.op.id])).rows[0]!;
    const actor = { id: owner.id, operatorId: seed.op.id, role: 'OWNER', fullName: 'Chủ xe', phone: '+84907000099', mfaEnabled: false, scope: 'full' } as AuthUser;
    const paid = await s.payments.recordManual(actor, seed.op.id, {
      bookingCode: rows[0]!.code, amount: 10_000, method: 'MANUAL_BANK', bankReference: 'FT-REAL-001',
    }, 'real-transfer-key-1');
    await expect(demo.remove('PN')).rejects.toThrow(rows[0]!.code);
    expect(await count(`SELECT count(*) n FROM bookings WHERE idempotency_key LIKE 'demo-data-%'`)).toBeGreaterThan(0);
    // A person resolves it (here: the test drops that payment) and removal works again.
    const paymentId = (paid as { payment?: { id: string }; id?: string }).payment?.id
      ?? (await s.db.query<{ id: string }>(`SELECT id FROM payments WHERE method = 'MANUAL_BANK'`)).rows[0]!.id;
    await s.db.query('DELETE FROM outbox_events WHERE aggregate_id = $1', [paymentId]);
    await s.db.query('DELETE FROM payment_allocations WHERE payment_id = $1', [paymentId]);
    await s.db.query('UPDATE bookings b SET paid_amount = paid_amount - 10000 WHERE code = $1', [rows[0]!.code]);
    await s.db.query('DELETE FROM payments WHERE id = $1', [paymentId]);
  });

  it('removes everything it created and keeps the real data', async () => {
    const realTrips = await count(`SELECT count(*) n FROM trips WHERE operator_id = $1 AND coalesce(idempotency_key, '') NOT LIKE 'demo-data-%'`, [seed.op.id]);
    const removed = await demo.remove('PN');
    expect(removed).toMatchObject({ trips: 28, vehicles: 3, routes: 2 });
    expect(removed.bookings).toBeGreaterThan(0);
    expect(removed.payments).toBeGreaterThan(0);
    expect(await count('SELECT count(*) n FROM bookings')).toBe(0);
    expect(await count('SELECT count(*) n FROM payments')).toBe(0);
    expect(await count('SELECT count(*) n FROM trip_seats WHERE booking_id IS NOT NULL')).toBe(0);
    expect(await count('SELECT count(*) n FROM outbox_events')).toBe(0);
    expect(await count('SELECT count(*) n FROM trips WHERE operator_id = $1', [seed.op.id])).toBe(realTrips);
    expect(await count('SELECT count(*) n FROM vehicles WHERE operator_id = $1', [seed.op.id])).toBe(2);
    expect(await demo.remove('PN')).toEqual({ bookings: 0, payments: 0, trips: 0, vehicles: 0, routes: 0 });
  });

  it('never takes over a real route or vehicle that happens to use a demo code', async () => {
    const op = await s.operators.create({ code: 'QQ', name: 'Nhà xe QQ' });
    await s.db.query(`INSERT INTO users (operator_id, full_name, phone, password_hash, role) VALUES ($1, 'Chủ QQ', '+84907000098', 'x', 'OWNER')`, [op.id]);
    const route = await s.trips.createRoute(op.id, { code: 'SG-QN', origin: 'TP.HCM', destination: 'Quy Nhơn' });
    await expect(demo.seed({ operatorCode: 'QQ', days: 2 })).rejects.toThrow(/SG-QN already exists/);
    expect(await count('SELECT count(*) n FROM trips WHERE operator_id = $1', [op.id])).toBe(0);
    expect((await demo.remove('QQ')).routes).toBe(0);
    expect(await count('SELECT count(*) n FROM routes WHERE id = $1', [route.id])).toBe(1);

    const op2 = await s.operators.create({ code: 'QR', name: 'Nhà xe QR' });
    await s.db.query(`INSERT INTO users (operator_id, full_name, phone, password_hash, role) VALUES ($1, 'Chủ QR', '+84907000097', 'x', 'OWNER')`, [op2.id]);
    const [real] = await s.vehicles.list(op2.id);
    await s.vehicles.create(op2.id, { code: 'QR51', name: 'Xe thật 51', type: 'LIMOUSINE', seatLayoutId: real!.seat_layout_id });
    await expect(demo.seed({ operatorCode: 'QR', days: 2 })).rejects.toThrow(/QR51 already exists/);
  });
});
