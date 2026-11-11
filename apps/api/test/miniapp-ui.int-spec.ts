import { buildServices, errorCode, newKey, newRetryToken, resetDatabase, seedOperatorWithTrips } from './helpers';

const services = buildServices();
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
beforeAll(async () => {
  await resetDatabase();
  seed = await seedOperatorWithTrips(services, 'PN');
  await seedOperatorWithTrips(services, 'AB');
});
afterAll(() => services.db.close());

it('stores a trimmed optional note, replays identical requests and rejects changed notes for the same key', async () => {
  const key = newKey();
  const request = { tripId: seed.limoTrip.id, contactName: 'Khách thử', contactPhone: '0912345678',
    note: '  Đăng ký hỗ trợ vé khám bệnh  ', items: [{ seatCode: 'A1' }] };
  const attempt = { retryToken: newRetryToken() };
  const hold = await services.bookings.createHold(request, key, attempt);
  const view = await services.bookings.getByCode(hold.booking.code, hold.accessToken);
  expect(view.note).toBe(request.note.trim());
  expect((await services.bookings.createHold({ ...request, note: request.note.trim() }, key, attempt)).replayed).toBe(true);
  expect(await errorCode(services.bookings.createHold({ ...request, note: 'Ghi chú khác' }, key, attempt))).toBe('IDEMPOTENCY_CONFLICT');
  await expect(services.bookings.createHold({ ...request, note: 'a'.repeat(501) }, newKey())).rejects.toThrow();
});

it('groups open trips in the operator, then excludes a route when all of its inventory is unavailable', async () => {
  const routes = await services.trips.discover('PN');
  expect(routes).toHaveLength(1);
  expect(routes[0]).toMatchObject({code: seed.route.code, tripCount: 2});
  await services.db.query('UPDATE trip_seats SET sellable = false WHERE booking_id IS NULL AND trip_id = ANY($1::uuid[])', [[seed.limoTrip.id, seed.bedTrip.id]]);
  expect(await services.trips.discover('PN')).toEqual([]);
  expect(await services.trips.discover('AB')).toHaveLength(1);
});

it('exposes the route schedule on its trips and prevents writes from a different operator', async () => {
  const stops = {pickup:[{name:'Bến đi',time:'18:30',day:0}],dropoff:[{name:'Bến đến',time:'07:30',day:1}]};
  await services.trips.saveStops(seed.op.id,seed.route.id,stops);
  expect((await services.trips.seatMap(seed.limoTrip.id)).stops).toEqual(stops);
  const other = (await services.db.query("SELECT id FROM operators WHERE code='AB'")).rows[0];
  expect(await errorCode(services.trips.saveStops(other!.id,seed.route.id,{pickup:[],dropoff:[]}))).toBe('NOT_FOUND');
});
