import { buildServices, errorCode, LIMO_FARES, resetDatabase, seedOperatorWithTrips, Services } from './helpers';

let s: Services;

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
});
afterAll(() => s.db.close());

describe('operators', () => {
  it('creates an operator with policy v1 and two default vehicles', async () => {
    const op = await s.operators.create({ code: 'AB', name: 'Nhà xe AB' });
    const vehicles = await s.vehicles.list(op.id);
    expect(vehicles.map((v) => [v.code, v.name, v.type])).toEqual([
      ['AB01', 'Xe 01', 'LIMOUSINE'],
      ['AB02', 'Xe 02', 'SLEEPER'],
    ]);
    const policy = await s.operators.currentPolicy(op.id);
    expect(policy).toMatchObject({
      version: 1,
      holdMinutes: 10,
      maxUnitsPerBooking: 5,
      childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false },
    });
  });

  it('rejects a duplicate operator code with CONFLICT and leaves no partial data', async () => {
    expect(await errorCode(s.operators.create({ code: 'AB', name: 'Trùng' }))).toBe('CONFLICT');
    const { rows } = await s.db.query("SELECT COUNT(*)::int AS n FROM operators WHERE code = 'AB'");
    expect(rows[0]!.n).toBe(1);
  });

  it('rejects invalid operator codes', async () => {
    await expect(s.operators.create({ code: 'ab', name: 'x' })).rejects.toThrow();
    await expect(s.operators.create({ code: 'ABCDE', name: 'x' })).rejects.toThrow();
  });

  it('creates the shared layout library only once even when operators are created concurrently', async () => {
    await Promise.all(['CA', 'CB', 'CC', 'CD'].map((code) => s.operators.create({ code, name: code })));
    const { rows } = await s.db.query(
      'SELECT code, COUNT(*)::int AS n FROM seat_layouts WHERE operator_id IS NULL GROUP BY code ORDER BY code',
    );
    expect(rows).toEqual([
      { code: 'BED36', n: 1 },
      { code: 'LIMO24', n: 1 },
      { code: 'SEAT29', n: 1 },
    ]);
  });

  it('versions policies: an update adds a new version', async () => {
    const op = await s.operators.getByCode('AB');
    const p = await s.operators.updatePolicy(op.id, {
      holdMinutes: 15,
      maxUnitsPerBooking: 4,
      childPolicy: { freeUnderAge: 3, price: 0, maxPerUnit: 1, countsTowardCapacity: false },
    });
    expect(p.version).toBe(2);
    expect(p.holdMinutes).toBe(15);
  });
});

describe('seat layouts and vehicles', () => {
  it('stores a new version each time an operator saves the same layout code', async () => {
    const op = await s.operators.getByCode('AB');
    const def = { floors: [{ code: 'A', label: 'Tầng dưới', rows: ['A01 . A02'] }], defaultMaxOccupancy: 2 };
    const v1 = await s.layouts.create(op.id, { code: 'LIMO_REAL', name: 'Limo thật', unit: 'phòng', kind: 'room', definition: def });
    const v2 = await s.layouts.create(op.id, { code: 'LIMO_REAL', name: 'Limo thật', unit: 'phòng', kind: 'room', definition: def });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    const { rows } = await s.db.query('SELECT COUNT(*)::int AS n FROM seats WHERE seat_layout_id = $1', [v2.id]);
    expect(rows[0]!.n).toBe(2);
  });

  it('rejects an invalid layout and writes nothing', async () => {
    const op = await s.operators.getByCode('AB');
    const bad = { floors: [{ code: 'A', label: 'x', rows: ['A01 A01'] }] };
    expect(await errorCode(s.layouts.create(op.id, { code: 'BAD', name: 'x', unit: 'giường', kind: 'bed', definition: bad }))).toBe(
      'INVALID_LAYOUT',
    );
    const { rows } = await s.db.query("SELECT COUNT(*)::int AS n FROM seat_layouts WHERE code = 'BAD'");
    expect(rows[0]!.n).toBe(0);
  });

  it('creates a vehicle with the operator prefix and a matching layout kind', async () => {
    const op = await s.operators.getByCode('AB');
    const seat = await s.layouts.latest(null, 'SEAT29');
    const v = await s.vehicles.create(op.id, { code: 'AB03', name: 'Xe 03', type: 'SEATER', seatLayoutId: seat!.id });
    expect(v).toMatchObject({ code: 'AB03', type: 'SEATER', status: 'ACTIVE' });
  });

  it('rejects a vehicle code without the operator prefix', async () => {
    const op = await s.operators.getByCode('AB');
    const seat = await s.layouts.latest(null, 'SEAT29');
    expect(await errorCode(s.vehicles.create(op.id, { code: 'PN03', name: 'Xe 09', type: 'SEATER', seatLayoutId: seat!.id }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await errorCode(s.vehicles.create(op.id, { code: 'ABX01', name: 'Xe 09', type: 'SEATER', seatLayoutId: seat!.id }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('rejects a layout whose kind does not match the vehicle type', async () => {
    const op = await s.operators.getByCode('AB');
    const bed = await s.layouts.latest(null, 'BED36');
    expect(await errorCode(s.vehicles.create(op.id, { code: 'AB04', name: 'Xe 04', type: 'LIMOUSINE', seatLayoutId: bed!.id }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it("does not let an operator use another operator's private layout", async () => {
    const other = await s.operators.getByCode('CA');
    const mine = await s.layouts.latest((await s.operators.getByCode('AB')).id, 'LIMO_REAL');
    expect(
      await errorCode(s.vehicles.create(other.id, { code: 'CA03', name: 'Xe 03', type: 'LIMOUSINE', seatLayoutId: mine!.id })),
    ).toBe('NOT_FOUND');
  });

  it('rejects a duplicate vehicle code with CONFLICT', async () => {
    const op = await s.operators.getByCode('AB');
    const seat = await s.layouts.latest(null, 'SEAT29');
    expect(await errorCode(s.vehicles.create(op.id, { code: 'AB03', name: 'Xe khác', type: 'SEATER', seatLayoutId: seat!.id }))).toBe(
      'CONFLICT',
    );
  });

  it("hides another operator's vehicle", async () => {
    const ab = await s.operators.getByCode('AB');
    const ca = await s.operators.getByCode('CA');
    const [caVehicle] = await s.vehicles.list(ca.id);
    expect(await errorCode(s.vehicles.get(ab.id, caVehicle!.id))).toBe('NOT_FOUND');
  });
});

describe('trips', () => {
  it('snapshots the vehicle layout into trip seats and stores fares', async () => {
    const { limoTrip } = await seedOperatorWithTrips(s, 'PN');
    const { rows } = await s.db.query(
      'SELECT COUNT(*)::int AS n, MAX(max_occupancy) AS max FROM trip_seats WHERE trip_id = $1',
      [limoTrip.id],
    );
    expect(rows[0]).toEqual({ n: 24, max: 2 });
    expect(limoTrip.contact_phone).toBe('+84912000111');
  });

  it('requires a fare for every floor × occupancy the layout can sell', async () => {
    const op = await s.operators.getByCode('PN');
    const [limo] = await s.vehicles.list(op.id);
    const { rows } = await s.db.query<{ id: string }>("SELECT id FROM routes WHERE operator_id = $1", [op.id]);
    const base = {
      routeId: rows[0]!.id,
      vehicleId: limo!.id,
      name: 'Thiếu giá',
      departAt: '2027-02-02T11:00:00Z',
      salesOpenAt: '2027-01-01T00:00:00Z',
      salesCloseAt: '2027-02-02T10:00:00Z',
    };
    expect(await errorCode(s.trips.createTrip(op.id, { ...base, fares: [{ floor: 'A', occupancy: 1, price: 1 }] }))).toBe(
      'FARE_NOT_CONFIGURED',
    );
    expect(
      await errorCode(
        s.trips.createTrip(op.id, {
          ...base,
          fares: [
            { floor: 'A', occupancy: 1, price: 1 },
            { floor: 'A', occupancy: 2, price: 2 },
            { floor: 'B', occupancy: 1, price: 1 },
            { floor: 'B', occupancy: 2, price: 2 },
            { floor: 'C', occupancy: 1, price: 1 },
          ],
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('rejects a sales window that ends after departure', async () => {
    const op = await s.operators.getByCode('PN');
    const [limo] = await s.vehicles.list(op.id);
    const { rows } = await s.db.query<{ id: string }>('SELECT id FROM routes WHERE operator_id = $1', [op.id]);
    expect(
      await errorCode(
        s.trips.createTrip(op.id, {
          routeId: rows[0]!.id,
          vehicleId: limo!.id,
          name: 'Sai giờ',
          departAt: '2027-02-02T11:00:00Z',
          salesOpenAt: '2027-01-01T00:00:00Z',
          salesCloseAt: '2027-02-02T12:00:00Z',
          fares: LIMO_FARES,
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it("cannot create a trip with another operator's vehicle or route", async () => {
    const pn = await s.operators.getByCode('PN');
    const ab = await s.operators.getByCode('AB');
    const [abVehicle] = await s.vehicles.list(ab.id);
    const { rows } = await s.db.query<{ id: string }>('SELECT id FROM routes WHERE operator_id = $1', [pn.id]);
    const input = {
      routeId: rows[0]!.id,
      vehicleId: abVehicle!.id,
      name: 'Xe của người khác',
      departAt: '2027-02-02T11:00:00Z',
      salesOpenAt: '2027-01-01T00:00:00Z',
      salesCloseAt: '2027-02-02T10:00:00Z',
      fares: [{ floor: 'A', occupancy: 1 as const, price: 1 }],
    };
    expect(await errorCode(s.trips.createTrip(pn.id, input))).toBe('NOT_FOUND');
    expect(await errorCode(s.trips.createTrip(ab.id, input))).toBe('NOT_FOUND');
  });

  it('keeps old trips on the layout version they were created with', async () => {
    const op = await s.operators.getByCode('PN');
    const { rows: before } = await s.db.query<{ seat_layout_id: string }>(
      "SELECT seat_layout_id FROM trips WHERE operator_id = $1 AND name LIKE '%18:00'",
      [op.id],
    );
    await s.layouts.create(null, {
      code: 'LIMO24', name: 'Limousine 24 phòng', unit: 'phòng', kind: 'room',
      definition: { floors: [{ code: 'A', label: 'x', rows: ['A01'] }], defaultMaxOccupancy: 2 },
    });
    const { rows: after } = await s.db.query<{ seat_layout_id: string; n: number }>(
      `SELECT t.seat_layout_id, (SELECT COUNT(*)::int FROM trip_seats ts WHERE ts.trip_id = t.id) AS n
       FROM trips t WHERE operator_id = $1 AND name LIKE '%18:00'`,
      [op.id],
    );
    expect(after[0]).toEqual({ seat_layout_id: before[0]!.seat_layout_id, n: 24 });
  });

  it('finds open trips by Vietnamese calendar day', async () => {
    const found = await s.trips.search('PN', '2027-02-01');
    expect(found.map((t) => [t.name, t.availableUnits, t.fromPrice])).toEqual([
      ['TP.HCM → Hoài Ân 18:00', 24, 420_000],
      ['TP.HCM → Hoài Ân 19:30', 36, 350_000],
    ]);
    expect(await s.trips.search('PN', '2027-01-31')).toEqual([]);
    expect(await s.trips.search('PN', '2027-02-01', 'OTHER')).toEqual([]);
  });

  it('does not list trips whose sales have not opened or have closed', async () => {
    s.clock.set(new Date('2026-12-31T23:59:00Z'));
    expect(await s.trips.search('PN', '2027-02-01')).toEqual([]);
    s.clock.set(new Date('2027-02-01T10:30:00Z'));
    expect((await s.trips.search('PN', '2027-02-01')).map((t) => t.name)).toEqual(['TP.HCM → Hoài Ân 19:30']);
    s.clock.set(new Date('2027-01-20T03:00:00Z'));
  });

  it('returns NOT_FOUND for an unknown operator code', async () => {
    expect(await errorCode(s.trips.search('ZZ', '2027-02-01'))).toBe('NOT_FOUND');
  });
});
