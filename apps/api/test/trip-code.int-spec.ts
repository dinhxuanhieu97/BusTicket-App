import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import {
  AUTH_SECRET, BED_FARES, LIMO_FARES, RELAXED_ABUSE, Services, T0, TEST_DB_URL, TOKEN_SECRET,
  buildServices, resetDatabase, seedOperatorWithTrips,
} from './helpers';

let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;

// 17:30 giờ VN ngày 20/03/2027 = 10:30 UTC cùng ngày.
const DEPART = new Date('2027-03-20T10:30:00Z');
const base = { routeId: '', name: 'Chuyến mã', salesOpenAt: new Date('2027-01-01T00:00:00Z'), salesCloseAt: DEPART, departAt: DEPART, status: 'OPEN' as const };

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, abuse: RELAXED_ABUSE, clock: s.clock })],
  }).compile();
  await moduleRef.init();
});
afterAll(async () => {
  await s.db.close();
});
beforeEach(() => s.clock.set(T0));

describe('trip code', () => {
  it('builds <operator><ddmmyy VN><route> and suffixes same-day trips on the same route', async () => {
    const first = await s.trips.createTrip(seed.op.id, { ...base, routeId: seed.route.id, vehicleId: seed.bed.id, fares: BED_FARES });
    const second = await s.trips.createTrip(seed.op.id, { ...base, routeId: seed.route.id, vehicleId: seed.limo.id, fares: LIMO_FARES });
    expect(first.code).toBe('PN200327-HCMHA');
    expect(second.code).toBe('PN200327-HCMHA-2');

    const detail = await s.trips.adminDetail(seed.op.id, first.id);
    expect(detail.trip.code).toBe('PN200327-HCMHA');
    const day = await s.trips.listForAdmin(seed.op.id, '2027-03-20');
    expect(day.map((t) => t.code).sort()).toEqual(['PN200327-HCMHA', 'PN200327-HCMHA-2']);
  });
});
