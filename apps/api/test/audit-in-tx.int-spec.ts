import { Queryable } from '../src/db/db';
import { AuditService } from '../src/audit/audit.service';
import { TripAssistantsService } from '../src/trips/trip-assistants.service';
import { TripSchedulesService } from '../src/trips/trip-schedules.service';
import { LIMO_FARES, Services, buildServices, newKey, resetDatabase, seedOperatorWithTrips } from './helpers';

/**
 * GE3: các thao tác tạo/sửa của trang quản trị ghi nhật ký trong cùng transaction (như F60).
 * Hook lỗi thì thay đổi không được lưu; hook thành công thấy được dữ liệu vừa ghi qua `q`.
 */
let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let assistants: TripAssistantsService;

const failingAudit = async () => {
  throw new Error('audit insert failed');
};
const count = async (sql: string, params: unknown[] = []) => (await s.db.query(sql, params)).rowCount ?? 0;
/** Hook ghi lại kết quả câu truy vấn chạy bên trong transaction. */
const probe = (sql: string, params: (r: { id: string }) => unknown[]) => {
  const seen: number[] = [];
  const hook = async (q: Queryable, r: { id: string }) => {
    seen.push((await q.query(sql, params(r))).rowCount ?? 0);
  };
  return { seen, hook };
};

const LAYOUT = { code: 'GE3', name: 'Mẫu GE3', unit: 'giường', kind: 'bed', definition: { floors: [{ code: '1', label: 'Tầng dưới', rows: ['A1 A2'] }] } } as const;
const tripInput = (vehicleId: string, routeId: string, day: number) => ({
  routeId,
  vehicleId,
  name: `Chuyến GE3 ${day}`,
  salesOpenAt: new Date('2027-01-01T00:00:00Z'),
  departAt: new Date(`2027-03-${String(day).padStart(2, '0')}T11:00:00Z`),
  salesCloseAt: new Date(`2027-03-${String(day).padStart(2, '0')}T10:00:00Z`),
  fares: LIMO_FARES,
});

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'GE');
  assistants = new TripAssistantsService(s.db, s.clock);
});

afterAll(async () => {
  await s.db.close();
});

describe('operator writes', () => {
  it('profile: a failing audit keeps the old name', async () => {
    const input = { name: 'Tên mới GE3', defaultDepartureTime: '07:30' };
    await expect(s.operators.updateProfile(seed.op.id, input, failingAudit)).rejects.toThrow('audit insert failed');
    expect((await s.operators.profile(seed.op.id)).name).toBe('Nhà xe GE');
    const hook = jest.fn(async () => undefined);
    await s.operators.updateProfile(seed.op.id, input, hook);
    expect(hook).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(input));
  });

  it('logo: a failing audit keeps the previous logo, removal too', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    await expect(s.operators.setLogo(seed.op.id, png, 'image/png', s.clock.now(), failingAudit)).rejects.toThrow('audit insert failed');
    expect((await s.operators.profile(seed.op.id)).logoVersion).toBeNull();
    await s.operators.setLogo(seed.op.id, png, 'image/png', s.clock.now(), async (_q, mime) => expect(mime).toBe('image/png'));
    await expect(s.operators.removeLogo(seed.op.id, failingAudit)).rejects.toThrow('audit insert failed');
    expect((await s.operators.profile(seed.op.id)).logoVersion).not.toBeNull();
  });

  it('create operator: a failing audit leaves no operator, policy or default vehicles', async () => {
    await expect(s.operators.create({ code: 'GX', name: 'Nhà xe GX' }, failingAudit)).rejects.toThrow('audit insert failed');
    expect(await count(`SELECT 1 FROM operators WHERE code = 'GX'`)).toBe(0);
    expect(await count(`SELECT 1 FROM vehicles WHERE code LIKE 'GX%'`)).toBe(0);
    const p = probe('SELECT 1 FROM vehicles WHERE operator_id = $1', (op: { id: string }) => [op.id]);
    await s.operators.create({ code: 'GX', name: 'Nhà xe GX' }, p.hook);
    expect(p.seen).toEqual([2]);
  });
});

describe('fleet writes', () => {
  it('seat layout: a failing audit leaves no new version', async () => {
    await expect(s.layouts.create(seed.op.id, LAYOUT, undefined, failingAudit)).rejects.toThrow('audit insert failed');
    expect(await count(`SELECT 1 FROM seat_layouts WHERE code = 'GE3'`)).toBe(0);
    const p = probe('SELECT 1 FROM seats WHERE seat_layout_id = $1', (l: { id: string }) => [l.id]);
    await s.layouts.create(seed.op.id, LAYOUT, undefined, p.hook);
    expect(p.seen).toEqual([2]);
  });

  it('vehicle create and update: a failing audit changes nothing', async () => {
    const input = { code: 'GE09', name: 'Xe GE3', type: 'LIMOUSINE' as const, seatLayoutId: seed.limo.seat_layout_id };
    await expect(s.vehicles.create(seed.op.id, input, failingAudit)).rejects.toThrow('audit insert failed');
    expect(await count(`SELECT 1 FROM vehicles WHERE code = 'GE09'`)).toBe(0);
    const p = probe('SELECT 1 FROM vehicles WHERE id = $1', (v: { id: string }) => [v.id]);
    const v = await s.vehicles.create(seed.op.id, input, p.hook);
    expect(p.seen).toEqual([1]);
    await expect(s.vehicles.update(seed.op.id, v.id, { name: 'Xe GE3 mới' }, failingAudit)).rejects.toThrow('audit insert failed');
    expect((await s.vehicles.get(seed.op.id, v.id)).name).toBe('Xe GE3');
  });
});

describe('route and trip writes', () => {
  it('route, route pair and stops: a failing audit changes nothing', async () => {
    await expect(s.trips.createRoute(seed.op.id, { code: 'GE-1', origin: 'A', destination: 'B' }, failingAudit)).rejects.toThrow('audit insert failed');
    await expect(
      s.trips.createRoutePair(seed.op.id, { origin: 'C', destination: 'D', code: 'GE-C', reverseCode: 'GE-D' }, failingAudit),
    ).rejects.toThrow('audit insert failed');
    expect(await count(`SELECT 1 FROM routes WHERE code LIKE 'GE-%'`)).toBe(0);
    const stopsOf = async () => (await s.db.query('SELECT stops FROM routes WHERE id = $1', [seed.route.id])).rows[0]!.stops;
    const before = await stopsOf();
    const stops = { pickup: [{ name: 'Bến xe Miền Đông', time: '17:30', day: 0 }], dropoff: [{ name: 'Hoài Ân', time: '07:00', day: 1 }] };
    // Lưu điểm đón/trả đi qua TripSchedulesService (áp luôn vào chuyến chưa khởi hành); hook chạy trong cùng transaction.
    const schedules = new TripSchedulesService(s.db, s.clock, s.trips, new AuditService(s.db));
    await expect(schedules.saveRouteStops(seed.op.id, seed.route.id, stops, failingAudit)).rejects.toThrow('audit insert failed');
    expect(await stopsOf()).toEqual(before);
    expect(before).not.toEqual(stops);
    await s.trips.saveStops(seed.op.id, seed.route.id, stops);
    expect(await stopsOf()).toEqual(stops);
  });

  it('trip create: a failing audit leaves no trip, seats or fares; replay still calls the hook', async () => {
    const input = tripInput(seed.limo.id, seed.route.id, 10);
    const key = newKey();
    await expect(s.trips.createTrip(seed.op.id, input, key, undefined, undefined, failingAudit)).rejects.toThrow('audit insert failed');
    expect(await count(`SELECT 1 FROM trips WHERE name = 'Chuyến GE3 10'`)).toBe(0);
    const p = probe('SELECT 1 FROM trip_seats WHERE trip_id = $1', (t: { id: string }) => [t.id]);
    const t = await s.trips.createTrip(seed.op.id, input, key, undefined, undefined, p.hook);
    expect(p.seen[0]).toBeGreaterThan(0);
    const hook = jest.fn(async () => undefined);
    const again = await s.trips.createTrip(seed.op.id, input, key, undefined, undefined, hook);
    expect(again).toMatchObject({ id: t.id, replayed: true });
    expect(hook).toHaveBeenCalledWith(expect.anything(), again);
  });

  it('trip batch: a failing audit leaves neither direction', async () => {
    const back = await s.trips.createRoute(seed.op.id, { code: 'HA-HCM', origin: 'Hoài Ân', destination: 'TP.HCM' });
    const input = { trips: [tripInput(seed.limo.id, seed.route.id, 12), { ...tripInput(seed.bed.id, back.id, 12), fares: [
      { floor: '1', occupancy: 1 as const, price: 380_000 }, { floor: '2', occupancy: 1 as const, price: 350_000 },
    ] }] };
    await expect(s.trips.createBatch(seed.op.id, input, newKey(), failingAudit)).rejects.toThrow('audit insert failed');
    expect(await count(`SELECT 1 FROM trips WHERE name = 'Chuyến GE3 12'`)).toBe(0);
    const hook = jest.fn(async () => undefined);
    const r = await s.trips.createBatch(seed.op.id, input, newKey(), hook);
    expect(r.trips).toHaveLength(2);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('assistants: a failing audit keeps the previous assignment', async () => {
    const { rows: [u] } = await s.db.query<{ id: string }>(
      `INSERT INTO users (operator_id, full_name, phone, password_hash, role) VALUES ($1, 'Phụ xe GE3', '+84907300001', 'x', 'ASSISTANT') RETURNING id`,
      [seed.op.id],
    );
    const trip = seed.limoTrip.id;
    await expect(assistants.setForTrip(seed.op.id, trip, { userIds: [u!.id] }, null, failingAudit)).rejects.toThrow('audit insert failed');
    expect(await count('SELECT 1 FROM trip_assistants WHERE trip_id = $1', [trip])).toBe(0);
    const hook = jest.fn(async () => undefined);
    await assistants.setForTrip(seed.op.id, trip, { userIds: [u!.id] }, null, hook);
    expect(hook).toHaveBeenCalledWith(expect.anything(), { added: [u!.id], removed: [] });
  });
});
