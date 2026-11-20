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
      { code: 'BED40', n: 1 },
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
    const def = { floors: [{ code: '1', label: 'Tầng dưới', rows: ['A1 . A2'] }], defaultMaxOccupancy: 2 };
    const v1 = await s.layouts.create(op.id, { code: 'LIMO_REAL', name: 'Limo thật', unit: 'phòng', kind: 'room', definition: def });
    const v2 = await s.layouts.create(op.id, { code: 'LIMO_REAL', name: 'Limo thật', unit: 'phòng', kind: 'room', definition: def });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    const { rows } = await s.db.query('SELECT COUNT(*)::int AS n FROM seats WHERE seat_layout_id = $1', [v2.id]);
    expect(rows[0]!.n).toBe(2);
  });

  it('rejects an invalid layout and writes nothing', async () => {
    const op = await s.operators.getByCode('AB');
    const bad = { floors: [{ code: '1', label: 'x', rows: ['A1 A1'] }] };
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
    const bed = await s.layouts.latest(null, 'BED40');
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
    expect(await errorCode(s.trips.createTrip(op.id, { ...base, fares: [{ floor: '1', occupancy: 1, price: 1 }] }))).toBe(
      'FARE_NOT_CONFIGURED',
    );
    expect(
      await errorCode(
        s.trips.createTrip(op.id, {
          ...base,
          fares: [
            { floor: '1', occupancy: 1, price: 1 },
            { floor: '1', occupancy: 2, price: 2 },
            { floor: '2', occupancy: 1, price: 1 },
            { floor: '2', occupancy: 2, price: 2 },
            { floor: '3', occupancy: 1, price: 1 },
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
      fares: [{ floor: '1', occupancy: 1 as const, price: 1 }],
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
      definition: { floors: [{ code: '1', label: 'x', rows: ['A1'] }], defaultMaxOccupancy: 2 },
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
      ['TP.HCM → Hoài Ân 19:30', 40, 350_000],
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

describe('deleting vehicles', () => {
  it('deletes an unused vehicle; another operator cannot delete it', async () => {
    const op = await s.operators.getByCode('AB');
    const ca = await s.operators.getByCode('CA');
    const seat = await s.layouts.latest(null, 'SEAT29');
    const v = await s.vehicles.create(op.id, { code: 'AB09', name: 'Xe nhập nhầm', type: 'SEATER', seatLayoutId: seat!.id });
    expect(await errorCode(s.vehicles.remove(ca.id, v.id))).toBe('NOT_FOUND');
    expect(await errorCode(s.vehicles.remove(op.id, 'not-a-uuid'))).toBe('NOT_FOUND');
    await s.vehicles.remove(op.id, v.id);
    expect(await errorCode(s.vehicles.get(op.id, v.id))).toBe('NOT_FOUND');
    // Mã xe dùng lại được sau khi xóa.
    await s.vehicles.create(op.id, { code: 'AB09', name: 'Xe nhập nhầm', type: 'SEATER', seatLayoutId: seat!.id });
  });

  it('refuses to delete a vehicle that has trips and suggests retiring it', async () => {
    const op = await s.operators.getByCode('PN');
    const [limo] = await s.vehicles.list(op.id);
    expect(await errorCode(s.vehicles.remove(op.id, limo!.id))).toBe('CONFLICT');
    await expect(s.vehicles.remove(op.id, limo!.id)).rejects.toThrow('Ngừng chạy');
    const retired = await s.vehicles.update(op.id, limo!.id, { status: 'RETIRED' });
    expect(retired.status).toBe('RETIRED');
    await s.vehicles.update(op.id, limo!.id, { status: 'ACTIVE' });
  });

  it('refuses to delete a vehicle used by a schedule', async () => {
    const op = await s.operators.getByCode('AB');
    const seat = await s.layouts.latest(null, 'SEAT29');
    const v = await s.vehicles.create(op.id, { code: 'AB08', name: 'Xe lịch', type: 'SEATER', seatLayoutId: seat!.id });
    await s.db.query(
      `INSERT INTO trip_schedules (operator_id, name, config) VALUES ($1, 'Lịch thử', $2)`,
      [op.id, JSON.stringify({ legs: [{ vehicles: [{ vehicleId: v.id }] }] })],
    );
    expect(await errorCode(s.vehicles.remove(op.id, v.id))).toBe('CONFLICT');
    // Lịch lưu UUID viết hoa, xóa bằng chữ thường (và ngược lại) vẫn bị chặn.
    await s.db.query(`UPDATE trip_schedules SET config = $2 WHERE operator_id = $1`, [
      op.id,
      JSON.stringify({ legs: [{ vehicles: [{ vehicleId: v.id.toUpperCase() }] }] }),
    ]);
    expect(await errorCode(s.vehicles.remove(op.id, v.id.toLowerCase()))).toBe('CONFLICT');
    expect(await errorCode(s.vehicles.remove(op.id, v.id.toUpperCase()))).toBe('CONFLICT');
  });
});

describe('managing places and routes', () => {
  it('renames a place on both directions, refuses origin = destination, and merges into an existing name', async () => {
    const op = await s.operators.getByCode('AB');
    await s.trips.createRoutePair(op.id, { origin: 'Sài Gòn', destination: 'Ðà Lạt', code: 'SG-DL', reverseCode: 'DL-SG' });
    await s.trips.createRoutePair(op.id, { origin: 'Sài Gòn', destination: 'Nha Trang', code: 'SG-NT', reverseCode: 'NT-SG' });
    expect(await s.trips.renamePlace(op.id, { from: 'Ðà Lạt', to: ' Đà  Lạt ' })).toMatchObject({ updated: 2, to: 'Đà Lạt' });
    const names = async () =>
      (await s.trips.listRoutes(op.id)).filter((r) => r.code.includes('-')).map((r) => `${r.code}:${r.origin}>${r.destination}`);
    expect(await names()).toEqual(['DL-SG:Đà Lạt>Sài Gòn', 'NT-SG:Nha Trang>Sài Gòn', 'SG-DL:Sài Gòn>Đà Lạt', 'SG-NT:Sài Gòn>Nha Trang']);
    expect(await errorCode(s.trips.renamePlace(op.id, { from: 'Đà Lạt', to: 'Sài Gòn' }))).toBe('VALIDATION_FAILED');
    expect(await errorCode(s.trips.renamePlace(op.id, { from: 'Đà Lạt', to: 'sài gòn' }))).toBe('VALIDATION_FAILED');
    // NFD (bàn phím macOS) được chuẩn về NFC nên gộp đúng vào điểm có sẵn.
    expect((await s.trips.renamePlace(op.id, { from: 'Đà Lạt', to: 'Đà Lạt'.normalize('NFD') })).updated).toBe(0);
    expect(await errorCode(s.trips.renamePlace(op.id, { from: 'Không có', to: 'X' }))).toBe('NOT_FOUND');
    // Gộp: Nha Trang → Đà Lạt (đã có) được phép vì không tạo tuyến trùng điểm.
    expect(await s.trips.renamePlace(op.id, { from: 'Nha Trang', to: 'Đà Lạt' })).toMatchObject({ updated: 2 });
    expect((await names()).filter((n) => n.includes('Nha Trang'))).toEqual([]);
    // Nhà xe khác không đổi được điểm của AB.
    const ca = await s.operators.getByCode('CA');
    expect(await errorCode(s.trips.renamePlace(ca.id, { from: 'Sài Gòn', to: 'X' }))).toBe('NOT_FOUND');
  });

  it('deletes an unused route but not one with trips or a schedule', async () => {
    const op = await s.operators.getByCode('AB');
    const ca = await s.operators.getByCode('CA');
    const routes = await s.trips.listRoutes(op.id);
    const nt = routes.find((r) => r.code === 'SG-NT')!;
    expect(await errorCode(s.trips.deleteRoute(ca.id, nt.id))).toBe('NOT_FOUND');
    await s.trips.deleteRoute(op.id, nt.id);
    expect((await s.trips.listRoutes(op.id)).some((r) => r.id === nt.id)).toBe(false);

    const dl = routes.find((r) => r.code === 'SG-DL')!;
    await s.db.query(`INSERT INTO trip_schedules (operator_id, name, config) VALUES ($1, 'Lịch tuyến', $2)`, [
      op.id,
      JSON.stringify({ legs: [{ routeId: dl.id.toUpperCase() }] }),
    ]);
    expect(await errorCode(s.trips.deleteRoute(op.id, dl.id))).toBe('CONFLICT');

    const pn = await s.operators.getByCode('PN');
    const used = (await s.trips.listRoutes(pn.id))[0]!;
    expect(await errorCode(s.trips.deleteRoute(pn.id, used.id))).toBe('CONFLICT');
  });
});

describe('audit hooks run inside the write transaction (F60)', () => {
  const failingAudit = async () => {
    throw new Error('audit insert failed');
  };

  it('a failing audit rolls back a vehicle delete', async () => {
    const op = await s.operators.getByCode('AB');
    const seat = await s.layouts.latest(null, 'SEAT29');
    const v = await s.vehicles.create(op.id, { code: 'AB07', name: 'Xe giữ lại', type: 'SEATER', seatLayoutId: seat!.id });
    await expect(s.vehicles.remove(op.id, v.id, failingAudit)).rejects.toThrow('audit insert failed');
    expect((await s.vehicles.get(op.id, v.id)).id).toBe(v.id);
    const seen: string[] = [];
    await s.vehicles.remove(op.id, v.id, async (q, row) => {
      // Hook thấy cùng transaction: xe đã bị xóa trong đó.
      const { rowCount } = await q.query('SELECT 1 FROM vehicles WHERE id = $1', [row.id]);
      seen.push(`${row.code}:${rowCount}`);
    });
    expect(seen).toEqual(['AB07:0']);
  });

  it('a failing audit rolls back a route delete and a place rename', async () => {
    const op = await s.operators.getByCode('AB');
    const r = await s.trips.createRoute(op.id, { code: 'AU-DT', origin: 'Điểm A', destination: 'Điểm B' });
    await expect(s.trips.deleteRoute(op.id, r.id, failingAudit)).rejects.toThrow('audit insert failed');
    expect((await s.trips.listRoutes(op.id)).some((x) => x.id === r.id)).toBe(true);
    await expect(s.trips.renamePlace(op.id, { from: 'Điểm A', to: 'Điểm C' }, failingAudit)).rejects.toThrow();
    expect((await s.trips.listRoutes(op.id)).find((x) => x.id === r.id)!.origin).toBe('Điểm A');
    // Đổi tên không trúng hàng nào thì không ghi nhật ký.
    const hook = jest.fn(async () => undefined);
    expect((await s.trips.renamePlace(op.id, { from: 'Điểm A', to: 'Điểm A' }, hook)).updated).toBe(0);
    expect(hook).not.toHaveBeenCalled();
  });

});
