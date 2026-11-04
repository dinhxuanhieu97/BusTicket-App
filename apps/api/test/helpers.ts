import 'reflect-metadata';
import { Pool } from 'pg';
import { ZodError } from 'zod';
import { AbuseConfig } from '../src/abuse/abuse-config';
import { PhoneVerificationService } from '../src/abuse/phone-verification.service';
import { RateLimiter } from '../src/abuse/rate-limiter';
import { CapturingSmsSender } from '../src/abuse/sms-sender';
import { BookingsService, TokenSecret } from '../src/bookings/bookings.service';
import { AuditService } from '../src/audit/audit.service';
import { SecretBox } from '../src/auth/totp';
import { PaymentsService } from '../src/payments/payments.service';
import { BankTransfer, SepayTransactionsClient } from '../src/payments/sepay';
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
export const AUTH_SECRET = 'auth-secret-'.padEnd(40, 'y');

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
  limiter: RateLimiter;
  phones: PhoneVerificationService;
  sms: CapturingSmsSender;
  payments: PaymentsService;
  sepay: FakeSepayClient;
}

/** Nguồn giao dịch giả cho đối soát (thay API SePay thật). */
export class FakeSepayClient extends SepayTransactionsClient {
  transfers: BankTransfer[] = [];
  calls: { token: string; account: string; since: Date }[] = [];

  async listIncoming(apiToken: string, accountNumber: string, since: Date): Promise<BankTransfer[]> {
    this.calls.push({ token: apiToken, account: accountNumber, since });
    return this.transfers.filter((t) => t.accountNumber === accountNumber && t.transactionAt >= since);
  }
}

/**
 * Ngưỡng rất cao cho các bộ test không nhằm kiểm tra chống lạm dụng (chúng dùng chung một SĐT/IP cho nhiều đơn).
 * Ngưỡng thật được kiểm tra trong `abuse.int-spec.ts`.
 */
export const RELAXED_ABUSE: Partial<AbuseConfig> = {
  bookingsPerIpPerMinute: 100_000,
  bookingsPerPhonePerHour: 100_000,
  loginsPerIpPer15Min: 100_000,
  otpPerIpPerHour: 100_000,
};

export const T0 = new Date('2027-01-20T03:00:00.000Z'); // 10:00 giờ VN

export function buildServices(clock = new FixedClock(T0), abuse: Partial<AbuseConfig> = RELAXED_ABUSE): Services {
  const db = new Db(new DbConfig(TEST_DB_URL, 30));
  const layouts = new SeatLayoutsService(db);
  const sms = new CapturingSmsSender();
  const operators = new OperatorsService(db, layouts, sms);
  const vehicles = new VehiclesService(db, layouts);
  const trips = new TripsService(db, operators, clock);
  const config = new AbuseConfig(abuse);
  const limiter = new RateLimiter(db, clock);
  const secret = new TokenSecret(TOKEN_SECRET);
  const phones = new PhoneVerificationService(db, clock, config, limiter, sms, secret);
  const bookings = new BookingsService(db, operators, clock, secret, limiter, config, phones);
  const sepay = new FakeSepayClient();
  const payments = new PaymentsService(db, clock, new AuditService(db), new SecretBox(AUTH_SECRET), secret, sepay);
  return { db, clock, layouts, operators, vehicles, trips, bookings, limiter, phones, sms, payments, sepay };
}

export const LIMO_FARES = [
  { floor: '1', occupancy: 1 as const, price: 450_000 },
  { floor: '1', occupancy: 2 as const, price: 700_000 },
  { floor: '2', occupancy: 1 as const, price: 420_000 },
  { floor: '2', occupancy: 2 as const, price: 650_000 },
];
export const BED_FARES = [
  { floor: '1', occupancy: 1 as const, price: 380_000 },
  { floor: '2', occupancy: 1 as const, price: 350_000 },
];

/** Nhà xe + tuyến + 2 chuyến (Limousine 18:00 và giường nằm 19:30 ngày 01/02/2027 giờ VN), đang mở bán. */
export async function seedOperatorWithTrips(s: Services, code = 'PN') {
  const op = await s.operators.create({ code, name: `Nhà xe ${code}` });
  // Các bộ test chung dùng một SĐT cho nhiều đơn: nới giới hạn đơn đang giữ (kiểm tra riêng ở abuse.int-spec.ts).
  await s.operators.updatePolicy(op.id, { holdMinutes: 10, maxUnitsPerBooking: 5, childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false }, maxActiveHoldsPerPhone: 20 });
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
