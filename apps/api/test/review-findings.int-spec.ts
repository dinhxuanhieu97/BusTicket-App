/**
 * Test tái hiện các ghi chú của vòng rà soát subagent (T1–T4). Xem bảng trong task.md.
 */
import { buildServices, errorCode, resetDatabase, seedOperatorWithTrips, Services } from './helpers';

let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
});
afterAll(() => s.db.close());

describe('malformed ids return NOT_FOUND instead of a raw database error', () => {
  it('OperatorsService.getById / updatePolicy', async () => {
    expect(await errorCode(s.operators.getById('nope'))).toBe('NOT_FOUND');
    expect(await errorCode(s.operators.currentPolicy('nope'))).toBe('NOT_FOUND');
    expect(
      await errorCode(
        s.operators.updatePolicy('nope', {
          holdMinutes: 10,
          maxUnitsPerBooking: 5,
          childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false },
        }),
      ),
    ).toBe('NOT_FOUND');
  });

  it('VehiclesService.get / list', async () => {
    expect(await errorCode(s.vehicles.get(seed.op.id, 'nope'))).toBe('NOT_FOUND');
    expect(await errorCode(s.vehicles.get('nope', seed.limo.id))).toBe('NOT_FOUND');
    expect(await s.vehicles.list('nope')).toEqual([]);
  });

  it('TripsService.seatMap and createTrip', async () => {
    expect(await errorCode(s.trips.seatMap('nope'))).toBe('NOT_FOUND');
    expect(await errorCode(s.trips.createRoute('nope', { code: 'X-Y', origin: 'a', destination: 'b' }))).toBe('NOT_FOUND');
  });
});

describe('draft trips are not public', () => {
  it('seatMap hides a DRAFT trip', async () => {
    await s.db.query("UPDATE trips SET status = 'DRAFT' WHERE id = $1", [seed.bedTrip.id]);
    expect(await errorCode(s.trips.seatMap(seed.bedTrip.id))).toBe('NOT_FOUND');
    await s.db.query("UPDATE trips SET status = 'OPEN' WHERE id = $1", [seed.bedTrip.id]);
    await expect(s.trips.seatMap(seed.bedTrip.id)).resolves.toMatchObject({ trip: { onSale: true } });
  });
});

describe('policy versioning', () => {
  it('serializes concurrent policy updates without gaps or collisions', async () => {
    const input = {
      holdMinutes: 10,
      maxUnitsPerBooking: 5,
      childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false },
    };
    await Promise.all(Array.from({ length: 10 }, () => s.operators.updatePolicy(seed.op.id, input)));
    const { rows } = await s.db.query<{ v: number[] }>(
      'SELECT array_agg(version ORDER BY version) AS v FROM operator_policies WHERE operator_id = $1',
      [seed.op.id],
    );
    expect(rows[0]!.v).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
  });

  it('a policy update does not wait for open transactions that reference the operator', async () => {
    // Một transaction khác đang chèn dữ liệu có FK tới operators (giữ FOR KEY SHARE) và chưa commit.
    const client = await s.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO routes (operator_id, code, origin, destination) VALUES ($1, 'LOCK-TEST', 'a', 'b')",
        [seed.op.id],
      );
      const update = s.operators.updatePolicy(seed.op.id, {
        holdMinutes: 10,
        maxUnitsPerBooking: 5,
        childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false },
      });
      const outcome = await Promise.race([
        update.then(() => 'done'),
        new Promise((r) => setTimeout(() => r('blocked'), 1500)),
      ]);
      expect(outcome).toBe('done');
      await client.query('ROLLBACK');
      await update;
    } finally {
      client.release();
    }
  });

  it('rejects an infant price that could overflow the booking total', async () => {
    expect(
      await errorCode(
        s.operators.updatePolicy(seed.op.id, {
          holdMinutes: 10,
          maxUnitsPerBooking: 5,
          childPolicy: { freeUnderAge: 2, price: 3_000_000_000, maxPerUnit: 1, countsTowardCapacity: false },
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('operator creation is all-or-nothing', () => {
  it('rolls back the operator and policy when a default vehicle insert fails', async () => {
    // Chiếm trước mã xe mặc định "QX01" bằng một xe của nhà xe khác để lần tạo QX thất bại giữa chừng.
    const lib = await s.layouts.latest(null, 'LIMO24');
    await s.db.query(
      `INSERT INTO vehicles (operator_id, code, name, type, seat_layout_id) VALUES ($1, 'QX01', 'Chiếm mã', 'LIMOUSINE', $2)`,
      [seed.op.id, lib!.id],
    );
    expect(await errorCode(s.operators.create({ code: 'QX', name: 'Nhà xe QX' }))).toBe('CONFLICT');
    const { rows } = await s.db.query("SELECT COUNT(*)::int AS n FROM operators WHERE code = 'QX'");
    expect(rows[0]!.n).toBe(0);
  });
});
