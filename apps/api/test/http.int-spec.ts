import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FixedClock } from '../src/common/clock';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { AUTH_SECRET, buildServices, resetDatabase, seedOperatorWithTrips, Services, T0, TEST_DB_URL, TOKEN_SECRET } from './helpers';

let app: INestApplication;
let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, clock: new FixedClock(T0) })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
});
afterAll(async () => {
  await app.close();
  await s.db.close();
});

const body = (items: object[], tripId = seed.limoTrip.id) => ({
  tripId,
  contactName: 'Trần Thị B',
  contactPhone: '0987654321',
  items,
});

describe('GET /api/v1/operators/:code/trips', () => {
  it('lists trips on sale for the day', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/operators/PN/trips?date=2027-02-01').expect(200);
    expect(res.body.trips).toHaveLength(2);
    expect(res.body.trips[0]).toMatchObject({
      name: 'TP.HCM → Hoài Ân 18:00',
      vehicle: { name: 'Xe 01', code: 'PN01', type: 'LIMOUSINE' },
      unit: 'phòng',
      availableUnits: 24,
    });
  });

  it('requires a date and rejects a malformed one', async () => {
    const a = await request(app.getHttpServer()).get('/api/v1/operators/PN/trips').expect(400);
    expect(a.body.error.code).toBe('VALIDATION_FAILED');
    await request(app.getHttpServer()).get('/api/v1/operators/PN/trips?date=01-02-2027').expect(400);
  });

  it('returns 404 for an unknown or malformed operator code', async () => {
    await request(app.getHttpServer()).get('/api/v1/operators/ZZ/trips?date=2027-02-01').expect(404);
    await request(app.getHttpServer()).get('/api/v1/operators/pn/trips?date=2027-02-01').expect(404);
  });
});

describe('GET /api/v1/trips/:id/seats', () => {
  it('returns layout, seat statuses and fares without any customer data', async () => {
    const held = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Idempotency-Key', 'http-seatmap-0001')
      .send(body([{ seatCode: 'A1' }]))
      .expect(201);
    const res = await request(app.getHttpServer()).get(`/api/v1/trips/${seed.limoTrip.id}/seats`).expect(200);
    expect(res.body.layout).toMatchObject({ unit: 'phòng', kind: 'room' });
    expect(res.body.layout.floors).toHaveLength(2);
    expect(res.body.seats).toHaveLength(24);
    expect(res.body.seats.find((x: { code: string }) => x.code === 'A1')).toEqual({
      code: 'A1', floor: '1', maxOccupancy: 2, status: 'HELD',
    });
    expect(res.body.fares).toHaveLength(4);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Trần Thị B');
    expect(text).not.toContain('987654321');
    expect(text).not.toContain(held.body.booking.code);
    expect(text).not.toContain(held.body.accessToken);
  });

  it('returns 404 for a malformed or unknown trip id', async () => {
    await request(app.getHttpServer()).get('/api/v1/trips/not-a-uuid/seats').expect(404);
    await request(app.getHttpServer()).get('/api/v1/trips/00000000-0000-4000-8000-000000000000/seats').expect(404);
  });
});

describe('POST /api/v1/bookings', () => {
  it('creates a hold (201) and lets the holder read it with the token header', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Idempotency-Key', 'http-create-0001')
      .send(body([{ seatCode: 'A2', occupancy: 2, infantCount: 1 }]))
      .expect(201);
    expect(res.body.booking).toMatchObject({ status: 'HOLDING', totalAmount: 700_000 });
    expect(res.body.accessToken).toEqual(expect.any(String));
    const view = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${res.body.booking.code}`)
      .set('X-Booking-Token', res.body.accessToken)
      .expect(200);
    expect(view.body.code).toBe(res.body.booking.code);
    await request(app.getHttpServer()).get(`/api/v1/bookings/${res.body.booking.code}`).expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${res.body.booking.code}`)
      .set('X-Booking-Token', 'nope')
      .expect(404);
  });

  it('answers 409 SEAT_UNAVAILABLE with the taken seats', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Idempotency-Key', 'http-taken-0001')
      .send(body([{ seatCode: 'A2' }, { seatCode: 'A3' }]))
      .expect(409);
    expect(res.body.error).toMatchObject({ code: 'SEAT_UNAVAILABLE', details: { seats: ['A2'] } });
    expect(res.body.error.message).toContain('A2');
  });

  it('requires the Idempotency-Key header', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/bookings').send(body([{ seatCode: 'A4' }])).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an invalid body with field-level details', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Idempotency-Key', 'http-invalid-0001')
      .send({ tripId: 'x', items: [] })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['tripId', 'contactName', 'items']),
    );
  });

  it('rejects unknown fields so clients cannot inject prices', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Idempotency-Key', 'http-inject-0001')
      .send({ ...body([{ seatCode: 'A5' }]), totalAmount: 1 })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 JSON for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nothing').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
