import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { LIBRARY_LAYOUTS } from '../src/seat-layouts/library';
import { expectedArrival } from '../src/trips/trips.service';
import {
  AUTH_SECRET, BED_FARES, LIMO_FARES, RELAXED_ABUSE, Services, T0, TEST_DB_URL, TOKEN_SECRET,
  buildServices, errorCode, newKey, resetDatabase, seedOperatorWithTrips,
} from './helpers';

let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let other: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let app: INestApplication;
const http = () => request(app.getHttpServer());
const contact = { contactName: 'Nguyễn Văn Khách', contactPhone: '0912 345 678' };

/** Chuyến PN mặc định: xuất bến 17:30, tới 07:00 sáng hôm sau (giờ VN). */
const PN_DEPART = new Date('2027-02-05T10:30:00Z'); // 17:30 VN
const tripInput = (over: Record<string, unknown> = {}) => ({
  routeId: seed.route.id,
  vehicleId: seed.bed.id,
  name: 'TP.HCM → Hoài Ân 17:30',
  departAt: PN_DEPART,
  salesOpenAt: new Date('2027-01-01T00:00:00Z'),
  salesCloseAt: PN_DEPART,
  fares: BED_FARES,
  status: 'DRAFT' as const,
  ...over,
});

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  other = await seedOperatorWithTrips(s, 'AB');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, abuse: RELAXED_ABUSE, clock: s.clock })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
});
afterAll(async () => {
  await app.close();
  await s.db.close();
});
beforeEach(() => s.clock.set(T0));

describe('admin trip detail — fares and seat map of the trip itself', () => {
  it('returns the trip fares, the captured layout and every seat with its position', async () => {
    const d = await s.trips.adminDetail(seed.op.id, seed.limoTrip.id);
    expect(d.trip).toMatchObject({ id: seed.limoTrip.id, status: 'OPEN', departAt: '2027-02-01T11:00:00.000Z', onSale: true });
    expect(d.route).toMatchObject({ code: 'HCM-HA', origin: 'TP.HCM', destination: 'Hoài Ân' });
    expect(d.vehicle).toMatchObject({ id: seed.limo.id, layoutChangedSinceTrip: false });
    expect(d.layout).toMatchObject({ code: 'LIMO24', unit: 'phòng', kind: 'room' });
    expect(d.layout.floors.map((f) => f.label)).toEqual(['Tầng dưới', 'Tầng trên']);
    expect(d.fares).toEqual(
      LIMO_FARES.map((f) => ({ ...f, floorLabel: f.floor === '1' ? 'Tầng dưới' : 'Tầng trên' })),
    );
    expect(d.fares.every((f) => Number.isInteger(f.price))).toBe(true);
    expect(d.seats).toHaveLength(24);
    expect(d.seats.find((x) => x.code === 'A1')).toEqual({
      code: 'A1', floor: '1', row: 1, col: 0, maxOccupancy: 2, sellable: true, status: 'AVAILABLE', bookingCode: null, holdExpiresAt: null,
    });
    expect(d.summary).toEqual({ capacity: 24, available: 24, held: 0, booked: 0, blocked: 0 });
    // Trip fares never leak from another trip of the same operator.
    const bed = await s.trips.adminDetail(seed.op.id, seed.bedTrip.id);
    expect(bed.fares.map((f) => f.price)).toEqual(BED_FARES.map((f) => f.price));
    expect(bed.seats).toHaveLength(40);
  });

  it('reads DRAFT trips, which the public seat map hides', async () => {
    const draft = await s.trips.createTrip(seed.op.id, tripInput());
    expect(draft.status).toBe('DRAFT');
    expect(await errorCode(s.trips.seatMap(draft.id))).toBe('NOT_FOUND');
    const d = await s.trips.adminDetail(seed.op.id, draft.id);
    expect(d.trip).toMatchObject({ status: 'DRAFT', onSale: false, departAt: PN_DEPART.toISOString() });
    expect(d.fares.map((f) => f.price)).toEqual([380_000, 350_000]);
  });

  it('distinguishes held, booked and expired holds without exposing customer contact data', async () => {
    const hold = await s.bookings.createHold({ tripId: seed.limoTrip.id, ...contact, items: [{ seatCode: 'A3', occupancy: 1 }] }, newKey());
    const booked = await s.bookings.createHold({ tripId: seed.limoTrip.id, ...contact, items: [{ seatCode: 'B2', occupancy: 2 }] }, newKey());
    await s.db.query(`UPDATE bookings SET status = 'CONFIRMED', hold_expires_at = NULL WHERE code = $1`, [booked.booking.code]);

    const d = await s.trips.adminDetail(seed.op.id, seed.limoTrip.id);
    const a3 = d.seats.find((x) => x.code === 'A3')!;
    expect(a3).toMatchObject({ status: 'HELD', bookingCode: hold.booking.code });
    expect(a3.holdExpiresAt).toBe(hold.booking.holdExpiresAt);
    expect(d.seats.find((x) => x.code === 'B2')).toMatchObject({ status: 'BOOKED', bookingCode: booked.booking.code, holdExpiresAt: null });
    expect(d.summary).toMatchObject({ capacity: 24, available: 22, held: 1, booked: 1 });
    const json = JSON.stringify(d);
    expect(json).not.toContain('Nguyễn Văn Khách');
    expect(json).not.toMatch(/0912\s?345\s?678|84912345678/);

    // Hold past deadline + 3-minute grace but not yet swept by the background job → available, no booking code.
    s.clock.advanceMinutes(13);
    const later = await s.trips.adminDetail(seed.op.id, seed.limoTrip.id);
    expect(later.seats.find((x) => x.code === 'A3')).toMatchObject({ status: 'AVAILABLE', bookingCode: null, holdExpiresAt: null });
    expect(later.summary).toMatchObject({ available: 23, held: 0, booked: 1 });
  });

  it('keeps the captured layout version after the vehicle switches to another layout', async () => {
    const trip = await s.trips.createTrip(seed.op.id, tripInput({ name: 'Trước khi đổi sơ đồ' }));
    const lib = LIBRARY_LAYOUTS.find((l) => l.code === 'BED40')!;
    const smaller = await s.layouts.create(seed.op.id, {
      code: 'PN_BED36', name: 'Giường 36 (bỏ dãy D)', unit: 'giường', kind: 'bed',
      definition: {
        ...lib.definition,
        seatOverrides: Object.fromEntries(['D1', 'D2', 'D3', 'D4'].map((c) => [c, { sellable: false }])),
      },
    });
    await s.vehicles.update(seed.op.id, seed.bed.id, { seatLayoutId: smaller.id });
    try {
      const d = await s.trips.adminDetail(seed.op.id, trip.id);
      expect(d.layout).toMatchObject({ code: 'BED40' });
      expect(d.vehicle.layoutChangedSinceTrip).toBe(true);
      expect(d.summary).toMatchObject({ capacity: 40, blocked: 0, available: 40 });

      const after = await s.trips.createTrip(seed.op.id, tripInput({ name: 'Sau khi đổi sơ đồ' }));
      const d2 = await s.trips.adminDetail(seed.op.id, after.id);
      expect(d2.layout).toMatchObject({ code: 'PN_BED36', version: 1 });
      expect(d2.vehicle.layoutChangedSinceTrip).toBe(false);
      expect(d2.summary).toMatchObject({ capacity: 40, blocked: 4, available: 36 });
      expect(d2.seats.find((x) => x.code === 'D1')).toMatchObject({ sellable: false, status: 'BLOCKED' });
    } finally {
      const original = await s.layouts.latest(null, 'BED40');
      await s.vehicles.update(seed.op.id, seed.bed.id, { seatLayoutId: original!.id });
    }
  });

  it('never reads another operator’s trip and rejects malformed ids', async () => {
    expect(await errorCode(s.trips.adminDetail(seed.op.id, other.limoTrip.id))).toBe('NOT_FOUND');
    expect(await errorCode(s.trips.adminDetail(other.op.id, seed.limoTrip.id))).toBe('NOT_FOUND');
    expect(await errorCode(s.trips.adminDetail(seed.op.id, 'not-a-uuid'))).toBe('NOT_FOUND');
    expect(await errorCode(s.trips.adminDetail('nope', seed.limoTrip.id))).toBe('NOT_FOUND');
    expect(await errorCode(s.trips.adminDetail(seed.op.id, '00000000-0000-4000-8000-000000000000'))).toBe('NOT_FOUND');
  });
});

describe('expected arrival', () => {
  it('uses the last drop-off stop of the route (day offset from the departure date, VN time)', async () => {
    expect(expectedArrival(PN_DEPART, { dropoff: [] })).toBeNull();
    expect(expectedArrival(PN_DEPART, null)).toBeNull();
    // 17:30 on 05/02 → 07:00 on 06/02 (VN) = 00:00Z on 06/02.
    expect(expectedArrival(PN_DEPART, { dropoff: [{ time: '05:30', day: 1 }, { time: '07:00', day: 1 }] })).toBe('2027-02-06T00:00:00.000Z');
    // A departure just after VN midnight keeps its own VN date.
    expect(expectedArrival(new Date('2027-02-05T17:30:00Z'), { dropoff: [{ time: '07:00', day: 0 }] })).toBe('2027-02-06T00:00:00.000Z');
  });

  it('is returned by the detail API once the route has drop-off stops', async () => {
    await s.trips.saveStops(seed.op.id, seed.route.id, {
      pickup: [{ name: 'Bến xe Miền Đông', time: '17:30', day: 0 }],
      dropoff: [{ name: 'Hoài Ân', time: '07:00', day: 1 }],
    });
    const trip = await s.trips.createTrip(seed.op.id, tripInput({ name: 'Có điểm trả' }));
    const d = await s.trips.adminDetail(seed.op.id, trip.id);
    expect(d.trip.arriveAt).toBe('2027-02-06T00:00:00.000Z');
  });
});

describe('createTrip idempotency', () => {
  const countTrips = async (name: string) =>
    Number((await s.db.query('SELECT COUNT(*) AS n FROM trips WHERE operator_id = $1 AND name = $2', [seed.op.id, name])).rows[0]!.n);

  it('returns the same trip for a retried request with the same key', async () => {
    const key = newKey();
    const first = await s.trips.createTrip(seed.op.id, tripInput({ name: 'Idem 1' }), key);
    const again = await s.trips.createTrip(seed.op.id, tripInput({ name: 'Idem 1' }), key);
    expect(first.replayed).toBe(false);
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect(again).not.toHaveProperty('idempotency_key');
    expect(again).not.toHaveProperty('request_hash');
    expect(await countTrips('Idem 1')).toBe(1);
  });

  it('treats reordered fares and another spelling of the same phone as the same request', async () => {
    const key = newKey();
    const first = await s.trips.createTrip(seed.op.id, tripInput({ name: 'Idem 5', contactPhone: '0901234567' }), key);
    const again = await s.trips.createTrip(
      seed.op.id,
      tripInput({ name: 'Idem 5', contactPhone: '+84 901 234 567', fares: [...BED_FARES].reverse() }),
      key,
    );
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect(await countTrips('Idem 5')).toBe(1);
  });

  it('rejects reusing a key for a different trip', async () => {
    const key = newKey();
    await s.trips.createTrip(seed.op.id, tripInput({ name: 'Idem 2' }), key);
    expect(await errorCode(s.trips.createTrip(seed.op.id, tripInput({ name: 'Idem 2b' }), key))).toBe('IDEMPOTENCY_CONFLICT');
    expect(await countTrips('Idem 2b')).toBe(0);
  });

  it('creates only one trip for parallel requests with the same key', async () => {
    const key = newKey();
    const results = await Promise.all(Array.from({ length: 5 }, () => s.trips.createTrip(seed.op.id, tripInput({ name: 'Idem 3' }), key)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await countTrips('Idem 3')).toBe(1);
  });

  it('scopes keys per operator and validates the key format', async () => {
    const key = newKey();
    await s.trips.createTrip(seed.op.id, tripInput({ name: 'Idem 4' }), key);
    const ab = await s.trips.createTrip(other.op.id, {
      ...tripInput({ name: 'Idem 4' }), routeId: other.route.id, vehicleId: other.bed.id,
    }, key);
    expect(ab.replayed).toBe(false);
    expect(await errorCode(s.trips.createTrip(seed.op.id, tripInput(), 'short'))).toBe('VALIDATION_FAILED');
    expect(await errorCode(s.trips.createTrip(seed.op.id, tripInput(), 'bad key with spaces'))).toBe('VALIDATION_FAILED');
  });

  it('still works without a key (existing clients)', async () => {
    await s.trips.createTrip(seed.op.id, tripInput({ name: 'No key' }));
    await s.trips.createTrip(seed.op.id, tripInput({ name: 'No key' }));
    expect(await countTrips('No key')).toBe(2);
  });
});

describe('HTTP: GET /admin/operators/:operatorId/trips/:tripId', () => {
  let sellerToken: string;
  let assistantToken: string;
  let abSellerToken: string;
  let dispatcherToken: string;

  async function staffToken(operatorId: string, role: string, phone: string) {
    const password = `${role.toLowerCase()}-password-1`;
    await new UsersService(s.db, s.clock).createStaff(operatorId, { fullName: role, phone, password, role: role as never });
    const res = await http().post('/api/v1/auth/login').send({ phone, password }).expect(200);
    expect(res.body.scope).toBe('full');
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    sellerToken = await staffToken(seed.op.id, 'SELLER', '0902000001');
    assistantToken = await staffToken(seed.op.id, 'ASSISTANT', '0902000002');
    dispatcherToken = await staffToken(seed.op.id, 'DISPATCHER', '0902000003');
    abSellerToken = await staffToken(other.op.id, 'SELLER', '0902000004');
  });

  const path = (op: string, trip: string) => `/api/v1/admin/operators/${op}/trips/${trip}`;

  it('returns the detail to staff with trip.read', async () => {
    const res = await http().get(path(seed.op.id, seed.limoTrip.id)).auth(sellerToken, { type: 'bearer' }).expect(200);
    expect(res.body.trip.id).toBe(seed.limoTrip.id);
    expect(res.body.fares).toHaveLength(4);
    expect(res.body.seats).toHaveLength(24);
  });

  it('rejects missing auth, roles without trip.read and other operators', async () => {
    await http().get(path(seed.op.id, seed.limoTrip.id)).expect(401);
    await http().get(path(seed.op.id, seed.limoTrip.id)).auth(assistantToken, { type: 'bearer' }).expect(403);
    await http().get(path(seed.op.id, seed.limoTrip.id)).auth(abSellerToken, { type: 'bearer' }).expect(404);
    // Own operator path, other operator's trip id → 404.
    await http().get(path(other.op.id, seed.limoTrip.id)).auth(abSellerToken, { type: 'bearer' }).expect(404);
    await http().get(path(seed.op.id, 'not-a-uuid')).auth(sellerToken, { type: 'bearer' }).expect(404);
  });

  it('POST trips honours Idempotency-Key and logs the creation once', async () => {
    const key = newKey();
    const body = { ...tripInput({ name: 'HTTP idem' }), departAt: PN_DEPART.toISOString(), salesOpenAt: '2027-01-01T00:00:00Z', salesCloseAt: PN_DEPART.toISOString() };
    const a = await http().post(`/api/v1/admin/operators/${seed.op.id}/trips`).auth(dispatcherToken, { type: 'bearer' }).set('Idempotency-Key', key).send(body).expect(201);
    const b = await http().post(`/api/v1/admin/operators/${seed.op.id}/trips`).auth(dispatcherToken, { type: 'bearer' }).set('Idempotency-Key', key).send(body).expect(201);
    expect(b.body).toMatchObject({ id: a.body.id, replayed: true });
    const c = await http().post(`/api/v1/admin/operators/${seed.op.id}/trips`).auth(dispatcherToken, { type: 'bearer' }).set('Idempotency-Key', key).send({ ...body, name: 'Khác' }).expect(409);
    expect(c.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const logs = await s.db.query(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'trip.create' AND entity_id = $1`, [a.body.id]);
    expect(Number(logs.rows[0]!.n)).toBe(1);
  });
});

describe('HTTP: GET /admin/operators/:operatorId/seat-layouts/:layoutId (exact version a vehicle uses)', () => {
  let token: string;
  beforeAll(async () => {
    await new UsersService(s.db, s.clock).createStaff(seed.op.id, { fullName: 'Điều hành 2', phone: '0902000009', password: 'dispatcher2-password-1', role: 'DISPATCHER' });
    token = (await http().post('/api/v1/auth/login').send({ phone: '0902000009', password: 'dispatcher2-password-1' }).expect(200)).body.accessToken;
  });

  it('returns an older library version that is no longer the latest, plus own layouts', async () => {
    const v1 = await s.layouts.latest(null, 'BED40');
    // Library definition changes → a new version; vehicles keep pointing at the old one.
    await s.layouts.create(null, { ...LIBRARY_LAYOUTS.find((l) => l.code === 'BED40')!, name: 'Giường nằm 40 chỗ (v2)' });
    const list = await http().get(`/api/v1/admin/operators/${seed.op.id}/seat-layouts`).auth(token, { type: 'bearer' }).expect(200);
    expect(list.body.layouts.some((l: { id: string }) => l.id === v1!.id)).toBe(false);
    const one = await http().get(`/api/v1/admin/operators/${seed.op.id}/seat-layouts/${v1!.id}`).auth(token, { type: 'bearer' }).expect(200);
    expect(one.body.layout).toMatchObject({ id: v1!.id, code: 'BED40', version: v1!.version, shared: true });
    expect(one.body.layout.definition.floors).toHaveLength(2);
  });

  it("does not return another operator's own layout", async () => {
    const abLayout = await s.layouts.create(other.op.id, { ...LIBRARY_LAYOUTS[0]!, code: 'AB_BED' });
    await http().get(`/api/v1/admin/operators/${seed.op.id}/seat-layouts/${abLayout.id}`).auth(token, { type: 'bearer' }).expect(404);
    await http().get(`/api/v1/admin/operators/${other.op.id}/seat-layouts/${abLayout.id}`).auth(token, { type: 'bearer' }).expect(404);
    await http().get(`/api/v1/admin/operators/${seed.op.id}/seat-layouts/not-a-uuid`).auth(token, { type: 'bearer' }).expect(404);
  });
});

describe('admin range pagination', () => {
  it('pages tied departure times without duplicates and scopes the operator', async () => {
    const departAt = new Date('2027-04-05T10:30:00Z');
    for (let i = 0; i < 3; i++) await s.trips.createTrip(seed.op.id, tripInput({name: `Range ${i}`, departAt, salesCloseAt:departAt}), newKey());
    const query = {from:'2027-04-05',to:'2027-04-06',limit:2};
    const first = await s.trips.listAdminRange(seed.op.id, query);
    expect(first.trips).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await s.trips.listAdminRange(seed.op.id, {...query, cursor:first.nextCursor});
    expect(second.trips.length).toBeGreaterThan(0);
    const ids = [...first.trips,...second.trips].map(t=>t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect((await s.trips.listAdminRange(other.op.id, query)).trips).toHaveLength(0);
    expect(first.trips[0]).toMatchObject({available:40,capacity:40});
  });
  it('uses an exclusive end date at the Vietnam midnight boundary', async () => {
    await s.trips.createTrip(seed.op.id, tripInput({departAt: new Date('2027-03-01T17:00:00Z'), salesCloseAt:new Date('2027-03-01T17:00:00Z')}), newKey());
    const before = await s.trips.listAdminRange(seed.op.id, {from:'2027-03-01',to:'2027-03-02'});
    const after = await s.trips.listAdminRange(seed.op.id, {from:'2027-03-02',to:'2027-03-03'});
    expect(before.trips).toHaveLength(0);
    expect(after.trips).toHaveLength(1);
  });
});

it('does not repeat a row with a microsecond departure cursor', async () => {
  const departAt=new Date('2027-05-05T10:30:00Z');
  const a=await s.trips.createTrip(seed.op.id,tripInput({name:'micro 1',departAt,salesCloseAt:departAt}),newKey());
  const b=await s.trips.createTrip(seed.op.id,tripInput({name:'micro 2',departAt,salesCloseAt:departAt}),newKey());
  await s.db.query("UPDATE trips SET depart_at=depart_at+interval '123456 microseconds' WHERE id=$1",[a.id]);
  await s.db.query("UPDATE trips SET depart_at=depart_at+interval '123457 microseconds' WHERE id=$1",[b.id]);
  const range={from:'2027-05-05',to:'2027-05-06',limit:1};
  const first=await s.trips.listAdminRange(seed.op.id,range);
  const second=await s.trips.listAdminRange(seed.op.id,{...range,cursor:first.nextCursor});
  expect(first.trips[0]?.id).toBe(a.id);
  expect(second.trips[0]?.id).toBe(b.id);
});
