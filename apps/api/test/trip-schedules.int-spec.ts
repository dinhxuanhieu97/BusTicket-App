import { TripSchedulesService } from '../src/trips/trip-schedules.service';
import { AuditService } from '../src/audit/audit.service';
import {
  buildServices,
  resetDatabase,
  seedOperatorWithTrips,
  Services,
  BED_FARES,
  LIMO_FARES,
  errorCode,
} from './helpers';
let s: Services,
  schedules: TripSchedulesService,
  seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>,
  reverse: { id: string };
let n = 0;
beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  schedules = new TripSchedulesService(s.db, s.clock, s.trips, new AuditService(s.db));
});
afterAll(async () => s.db.close());
beforeEach(async () => {
  s.clock.set(new Date('2027-02-05T00:00:00Z'));
  seed = await seedOperatorWithTrips(s, 'S' + String.fromCharCode(65 + n++));
  reverse = await s.trips.createRoute(seed.op.id, { code: 'HA-HCM', origin: 'Hoài Ân', destination: 'TP.HCM' });
});
const config = () => ({
  name: 'Daily',
  startDate: '2027-02-05',
  departTime: '17:30',
  arrivalTime: '07:00',
  turnaroundMinutes: 60,
  legs: [
    {
      routeId: seed.route.id,
      vehicles: [
        { vehicleId: seed.limo.id, fares: LIMO_FARES },
        { vehicleId: seed.bed.id, fares: BED_FARES },
      ],
    },
    {
      routeId: reverse.id,
      vehicles: [
        { vehicleId: seed.bed.id, fares: BED_FARES },
        { vehicleId: seed.limo.id, fares: LIMO_FARES },
      ],
    },
  ],
});
async function enabled() {
  const row = await schedules.create(seed.op.id, config(), null);
  await schedules.setEnabled(seed.op.id, row.id, true, null);
  return row;
}
it('creates 60 trips, alternates vehicles, snapshots fares and is concurrency safe', async () => {
  const row = await enabled();
  const result = await Promise.all([schedules.generate(seed.op.id, row.id), schedules.generate(seed.op.id, row.id)]);
  expect(result.reduce((v, r) => v + r.created, 0)).toBe(60);
  const trips = (
    await s.db.query(
      'SELECT id,vehicle_id,service_date::text,schedule_leg FROM trips WHERE schedule_id=$1 ORDER BY service_date,schedule_leg',
      [row.id],
    )
  ).rows;
  expect(trips).toHaveLength(60);
  expect(trips[0]!.vehicle_id).toBe(seed.limo.id);
  expect(trips[2]!.vehicle_id).toBe(seed.bed.id);
  expect((await s.trips.adminDetail(seed.op.id, trips[0]!.id)).fares.map((f) => f.price)).toEqual(
    LIMO_FARES.map((f) => f.price),
  );
  s.clock.set(new Date('2027-02-06T00:00:00Z'));
  expect((await schedules.generate(seed.op.id, row.id)).created).toBe(2);
});
it('preserves skip exceptions and changes an unbooked occurrence without making a duplicate', async () => {
  const row = await enabled();
  await schedules.saveException(
    seed.op.id,
    row.id,
    { date: '2027-02-06', leg: 0, skipped: true, repositionConfirmed: true },
    null,
  );
  expect((await schedules.generate(seed.op.id, row.id)).created).toBe(59);
  await schedules.saveException(
    seed.op.id,
    row.id,
    { date: '2027-02-07', leg: 1, skipped: false, departTime: '18:30' },
    null,
  );
  expect(
    (
      await s.db.query('SELECT depart_at FROM trips WHERE schedule_id=$1 AND service_date=$2 AND schedule_leg=1', [
        row.id,
        '2027-02-07',
      ])
    ).rows[0]!.depart_at.toISOString(),
  ).toBe('2027-02-07T11:30:00.000Z');
  await schedules.saveException(
    seed.op.id,
    row.id,
    { date: '2027-02-07', leg: 1, skipped: true, repositionConfirmed: true },
    null,
  );
  expect((await schedules.generate(seed.op.id, row.id)).created).toBe(0);
  expect(
    (
      await s.db.query('SELECT status FROM trips WHERE schedule_id=$1 AND service_date=$2 AND schedule_leg=1', [
        row.id,
        '2027-02-07',
      ])
    ).rows[0]!.status,
  ).toBe('CANCELLED');
});
it('rejects a different tenant, invalid rotation and missing fares without partial generation', async () => {
  const bad = config();
  bad.legs[1]!.vehicles.reverse();
  await expect(schedules.create(seed.op.id, bad, null)).rejects.toThrow();
  const row = await enabled();
  expect(await errorCode(schedules.generate('00000000-0000-4000-8000-000000000000', row.id))).toBe('NOT_FOUND');
  await s.db.query("UPDATE vehicles SET status='MAINTENANCE' WHERE id=$1", [seed.bed.id]);
  await expect(schedules.generate(seed.op.id, row.id)).rejects.toThrow();
  expect((await s.db.query('SELECT id FROM trips WHERE schedule_id=$1', [row.id])).rows).toHaveLength(0);
  expect((await schedules.list(seed.op.id))[0]!.last_error).toBeTruthy();
});
it('pausing leaves existing trips alone and creates nothing further', async () => {
  const row = await enabled();
  await schedules.generate(seed.op.id, row.id);
  await schedules.setEnabled(seed.op.id, row.id, false, null);
  s.clock.set(new Date('2027-02-06T00:00:00Z'));
  expect((await schedules.generate(seed.op.id, row.id)).created).toBe(0);
  expect((await s.db.query('SELECT id FROM trips WHERE schedule_id=$1', [row.id])).rows).toHaveLength(60);
});
it('refuses time changes/cancellation once any booking exists', async () => {
  const row = await enabled();
  await schedules.generate(seed.op.id, row.id);
  const trip = (
    await s.db.query('SELECT id FROM trips WHERE schedule_id=$1 AND service_date=$2 AND schedule_leg=0', [
      row.id,
      '2027-02-05',
    ])
  ).rows[0]!;
  await s.bookings.createHold(
    { tripId: trip.id, contactName: 'Test', contactPhone: '0912345678', items: [{ seatCode: 'A1', occupancy: 1 }] },
    'schedule-hold-test',
  );
  expect(
    await errorCode(
      schedules.saveException(
        seed.op.id,
        row.id,
        { date: '2027-02-05', leg: 0, skipped: true, repositionConfirmed: true },
        null,
      ),
    ),
  ).toBe('CONFLICT');
});
it('blocks manual trips that overlap scheduled vehicles', async () => {
  const row = await enabled();
  await schedules.generate(seed.op.id, row.id);
  expect(
    await errorCode(
      s.trips.createTrip(
        seed.op.id,
        {
          routeId: seed.route.id,
          vehicleId: seed.limo.id,
          name: 'Conflict',
          departAt: new Date('2027-02-05T11:00:00Z'),
          salesOpenAt: s.clock.now(),
          salesCloseAt: new Date('2027-02-05T11:00:00Z'),
          fares: LIMO_FARES,
          status: 'OPEN',
        },
        'manual-conflict-test',
      ),
    ),
  ).toBe('CONFLICT');
});

it('creates a two-direction draft atomically and replays the same request', async () => {
  const departAt = new Date('2027-02-05T10:30:00Z');
  const fields = { departAt, salesOpenAt: s.clock.now(), salesCloseAt: departAt, status: 'DRAFT' as const };
  const good = {
    trips: [
      { ...fields, routeId: seed.route.id, vehicleId: seed.limo.id, name: 'Out', fares: LIMO_FARES },
      { ...fields, routeId: reverse.id, vehicleId: seed.bed.id, name: 'Back', fares: BED_FARES },
    ],
  };
  const bad = { trips: [good.trips[0]!, { ...good.trips[1]!, fares: LIMO_FARES }] };
  await expect(s.trips.createBatch(seed.op.id, bad, 'batch-fail-key')).rejects.toThrow();
  expect(await s.trips.listForAdmin(seed.op.id, '2027-02-05')).toHaveLength(0);
  const first = await s.trips.createBatch(seed.op.id, good, 'batch-success-key');
  const second = await s.trips.createBatch(seed.op.id, good, 'batch-success-key');
  expect(second.trips.map((t) => t.id)).toEqual(first.trips.map((t) => t.id));
  expect(second.trips.every((t) => t.replayed)).toBe(true);
  expect(await s.trips.listForAdmin(seed.op.id, '2027-02-05')).toHaveLength(2);
});

it('profiles and route pairs are editable per operator without changing stable ids', async () => {
  const before = await s.operators.profile(seed.op.id);
  expect(before.defaultDepartureTime).toBe('17:30');
  const saved = await s.operators.updateProfile(seed.op.id, { name: 'Nhà xe kiểm thử', defaultDepartureTime: '16:45' });
  expect(saved).toMatchObject({
    id: before.id,
    code: before.code,
    name: 'Nhà xe kiểm thử',
    defaultDepartureTime: '16:45',
  });
  await expect(
    s.operators.updateProfile(seed.op.id, { name: 'Other', defaultDepartureTime: '25:00' }),
  ).rejects.toThrow();
  const pair = await s.trips.createRoutePair(seed.op.id, {
    code: 'HCM-HA',
    reverseCode: 'HA-HCM',
    origin: 'TP.HCM',
    destination: 'Hoài Ân',
  });
  expect(pair.routes.map((r) => r.id)).toEqual([seed.route.id, reverse.id]);
  expect(
    await errorCode(
      s.trips.createRoutePair(seed.op.id, {
        code: 'NEW-HA',
        reverseCode: 'HA-HCM',
        origin: 'Other',
        destination: 'Hoài Ân',
      }),
    ),
  ).toBe('CONFLICT');
  expect((await s.trips.listRoutes(seed.op.id)).map((r) => r.code)).not.toContain('NEW-HA');
});

it('shifts a scheduled pickup with a time exception and keeps existing timeline snapshots', async () => {
  await s.trips.saveStops(seed.op.id, seed.route.id, {
    pickup: [{ name: 'Điểm đón', time: '18:30', day: 0 }],
    dropoff: [],
  });
  const row = await enabled();
  await schedules.generate(seed.op.id, row.id);
  const trip = (
    await s.db.query('SELECT id FROM trips WHERE schedule_id=$1 AND service_date=$2 AND schedule_leg=0', [
      row.id,
      '2027-02-06',
    ])
  ).rows[0]!;
  await s.trips.saveStops(seed.op.id, seed.route.id, { pickup: [], dropoff: [] });
  await schedules.saveException(
    seed.op.id,
    row.id,
    { date: '2027-02-06', leg: 0, skipped: false, departTime: '18:30' },
    null,
  );
  expect((await s.trips.seatMap(trip.id)).stops.pickup).toEqual([{ name: 'Điểm đón', time: '19:30', day: 0 }]);
  expect((await s.trips.adminDetail(seed.op.id, trip.id)).trip.arriveAt).toBe('2027-02-07T01:00:00.000Z');
});

it('requires a reposition plan when skipping, and rejects a past time before generation', async () => {
  const row = await enabled();
  await expect(
    schedules.saveException(seed.op.id, row.id, { date: '2027-02-06', leg: 0, skipped: true }, null),
  ).rejects.toThrow();
  s.clock.set(new Date('2027-02-05T11:00:00Z'));
  expect(
    await errorCode(
      schedules.saveException(
        seed.op.id,
        row.id,
        { date: '2027-02-05', leg: 0, skipped: false, departTime: '17:00' },
        null,
      ),
    ),
  ).toBe('CONFLICT');
});

it('never cancels a scheduled trip and creates a hold concurrently', async () => {
  const row = await enabled();
  await schedules.generate(seed.op.id, row.id);
  const trip = (
    await s.db.query('SELECT id FROM trips WHERE schedule_id=$1 AND service_date=$2 AND schedule_leg=0', [
      row.id,
      '2027-02-05',
    ])
  ).rows[0]!;
  const actions = await Promise.allSettled([
    s.bookings.createHold(
      { tripId: trip.id, contactName: 'Test', contactPhone: '0912345678', items: [{ seatCode: 'A1', occupancy: 1 }] },
      'schedule-race-hold',
    ),
    schedules.saveException(
      seed.op.id,
      row.id,
      { date: '2027-02-05', leg: 0, skipped: true, repositionConfirmed: true },
      null,
    ),
  ]);
  expect(actions.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
});

it('batch rejects a vehicle still occupied by a longer manual trip', async () => {
  await s.trips.saveStops(seed.op.id, seed.route.id, {
    pickup: [],
    dropoff: [{ name: 'Điểm cuối', time: '18:00', day: 1 }],
  });
  const departAt = new Date('2027-02-05T10:30:00Z');
  const first = {
    routeId: seed.route.id,
    vehicleId: seed.limo.id,
    name: 'Long trip',
    departAt,
    salesOpenAt: s.clock.now(),
    salesCloseAt: departAt,
    fares: LIMO_FARES,
    status: 'DRAFT' as const,
  };
  await s.trips.createTrip(seed.op.id, first, 'manual-long-trip');
  const next = new Date('2027-02-06T06:30:00Z');
  expect(
    await errorCode(
      s.trips.createBatch(
        seed.op.id,
        {
          trips: [
            { ...first, departAt: next, salesCloseAt: next },
            {
              ...first,
              routeId: reverse.id,
              vehicleId: seed.bed.id,
              fares: BED_FARES,
              departAt: next,
              salesCloseAt: next,
            },
          ],
        },
        'batch-long-trip',
      ),
    ),
  ).toBe('CONFLICT');
});

it('prevents scheduled occurrences with incomplete metadata or another operator', async () => {
  const row = await enabled();
  await schedules.generate(seed.op.id, row.id);
  const trip = (await s.db.query('SELECT id FROM trips WHERE schedule_id=$1 LIMIT 1', [row.id])).rows[0]!;
  await expect(s.db.query('UPDATE trips SET schedule_leg=NULL WHERE id=$1', [trip.id])).rejects.toMatchObject({
    code: '23514',
  });
  const other = await s.operators.create({ code: 'XX', name: 'Other' });
  await expect(s.db.query('UPDATE trips SET operator_id=$2 WHERE id=$1', [trip.id, other.id])).rejects.toMatchObject({
    code: '23503',
  });
});

describe('saveRouteStops (RT5a): new pickup points reach trips the schedule already created', () => {
  const tripOn = async (scheduleId: string, date: string, leg: number) =>
    (
      await s.db.query<{ id: string }>(
        'SELECT id FROM trips WHERE schedule_id=$1 AND service_date=$2 AND schedule_leg=$3',
        [scheduleId, date, leg],
      )
    ).rows[0]!.id;
  const NEW_STOPS = {
    pickup: [
      { name: 'Bưu điện Ân Nghĩa', time: '16:30', day: 0 },
      { name: 'Hoài Nhơn', time: '17:00', day: 0 },
      { name: 'Phù Mỹ', time: '17:20', day: 0 },
    ],
    dropoff: [{ name: 'Bx. An Sương', time: '07:30', day: 1 }],
  };

  it('copies the points into future trips, shifted by each trip’s own departure, and leaves departed trips alone', async () => {
    await s.trips.saveStops(seed.op.id, seed.route.id, {
      pickup: [{ name: 'Bưu điện Ân Nghĩa', time: '16:30', day: 0 }],
      dropoff: [],
    });
    const row = await enabled();
    await schedules.generate(seed.op.id, row.id);
    await schedules.saveException(
      seed.op.id,
      row.id,
      { date: '2027-02-06', leg: 0, skipped: false, departTime: '18:30' },
      null,
    );
    // Hai chuyến tạo tay của seed đọc thẳng điểm của tuyến; hủy để chỉ còn chuyến từ lịch.
    await s.db.query("UPDATE trips SET status='CANCELLED' WHERE id = ANY($1::uuid[])", [
      [seed.limoTrip.id, seed.bedTrip.id],
    ]);
    s.clock.set(new Date('2027-02-05T11:00:00Z')); // 18:00 giờ VN: chuyến 17:30 ngày 05/02 đã chạy.
    const departed = await tripOn(row.id, '2027-02-05', 0);
    const shifted = await tripOn(row.id, '2027-02-06', 0);
    const normal = await tripOn(row.id, '2027-02-07', 0);
    const reverseTrip = await tripOn(row.id, '2027-02-07', 1);
    expect((await s.trips.discover(seed.op.code)).find((r) => r.code === 'HCM-HA')!.pickupStops).toEqual([
      'Bưu điện Ân Nghĩa',
    ]);

    const result = await schedules.saveRouteStops(seed.op.id, seed.route.id, NEW_STOPS);

    expect(result.stops).toEqual(NEW_STOPS);
    expect(result.updatedTrips).toBe(29); // 30 ngày chiều đi, trừ chuyến đã chạy.
    expect((await s.trips.seatMap(normal)).stops).toEqual(NEW_STOPS);
    expect((await s.trips.seatMap(shifted)).stops).toEqual({
      pickup: [
        { name: 'Bưu điện Ân Nghĩa', time: '17:30', day: 0 },
        { name: 'Hoài Nhơn', time: '18:00', day: 0 },
        { name: 'Phù Mỹ', time: '18:20', day: 0 },
      ],
      dropoff: [{ name: 'Bx. An Sương', time: '08:30', day: 1 }],
    });
    const old = await s.db.query('SELECT stops_snapshot FROM trips WHERE id=$1', [departed]);
    expect(old.rows[0]!.stops_snapshot.pickup).toEqual([{ name: 'Bưu điện Ân Nghĩa', time: '16:30', day: 0 }]);
    expect((await s.trips.seatMap(reverseTrip)).stops).toEqual({ pickup: [], dropoff: [] });
    // Form tìm của Mini App lấy điểm từ chuyến đang bán: điểm mới hiện ngay.
    expect((await s.trips.discover(seed.op.code)).find((r) => r.code === 'HCM-HA')!.pickupStops).toEqual([
      'Bưu điện Ân Nghĩa',
      'Hoài Nhơn',
      'Phù Mỹ',
    ]);
    // Chuyến sinh sau đó cũng theo điểm mới.
    s.clock.set(new Date('2027-02-06T00:00:00Z'));
    await schedules.generate(seed.op.id, row.id);
    expect((await s.trips.seatMap(await tripOn(row.id, '2027-03-07', 0))).stops).toEqual(NEW_STOPS);
  });

  it('saves nothing when a point is out of order or a shifted trip would leave its days', async () => {
    const row = await enabled();
    await schedules.generate(seed.op.id, row.id);
    await schedules.saveException(
      seed.op.id,
      row.id,
      { date: '2027-02-06', leg: 0, skipped: false, departTime: '18:30' },
      null,
    );
    const before = (await s.trips.listRoutes(seed.op.id)).find((r) => r.id === seed.route.id)!.stops;
    expect(
      await errorCode(
        schedules.saveRouteStops(seed.op.id, seed.route.id, {
          pickup: [NEW_STOPS.pickup[1], NEW_STOPS.pickup[0]],
          dropoff: [],
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    // 23:30 ngày 7 + 1 giờ của chuyến dời giờ = ngày 8: cả tuyến lẫn chuyến không đổi.
    expect(
      await errorCode(
        schedules.saveRouteStops(seed.op.id, seed.route.id, {
          pickup: [],
          dropoff: [{ name: 'Rất xa', time: '23:30', day: 7 }],
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect((await s.trips.listRoutes(seed.op.id)).find((r) => r.id === seed.route.id)!.stops).toEqual(before);
    const snapshots = await s.db.query(
      "SELECT count(*)::int AS n FROM trips WHERE schedule_id=$1 AND stops_snapshot::text LIKE '%Rất xa%'",
      [row.id],
    );
    expect(snapshots.rows[0]!.n).toBe(0);
  });

  it('only touches the operator’s own route', async () => {
    const other = await s.operators.create({ code: 'Z' + String.fromCharCode(65 + n), name: 'Khác' });
    expect(await errorCode(schedules.saveRouteStops(other.id, seed.route.id, NEW_STOPS))).toBe('NOT_FOUND');
    expect(await errorCode(schedules.saveRouteStops(seed.op.id, 'not-a-uuid', NEW_STOPS))).toBe('NOT_FOUND');
  });
});
