/**
 * Demo data for an operator that has not gone live yet: extra vehicles, a demo route pair with stops, trips for the
 * coming days and counter bookings in every state (paid, deposit, unpaid, waiting for transfer, cancelled with and
 * without a refund, boarded). Everything goes through the normal services, so prices, seats, payments and audit
 * stay consistent with real data.
 *
 * Every row the seed writes is recognisable and removable:
 * - trips and bookings carry an Idempotency-Key starting with `demo-data-`;
 * - vehicles use codes `<OP>51..53` and names ending in "(demo)";
 * - the demo route pair uses codes `SG-QN` / `QN-SG`.
 * `removeDemoData` deletes them again (bookings with their seats, payments, refunds; then trips, vehicles, routes
 * that nothing else uses). Audit logs are kept on purpose.
 */
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.service';
import { NotConfiguredSmsSender } from '../abuse/sms-sender';
import { PassengerOpsService } from '../bookings/passenger-ops.service';
import { StaffBookingsService } from '../bookings/staff-bookings.service';
import { TokenSecret } from '../bookings/token-secret';
import { Clock } from '../common/clock';
import { Db, Queryable } from '../db/db';
import { OperatorsService } from '../operators/operators.service';
import { SeatLayoutsService } from '../seat-layouts/seat-layouts.service';
import { TripsService } from '../trips/trips.service';
import { VehiclesService } from '../vehicles/vehicles.service';

export const DEMO_KEY_PREFIX = 'demo-data-';
export const DEMO_ROUTE_CODES = ['SG-QN', 'QN-SG'] as const;
const DEMO_VEHICLE_SUFFIXES = ['51', '52', '53'] as const;
const DEMO_PLACE = 'Quy Nhơn';

export interface DemoSeedOptions {
  operatorCode: string;
  /** Number of days, starting today (VN time), to create demo trips and bookings for. */
  days: number;
  log?: (line: string) => void;
}

export interface DemoSeedSummary {
  operator: string;
  vehiclesCreated: number;
  routesCreated: number;
  tripsCreated: number;
  tripsSkipped: number;
  bookings: number;
  cancelled: number;
  boarded: number;
  skipped: number;
}

export interface DemoRemoveSummary {
  bookings: number;
  payments: number;
  trips: number;
  vehicles: number;
  routes: number;
}

const NAMES = [
  'Nguyễn Văn An', 'Trần Thị Bích', 'Lê Hoàng Cường', 'Phạm Thị Dung', 'Huỳnh Minh Đức', 'Võ Thị Hà',
  'Đặng Quốc Huy', 'Bùi Thị Lan', 'Đỗ Thanh Long', 'Ngô Thị Mai', 'Dương Văn Nam', 'Lý Thị Oanh',
  'Phan Văn Phúc', 'Trương Thị Quỳnh', 'Hồ Văn Sơn', 'Mai Thị Thu', 'Tô Văn Toàn', 'Cao Thị Uyên',
  'Lâm Văn Vinh', 'Châu Thị Xuân', 'Kiều Văn Yên', 'Đinh Thị Ánh', 'Tạ Văn Bảo', 'La Thị Cúc',
];

interface Scenario {
  pay: 'full' | 'deposit' | 'none';
  hold?: boolean;
  cancel?: 'unpaid' | 'paid';
  seats?: number;
  occupancy?: 1 | 2;
  infant?: number;
  board?: boolean;
  note?: string;
}

/** Cycled over the bookings of each trip; the first trip of each route gets all of them. */
export const SCENARIOS: Scenario[] = [
  { pay: 'full', board: true, note: 'Khách quen, đã thanh toán đủ' },
  { pay: 'none' },
  { pay: 'deposit', note: 'Đã cọc, thu phần còn lại trên xe' },
  { pay: 'none', hold: true, note: 'Giữ chỗ chờ chuyển khoản' },
  { pay: 'full', infant: 1, board: true, note: 'Có em bé đi kèm' },
  { pay: 'none', occupancy: 2, note: 'Hai người một phòng' },
  { pay: 'full', seats: 2, note: 'Gia đình 2 chỗ' },
  { pay: 'deposit', cancel: 'paid', note: 'Khách hủy sau khi cọc' },
  { pay: 'none', cancel: 'unpaid' },
  { pay: 'full', occupancy: 2, board: true },
  { pay: 'none', seats: 3, note: 'Nhóm đi công tác' },
  { pay: 'none', hold: true, note: 'Giữ chỗ, khách hẹn chuyển khoản tối nay' },
];

const DEMO_STOPS = (origin: string) => ({
  forward: {
    pickup: [
      { name: 'Bến xe Miền Đông mới', time: '19:00', day: 0 },
      { name: 'Ngã tư Thủ Đức', time: '19:20', day: 0 },
      { name: 'Suối Tiên', time: '19:35', day: 0 },
    ],
    dropoff: [
      { name: 'Sông Cầu', time: '06:00', day: 1 },
      { name: 'Ngã ba Phú Tài', time: '06:40', day: 1 },
      { name: `Bến xe ${DEMO_PLACE}`, time: '07:00', day: 1 },
    ],
  },
  reverse: {
    pickup: [
      { name: `Bến xe ${DEMO_PLACE}`, time: '19:00', day: 0 },
      { name: 'Ngã ba Phú Tài', time: '19:20', day: 0 },
      { name: 'Sông Cầu', time: '20:00', day: 0 },
    ],
    dropoff: [
      { name: 'Suối Tiên', time: '06:20', day: 1 },
      { name: 'Ngã tư Thủ Đức', time: '06:35', day: 1 },
      { name: origin.toLocaleLowerCase('vi').includes('hcm') || origin.toLocaleLowerCase('vi').includes('sài gòn')
        ? 'Bến xe Miền Đông mới' : origin, time: '07:00', day: 1 },
    ],
  },
});

/** Fare per floor/occupancy for a seat layout; pair rooms cost a bit less than two singles. */
async function faresFor(q: Queryable, layoutId: string, type: string) {
  const { rows } = await q.query<{ floor: string; max_occupancy: number }>(
    `SELECT floor, max(max_occupancy)::int AS max_occupancy FROM seats WHERE seat_layout_id = $1 AND sellable GROUP BY floor ORDER BY floor`,
    [layoutId],
  );
  const base = type === 'LIMOUSINE' ? 450_000 : type === 'SLEEPER' ? 380_000 : 300_000;
  const fares: { floor: string; occupancy: 1 | 2; price: number }[] = [];
  for (const r of rows) {
    const single = base - (r.floor === '1' ? 0 : 30_000);
    fares.push({ floor: r.floor, occupancy: 1, price: single });
    if (r.max_occupancy >= 2) fares.push({ floor: r.floor, occupancy: 2, price: Math.round((single * 1.55) / 10_000) * 10_000 });
  }
  return fares;
}

const SAIGON = /s[àa]i\s*g[òo]n|hcm|h[ồo]\s*ch[íi]\s*minh|an\s*s[ươ]+ng|mi[ềe]n\s*đ[ôo]ng|^sg\b/i;

/** The Saigon end of the operator's existing routes (route codes start with SG, or the place name says so). */
export function saigonSide(routes: { code: string; origin: string; destination: string }[]): string {
  for (const r of routes) {
    if (r.code.startsWith('SG')) return r.origin;
    if (r.code.endsWith('SG')) return r.destination;
  }
  for (const r of routes) {
    if (SAIGON.test(r.origin)) return r.origin;
    if (SAIGON.test(r.destination)) return r.destination;
  }
  return 'TP.HCM';
}

/** A stop only the demo routes use; together with the demo place it tells demo routes from real ones. */
const DEMO_STOP_MARK = 'Ngã ba Phú Tài';

function isDemoRoute(r: { origin: string; destination: string; stops?: unknown }): boolean {
  return (r.origin === DEMO_PLACE || r.destination === DEMO_PLACE) && JSON.stringify(r.stops ?? null).includes(DEMO_STOP_MARK);
}

/**
 * The outbox has no consumer yet, but when one ships it must not message anyone about demo data:
 * mark every pending event of demo bookings (and of their payments) as already processed.
 */
async function markOutboxProcessed(db: Db, operatorId: string): Promise<void> {
  await db.query(
    `UPDATE outbox_events e SET processed_at = now()
      WHERE e.operator_id = $1 AND e.processed_at IS NULL
        AND (e.aggregate_id IN (SELECT id FROM bookings WHERE operator_id = $1 AND idempotency_key LIKE $2)
          OR e.aggregate_id IN (SELECT a.payment_id FROM payment_allocations a JOIN bookings b ON b.id = a.booking_id
                                 WHERE b.operator_id = $1 AND b.idempotency_key LIKE $2))`,
    [operatorId, `${DEMO_KEY_PREFIX}%`],
  );
}

/** `YYYY-MM-DD` of a date in VN time (UTC+7, no DST). */
function vnDate(d: Date): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

function vnAt(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00+07:00`);
}

/** Deterministic pseudo-shuffle so bookings spread over the bus instead of filling seat A1, A2, ... */
function spread<T>(list: T[], seed: number): T[] {
  return list
    .map((v, i) => ({ v, k: Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453 }))
    .sort((a, b) => (a.k - Math.floor(a.k)) - (b.k - Math.floor(b.k)))
    .map((x) => x.v);
}

function demoPhone(tripIdx: number, i: number): string {
  // 0999 xxx xxx may belong to real subscribers, so nobody must ever be messaged: every outbox event the seed
  // causes is marked processed right away (see markOutboxProcessed), on top of notifyCustomer: false.
  return `0999${String((tripIdx * 37 + i * 11) % 1_000_000).padStart(6, '0')}`;
}

export class DemoSeeder {
  private readonly operators: OperatorsService;
  private readonly vehicles: VehiclesService;
  private readonly trips: TripsService;
  private readonly staff: StaffBookingsService;
  private readonly ops: PassengerOpsService;

  constructor(private readonly db: Db, private readonly clock: Clock, tokenSecret = new TokenSecret(randomBytes(32).toString('hex'))) {
    const layouts = new SeatLayoutsService(db);
    const audit = new AuditService(db);
    this.operators = new OperatorsService(db, layouts, new NotConfiguredSmsSender());
    this.vehicles = new VehiclesService(db, layouts);
    this.trips = new TripsService(db, this.operators, clock);
    this.staff = new StaffBookingsService(db, this.operators, audit, clock);
    this.ops = new PassengerOpsService(db, audit, clock, tokenSecret);
  }

  private async actor(operatorId: string): Promise<AuthUser> {
    const { rows } = await this.db.query<{ id: string; full_name: string; phone: string }>(
      `SELECT id, full_name, phone FROM users WHERE operator_id = $1 AND role = 'OWNER' AND status = 'ACTIVE' ORDER BY created_at LIMIT 1`,
      [operatorId],
    );
    const u = rows[0];
    if (!u) throw new Error('The operator has no active OWNER account; create one first (bookings need a creator).');
    return { id: u.id, operatorId, role: 'OWNER', fullName: u.full_name, phone: u.phone, mfaEnabled: false, scope: 'full' } as AuthUser;
  }

  async seed(opts: DemoSeedOptions): Promise<DemoSeedSummary> {
    const log = opts.log ?? (() => undefined);
    const op = await this.operators.getByCode(opts.operatorCode);
    const actor = await this.actor(op.id);
    const summary: DemoSeedSummary = {
      operator: op.code, vehiclesCreated: 0, routesCreated: 0, tripsCreated: 0, tripsSkipped: 0,
      bookings: 0, cancelled: 0, boarded: 0, skipped: 0,
    };

    // ---- Vehicles ----
    const existing = await this.vehicles.list(op.id);
    const layoutOf = (type: string) => existing.find((v) => v.type === type)?.seat_layout_id ?? existing[0]?.seat_layout_id;
    const wanted = [
      { suffix: DEMO_VEHICLE_SUFFIXES[0], name: 'Limousine phòng đôi (demo)', type: 'LIMOUSINE' as const, plate: '77B-999.51' },
      { suffix: DEMO_VEHICLE_SUFFIXES[1], name: 'Giường nằm (demo)', type: 'SLEEPER' as const, plate: '77B-999.52' },
      { suffix: DEMO_VEHICLE_SUFFIXES[2], name: 'Xe dự phòng đang bảo dưỡng (demo)', type: 'SLEEPER' as const, plate: '77B-999.53' },
    ];
    const demoVehicles: Record<string, { id: string; type: string; seat_layout_id: string }> = {};
    for (const w of wanted) {
      const code = op.code + w.suffix;
      let v = existing.find((x) => x.code === code);
      if (v && !v.name.endsWith('(demo)')) {
        throw new Error(`Vehicle ${code} already exists and is not demo data; refusing to put demo trips on it.`);
      }
      if (!v) {
        const layoutId = layoutOf(w.type);
        if (!layoutId) throw new Error('The operator has no vehicle to copy a seat layout from.');
        v = await this.vehicles.create(op.id, { code, name: w.name, type: w.type, seatLayoutId: layoutId, plateNumber: w.plate });
        if (w.suffix === '53') v = await this.vehicles.update(op.id, v.id, { status: 'MAINTENANCE' });
        summary.vehiclesCreated++;
        log(`vehicle ${code} created`);
      }
      demoVehicles[w.suffix] = v;
    }

    // ---- Demo route pair ----
    const routes = (await this.trips.listRoutes(op.id)) as { id: string; code: string; origin: string; destination: string; stops: unknown }[];
    const basePlace = saigonSide(routes.filter((r) => !DEMO_ROUTE_CODES.includes(r.code as never)));
    let forward = routes.find((r) => r.code === DEMO_ROUTE_CODES[0]);
    let reverse = routes.find((r) => r.code === DEMO_ROUTE_CODES[1]);
    for (const r of [forward, reverse]) {
      if (r && !isDemoRoute(r)) {
        throw new Error(`Route ${r.code} already exists and is not demo data; refusing to use or change it.`);
      }
    }
    if (!forward !== !reverse) throw new Error(`Only one of ${DEMO_ROUTE_CODES.join(' / ')} exists; fix the routes first.`);
    if (!forward || !reverse) {
      const pair = await this.trips.createRoutePair(op.id, {
        origin: basePlace, destination: DEMO_PLACE, code: DEMO_ROUTE_CODES[0], reverseCode: DEMO_ROUTE_CODES[1],
      });
      const stops = DEMO_STOPS(basePlace); // reverse/forward both contain DEMO_STOP_MARK
      const [f, r] = pair.routes as { id: string; code: string; origin: string; destination: string }[];
      await this.trips.saveStops(op.id, f!.id, stops.forward);
      await this.trips.saveStops(op.id, r!.id, stops.reverse);
      forward = { ...f!, stops: stops.forward } as never;
      reverse = { ...r!, stops: stops.reverse } as never;
      summary.routesCreated = 2;
      log(`routes ${DEMO_ROUTE_CODES.join(' / ')} created (${basePlace} ↔ ${DEMO_PLACE})`);
    }

    // ---- Demo trips on the demo pair: one each way per evening ----
    const now = this.clock.now();
    const today = vnDate(now);
    for (let d = 0; d < opts.days; d++) {
      // Each bus ends the night at the other end, so it drives back the next evening.
      const [a, b] = d % 2 === 0 ? [demoVehicles['51']!, demoVehicles['52']!] : [demoVehicles['52']!, demoVehicles['51']!];
      const plan = [
        { route: forward!, vehicle: a, label: `${basePlace} → ${DEMO_PLACE}` },
        { route: reverse!, vehicle: b, label: `${DEMO_PLACE} → ${basePlace}` },
      ];
      const date = vnDate(new Date(vnAt(today, '12:00').getTime() + d * 86_400_000));
      const departAt = vnAt(date, '19:00');
      if (departAt.getTime() - now.getTime() < 60 * 60_000) continue; // too late to sell today
      for (const p of plan) {
        const fares = await faresFor(this.db, p.vehicle.seat_layout_id, p.vehicle.type);
        const key = `${DEMO_KEY_PREFIX}trip-${p.route.code}-${date}`;
        // Already created by an earlier run (its request hash includes the sales start, so a replay would conflict).
        const known = await this.db.query('SELECT 1 FROM trips WHERE operator_id = $1 AND idempotency_key = $2', [op.id, key]);
        if (known.rowCount) continue;
        try {
          const res = await this.trips.createTrip(op.id, {
            routeId: p.route.id, vehicleId: p.vehicle.id, name: `${p.label} 19:00`,
            departAt, salesOpenAt: now, salesCloseAt: departAt, fares, status: 'OPEN',
          }, key);
          if (!(res as { replayed?: boolean }).replayed) summary.tripsCreated++;
        } catch (e) {
          summary.tripsSkipped++;
          log(`trip ${p.route.code} ${date} skipped: ${(e as Error).message}`);
        }
      }
    }

    // ---- Bookings on every open trip in the window (real schedule trips too) ----
    const until = new Date(vnAt(today, '00:00').getTime() + opts.days * 86_400_000);
    const { rows: trips } = await this.db.query<{ id: string; code: string; route_id: string; depart_at: Date }>(
      `SELECT t.id, t.code, t.route_id, t.depart_at FROM trips t
        WHERE t.operator_id = $1 AND t.status = 'OPEN' AND t.depart_at > $2 AND t.depart_at < $3
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = t.id AND b.idempotency_key LIKE $4)
        ORDER BY t.depart_at, t.code`,
      [op.id, new Date(now.getTime() + 30 * 60_000), until, `${DEMO_KEY_PREFIX}%`],
    );
    const seenRoute = new Set<string>();
    for (const [tripIdx, trip] of trips.entries()) {
      const first = !seenRoute.has(trip.route_id);
      seenRoute.add(trip.route_id);
      const made = await this.fillTrip(actor, op.id, trip, tripIdx, first ? SCENARIOS.length : 4 + (tripIdx % 5), first, log);
      summary.bookings += made.bookings;
      summary.cancelled += made.cancelled;
      summary.boarded += made.boarded;
      summary.skipped += made.skipped;
    }
    await markOutboxProcessed(this.db, op.id);
    log(`bookings: ${summary.bookings} on ${trips.length} trips (${summary.cancelled} cancelled, ${summary.boarded} boarded)`);
    return summary;
  }

  private async fillTrip(
    actor: AuthUser, operatorId: string, trip: { id: string; code: string }, tripIdx: number, count: number,
    boardSome: boolean, log: (l: string) => void,
  ) {
    const made = { bookings: 0, cancelled: 0, boarded: 0, skipped: 0 };
    const { rows: free } = await this.db.query<{ seat_code: string; floor: string; max_occupancy: number }>(
      `SELECT seat_code, floor, max_occupancy FROM trip_seats WHERE trip_id = $1 AND sellable AND booking_id IS NULL ORDER BY seat_code`,
      [trip.id],
    );
    const { rows: fares } = await this.db.query<{ floor: string; occupancy: number }>(
      'SELECT floor, occupancy FROM trip_fares WHERE trip_id = $1', [trip.id],
    );
    const pool = spread(free, tripIdx + 1);
    const hasFare = (floor: string, occ: number) => fares.some((f) => f.floor === floor && f.occupancy === occ);
    for (let i = 0; i < count; i++) {
      const sc = SCENARIOS[i % SCENARIOS.length]!;
      const n = sc.seats ?? 1;
      const wantPair = (sc.occupancy ?? 1) === 2 && pool.some((s) => s.max_occupancy >= 2 && hasFare(s.floor, 2));
      const occupancy = wantPair ? 2 : 1;
      const seats: typeof pool = [];
      for (let k = 0; k < pool.length && seats.length < n; ) {
        const s = pool[k]!;
        if (occupancy <= s.max_occupancy && hasFare(s.floor, occupancy)) {
          seats.push(s);
          pool.splice(k, 1);
        } else k++;
      }
      if (seats.length < n) break;
      const body = {
        contactName: NAMES[(tripIdx * 5 + i) % NAMES.length]!,
        contactPhone: demoPhone(tripIdx, i),
        ...(sc.note ? { note: `${sc.note} (dữ liệu demo)` } : { note: 'Dữ liệu demo' }),
        items: seats.map((s, k) => ({ seatCode: s.seat_code, occupancy, infantCount: k === 0 ? sc.infant ?? 0 : 0 })),
        confirm: !sc.hold,
        notifyCustomer: false,
      };
      try {
        const quote = (await this.staff.createAtCounter(actor, operatorId, trip.id, body, { dryRun: true })) as {
          ok: boolean; quote: { totalAmount: number; depositAmount: number } | null;
        };
        if (!quote.ok || !quote.quote) throw new Error('quote failed');
        const { totalAmount, depositAmount } = quote.quote;
        // Policy deposit when it is a real part payment; otherwise about half, so "đã cọc" shows money still due.
        const deposit = depositAmount > 0 && depositAmount < totalAmount
          ? depositAmount
          : Math.max(10_000, Math.round(totalAmount / 2 / 10_000) * 10_000);
        const paidAmount = sc.pay === 'full' ? totalAmount : sc.pay === 'deposit' ? Math.min(deposit, totalAmount) : 0;
        const res = (await this.staff.createAtCounter(actor, operatorId, trip.id, { ...body, paidAmount }, {
          dryRun: false, idempotencyKey: `${DEMO_KEY_PREFIX}${trip.id}-${i}`,
        })) as { booking: { code: string; status: string } };
        made.bookings++;
        const code = res.booking.code;
        if (sc.cancel) {
          await this.ops.cancel(actor, operatorId, code, { reason: 'Khách đổi lịch (dữ liệu demo)', notifyCustomer: false });
          made.cancelled++;
        } else if (boardSome && sc.board && res.booking.status === 'CONFIRMED') {
          await this.ops.setBoarding(actor, operatorId, trip.id, { bookingCode: code });
          made.boarded++;
        }
      } catch (e) {
        made.skipped++;
        log(`  ${trip.code} #${i} skipped: ${(e as Error).message}`);
      }
    }
    return made;
  }

  /** Deletes everything `seed` wrote for this operator. Safe to run twice. */
  async remove(operatorCode: string): Promise<DemoRemoveSummary> {
    const op = await this.operators.getByCode(operatorCode);
    return this.db.tx(async (c) => {
      const like = `${DEMO_KEY_PREFIX}%`;
      // Lock the demo trips first, like every booking write does.
      await c.query(
        `SELECT id FROM trips WHERE operator_id = $1 AND id IN (SELECT trip_id FROM bookings WHERE operator_id = $1 AND idempotency_key LIKE $2)
          ORDER BY id FOR NO KEY UPDATE`,
        [op.id, like],
      );
      const ids = (await c.query<{ id: string }>(
        'SELECT id FROM bookings WHERE operator_id = $1 AND idempotency_key LIKE $2', [op.id, like],
      )).rows.map((r) => r.id);
      let payments = 0;
      if (ids.length) {
        // Only counter cash recorded for demo bookings is deleted. Any other money (a real transfer to a demo code,
        // a payment shared with a real booking) stops the removal so a person can look at it first.
        const all = (await c.query<{ id: string; method: string; shared: boolean; code: string }>(
          `SELECT DISTINCT p.id, p.method, b.code,
                  EXISTS (SELECT 1 FROM payment_allocations o WHERE o.payment_id = p.id AND NOT (o.booking_id = ANY($1::uuid[]))) AS shared
             FROM payments p
             LEFT JOIN payment_allocations a ON a.payment_id = p.id
             JOIN bookings b ON b.id = COALESCE(a.booking_id, p.matched_booking_id)
            WHERE a.booking_id = ANY($1::uuid[]) OR p.matched_booking_id = ANY($1::uuid[])`,
          [ids],
        )).rows;
        const blocked = all.filter((p) => p.method !== 'CASH' || p.shared);
        if (blocked.length) {
          throw new Error(`Demo bookings have money that is not demo counter cash: ${[...new Set(blocked.map((p) => p.code))].join(', ')}. Resolve these first.`);
        }
        const pay = [...new Set(all.map((p) => p.id))];
        await c.query('UPDATE trip_seats SET booking_id = NULL WHERE booking_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM payment_allocations WHERE booking_id = ANY($1::uuid[])', [ids]);
        await c.query('UPDATE payments SET matched_booking_id = NULL WHERE matched_booking_id = ANY($1::uuid[])', [ids]);
        payments = (await c.query('DELETE FROM payments WHERE id = ANY($1::uuid[])', [pay])).rowCount ?? 0;
        await c.query('DELETE FROM refund_obligations WHERE booking_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM booking_previous_payment_accounts WHERE booking_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM booking_items WHERE booking_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM outbox_events WHERE aggregate_id = ANY($1::uuid[])', [[...ids, ...pay]]);
        await c.query('DELETE FROM bookings WHERE id = ANY($1::uuid[])', [ids]);
      }
      const trips = (await c.query(
        `DELETE FROM trips t WHERE t.operator_id = $1 AND t.idempotency_key LIKE $2
           AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = t.id)
           AND NOT EXISTS (SELECT 1 FROM booking_items i WHERE i.trip_id = t.id)
           AND NOT EXISTS (SELECT 1 FROM booking_imports bi WHERE bi.trip_id = t.id)`,
        [op.id, like],
      )).rowCount ?? 0;
      const vehicleCodes = DEMO_VEHICLE_SUFFIXES.map((s) => op.code + s);
      const vehicles = (await c.query(
        `DELETE FROM vehicles v WHERE v.operator_id = $1 AND v.code = ANY($2::text[]) AND v.name LIKE '%(demo)'
           AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = v.id)
           AND NOT EXISTS (SELECT 1 FROM trip_schedules s WHERE s.operator_id = v.operator_id
                             AND position(lower(v.id::text) IN lower(s.config::text)) > 0)`,
        [op.id, vehicleCodes],
      )).rowCount ?? 0;
      const routes = (await c.query(
        `DELETE FROM routes r WHERE r.operator_id = $1 AND r.code = ANY($2::text[])
           AND (r.origin = $3 OR r.destination = $3) AND position($4 IN coalesce(r.stops::text, '')) > 0
           AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.route_id = r.id)
           AND NOT EXISTS (SELECT 1 FROM trip_schedules s WHERE s.operator_id = r.operator_id
                             AND position(lower(r.id::text) IN lower(s.config::text)) > 0)`,
        [op.id, [...DEMO_ROUTE_CODES], DEMO_PLACE, DEMO_STOP_MARK],
      )).rowCount ?? 0;
      return { bookings: ids.length, payments, trips, vehicles, routes };
    });
  }
}
