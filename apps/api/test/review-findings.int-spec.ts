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

// ---- Rà soát T5 ----------------------------------------------------------------------------

describe('T5 review: trips status and admin counts', () => {
  it('a CLOSED trip cannot be booked and can be reopened', async () => {
    await s.trips.setStatus(seed.op.id, seed.limoTrip.id, 'CLOSED');
    expect(
      await errorCode(
        s.bookings.createHold({ tripId: seed.limoTrip.id, contactName: 'A', contactPhone: '0912345678', items: [{ seatCode: 'B10' }] }, 'review-closed-0001'),
      ),
    ).toBe('TRIP_NOT_ON_SALE');
    await s.trips.setStatus(seed.op.id, seed.limoTrip.id, 'OPEN');
  });

  it('closing a trip while holds are in flight never leaves a hold created after the close', async () => {
    const holds = Array.from({ length: 10 }, (_, i) =>
      s.bookings
        .createHold(
          { tripId: seed.limoTrip.id, contactName: 'A', contactPhone: '0912345678', items: [{ seatCode: `A0${(i % 9) + 1}`.slice(0, 3) }] },
          `review-race-${i}-0001`,
        )
        .then((r) => r.booking.code, (e) => e.code as string),
    );
    const close = s.trips.setStatus(seed.op.id, seed.limoTrip.id, 'CLOSED');
    await Promise.all([...holds, close]);
    const results = await Promise.all(holds);
    // Mỗi yêu cầu hoặc thành công (trước khi đóng) hoặc bị từ chối vì chuyến đóng / chỗ đã có người.
    for (const r of results) expect(r === 'TRIP_NOT_ON_SALE' || r === 'SEAT_UNAVAILABLE' || /^PN/.test(r)).toBe(true);
    const { rows } = await s.db.query<{ status: string }>('SELECT status FROM trips WHERE id = $1', [seed.limoTrip.id]);
    expect(rows[0]!.status).toBe('CLOSED');
    // Sau khi đóng: mọi yêu cầu mới đều bị từ chối.
    expect(
      await errorCode(
        s.bookings.createHold({ tripId: seed.limoTrip.id, contactName: 'A', contactPhone: '0912345678', items: [{ seatCode: 'B11' }] }, 'review-race-after-0001'),
      ),
    ).toBe('TRIP_NOT_ON_SALE');
    await s.trips.setStatus(seed.op.id, seed.limoTrip.id, 'OPEN');
  });

  it('cannot leave or reach CANCELLED through setStatus', async () => {
    await s.db.query("UPDATE trips SET status = 'CANCELLED' WHERE id = $1", [seed.bedTrip.id]);
    expect(await errorCode(s.trips.setStatus(seed.op.id, seed.bedTrip.id, 'OPEN'))).toBe('CONFLICT');
    await s.db.query("UPDATE trips SET status = 'OPEN' WHERE id = $1", [seed.bedTrip.id]);
  });

  it("cannot change another operator's trip status", async () => {
    const other = await s.operators.create({ code: 'ZT', name: 'ZT' });
    expect(await errorCode(s.trips.setStatus(other.id, seed.bedTrip.id, 'CLOSED'))).toBe('NOT_FOUND');
    expect(await s.trips.listForAdmin(other.id, '2027-02-01')).toEqual([]);
  });

  it('admin counts: blocked seats are not available, expired holds are', async () => {
    await s.db.query("UPDATE trip_seats SET sellable = false WHERE trip_id = $1 AND seat_code IN ('B17', 'B18')", [seed.bedTrip.id]);
    await s.bookings.createHold(
      { tripId: seed.bedTrip.id, contactName: 'A', contactPhone: '0912345678', items: [{ seatCode: 'B16' }] },
      'review-count-0001',
    );
    const before = (await s.trips.listForAdmin(seed.op.id, '2027-02-01')).find((t) => t.id === seed.bedTrip.id)!;
    s.clock.advanceMinutes(11);
    const after = (await s.trips.listForAdmin(seed.op.id, '2027-02-01')).find((t) => t.id === seed.bedTrip.id)!;
    expect(after.capacity).toBe(36);
    expect(after.available).toBe(before.available + 1);
    const map = await s.trips.seatMap(seed.bedTrip.id);
    expect(map.seats.filter((x) => x.status === 'AVAILABLE').length).toBe(after.available);
  });
});

describe('T5 review: vehicles', () => {
  it('changing a vehicle layout affects only trips created afterwards', async () => {
    const op = await s.operators.create({ code: 'LV', name: 'LV' });
    const [limo] = await s.vehicles.list(op.id);
    const route = await s.trips.createRoute(op.id, { code: 'R1', origin: 'a', destination: 'b' });
    const trip = { routeId: route.id, vehicleId: limo!.id, departAt: '2027-03-01T11:00:00Z', salesOpenAt: '2027-01-01T00:00:00Z', salesCloseAt: '2027-03-01T10:00:00Z' };
    const t1 = await s.trips.createTrip(op.id, { ...trip, name: 'Trước', fares: [
      { floor: 'A', occupancy: 1, price: 1 }, { floor: 'A', occupancy: 2, price: 2 }, { floor: 'B', occupancy: 1, price: 1 }, { floor: 'B', occupancy: 2, price: 2 },
    ] });
    const small = await s.layouts.create(op.id, {
      code: 'LIMO4', name: 'Limo 4', unit: 'phòng', kind: 'room',
      definition: { defaultMaxOccupancy: 2, floors: [{ code: 'A', label: 'x', rows: ['A01 . A02', 'A03 . A04'] }] },
    });
    await s.vehicles.update(op.id, limo!.id, { seatLayoutId: small.id });
    const t2 = await s.trips.createTrip(op.id, { ...trip, name: 'Sau', fares: [{ floor: 'A', occupancy: 1, price: 1 }, { floor: 'A', occupancy: 2, price: 2 }] });
    const count = async (id: string) =>
      (await s.db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM trip_seats WHERE trip_id = $1', [id])).rows[0]!.n;
    expect([await count(t1.id), await count(t2.id)]).toEqual([24, 4]);
    // Sơ đồ khác loại (giường) không gán được cho xe Limousine.
    const bed = await s.layouts.latest(null, 'BED36');
    expect(await errorCode(s.vehicles.update(op.id, limo!.id, { seatLayoutId: bed!.id }))).toBe('VALIDATION_FAILED');
  });

  it('treats Unicode-equivalent names as duplicates and trims plates before checking length', async () => {
    const op = await s.operators.create({ code: 'UN', name: 'UN' });
    const [limo, bed] = await s.vehicles.list(op.id);
    await s.vehicles.update(op.id, limo!.id, { name: 'Xe Đỏ' });
    const decomposed = 'Xe Đỏ'.normalize('NFD');
    expect(decomposed).not.toBe('Xe Đỏ');
    expect(await errorCode(s.vehicles.update(op.id, bed!.id, { name: decomposed }))).toBe('CONFLICT');
    const padded = `   ${'51B-123.45'}${' '.repeat(15)}`;
    expect((await s.vehicles.update(op.id, bed!.id, { plateNumber: padded })).plate_number).toBe('51B-123.45');
  });
});
