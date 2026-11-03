import 'reflect-metadata';
import { Pool } from 'pg';
import { ZodError } from 'zod';
import { BookingsService, TokenSecret } from '../src/bookings/bookings.service';
import { FixedClock } from '../src/common/clock';
import { DomainError } from '../src/common/errors';
import { Db, DbConfig } from '../src/db/db';
import { migrate } from '../src/db/migrate';
import { OperatorsService } from '../src/operators/operators.service';
import { SeatLayoutsService } from '../src/seat-layouts/seat-layouts.service';
import { TripsService } from '../src/trips/trips.service';
import { VehiclesService } from '../src/vehicles/vehicles.service';

export const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://pnticket:pnticket@localhost:5432/pnticket_test';
export const TOKEN_SECRET = 'test-secret-'.padEnd(40, 'x');

/** Xóa sạch schema `public` của DB test rồi chạy lại migration. Chỉ dùng cho DB test. */
export async function resetDatabase(): Promise<void> {
  if (!/_test(\?|$)/.test(TEST_DB_URL)) throw new Error(`Refusing to reset a non-test database: ${TEST_DB_URL}`);
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  } finally {
    await pool.end();
  }
}

export interface Services {
  db: Db;
  clock: FixedClock;
  layouts: SeatLayoutsService;
  operators: OperatorsService;
  vehicles: VehiclesService;
  trips: TripsService;
  bookings: BookingsService;
}

export const T0 = new Date('2027-01-20T03:00:00.000Z'); // 10:00 giờ VN

export function buildServices(clock = new FixedClock(T0)): Services {
  const db = new Db(new DbConfig(TEST_DB_URL, 30));
  const layouts = new SeatLayoutsService(db);
  const operators = new OperatorsService(db, layouts);
  const vehicles = new VehiclesService(db, layouts);
  const trips = new TripsService(db, operators, clock);
  const bookings = new BookingsService(db, operators, clock, new TokenSecret(TOKEN_SECRET));
  return { db, clock, layouts, operators, vehicles, trips, bookings };
}

export const LIMO_FARES = [
  { floor: 'A', occupancy: 1 as const, price: 450_000 },
  { floor: 'A', occupancy: 2 as const, price: 700_000 },
  { floor: 'B', occupancy: 1 as const, price: 420_000 },
  { floor: 'B', occupancy: 2 as const, price: 650_000 },
];
export const BED_FARES = [
  { floor: 'A', occupancy: 1 as const, price: 380_000 },
  { floor: 'B', occupancy: 1 as const, price: 350_000 },
];

/** Nhà xe + tuyến + 2 chuyến (Limousine 18:00 và giường nằm 19:30 ngày 01/02/2027 giờ VN), đang mở bán. */
export async function seedOperatorWithTrips(s: Services, code = 'PN') {
  const op = await s.operators.create({ code, name: `Nhà xe ${code}` });
  const [limo, bed] = await s.vehicles.list(op.id);
  const route = await s.trips.createRoute(op.id, { code: 'HCM-HA', origin: 'TP.HCM', destination: 'Hoài Ân' });
  const common = {
    routeId: route.id,
    salesOpenAt: new Date('2027-01-01T00:00:00Z'),
  };
  const limoTrip = await s.trips.createTrip(op.id, {
    ...common,
    vehicleId: limo!.id,
    name: 'TP.HCM → Hoài Ân 18:00',
    contactPhone: '0912 000 111',
    departAt: new Date('2027-02-01T11:00:00Z'),
    salesCloseAt: new Date('2027-02-01T10:00:00Z'),
    fares: LIMO_FARES,
  });
  const bedTrip = await s.trips.createTrip(op.id, {
    ...common,
    vehicleId: bed!.id,
    name: 'TP.HCM → Hoài Ân 19:30',
    departAt: new Date('2027-02-01T12:30:00Z'),
    salesCloseAt: new Date('2027-02-01T11:30:00Z'),
    fares: BED_FARES,
  });
  return { op, limo: limo!, bed: bed!, route, limoTrip, bedTrip };
}

export async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    if (e instanceof ZodError) return 'VALIDATION_FAILED';
    throw e;
  }
  return 'NO_ERROR';
}

let keySeq = 0;
export const newKey = () => `test-key-${Date.now()}-${++keySeq}`;
