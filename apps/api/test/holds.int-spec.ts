import { LIMO_FARES, buildServices, errorCode, newKey, resetDatabase, seedOperatorWithTrips, Services, T0 } from './helpers';

let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;

const contact = { contactName: 'Nguyễn Văn A', contactPhone: '0912 345 678' };

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
});
afterAll(() => s.db.close());
beforeEach(() => s.clock.set(T0));

async function seatStatus(tripId: string, code: string) {
  const map = await s.trips.seatMap(tripId);
  return map.seats.find((x) => x.code === code)!.status;
}

describe('createHold — happy path', () => {
  it('holds a double room and a single room with prices, policy snapshot and normalized phone', async () => {
    const r = await s.bookings.createHold(
      {
        tripId: seed.limoTrip.id,
        ...contact,
        items: [
          { seatCode: 'A2', occupancy: 2, infantCount: 1 },
          { seatCode: 'B1', occupancy: 1 },
        ],
      },
      newKey(),
    );
    expect(r.replayed).toBe(false);
    expect(r.booking.code).toMatch(/^PN[A-HJ-KM-NP-Z2-9]{6}$/);
    expect(r.booking.status).toBe('HOLDING');
    expect(r.booking.holdExpiresAt).toBe(new Date(T0.getTime() + 10 * 60_000).toISOString());
    expect(r.booking.items).toEqual([
      { seatCode: 'A2', occupancy: 2, infantCount: 1, unitPrice: 700_000, infantPrice: 0, lineTotal: 700_000 },
      { seatCode: 'B1', occupancy: 1, infantCount: 0, unitPrice: 420_000, infantPrice: 0, lineTotal: 420_000 },
    ]);
    expect(r.booking.totalAmount).toBe(1_120_000);

    const { rows } = await s.db.query<{ contact_phone: string; policy_snapshot: { version: number; holdMinutes: number } }>(
      'SELECT contact_phone, policy_snapshot FROM bookings WHERE code = $1',
      [r.booking.code],
    );
    expect(rows[0]!.contact_phone).toBe('+84912345678');
    expect(rows[0]!.policy_snapshot).toMatchObject({ version: 2, holdMinutes: 10, maxActiveHoldsPerPhone: 20 });
    expect(await seatStatus(seed.limoTrip.id, 'A2')).toBe('HELD');
  });

  it('lets the holder read the booking with the access token only', async () => {
    const r = await s.bookings.createHold({ tripId: seed.limoTrip.id, ...contact, items: [{ seatCode: 'A3' }] }, newKey());
    await expect(s.bookings.getByCode(r.booking.code, r.accessToken)).resolves.toMatchObject({ code: r.booking.code });
    expect(await errorCode(s.bookings.getByCode(r.booking.code, 'wrong-token'))).toBe('NOT_FOUND');
    expect(await errorCode(s.bookings.getByCode('PNZZZZZZ', r.accessToken))).toBe('NOT_FOUND');
  });

  it('keeps the price snapshot when the operator policy changes later', async () => {
    const r = await s.bookings.createHold({ tripId: seed.limoTrip.id, ...contact, items: [{ seatCode: 'A4' }] }, newKey());
    await s.operators.updatePolicy(seed.op.id, {
      holdMinutes: 5,
      maxUnitsPerBooking: 5,
      childPolicy: { freeUnderAge: 2, price: 99_000, maxPerUnit: 1, countsTowardCapacity: false }, maxActiveHoldsPerPhone: 20,
    });
    const view = await s.bookings.getByCode(r.booking.code, r.accessToken);
    expect(view.totalAmount).toBe(450_000);
    const { rows } = await s.db.query<{ policy_snapshot: { version: number } }>(
      'SELECT policy_snapshot FROM bookings WHERE code = $1',
      [r.booking.code],
    );
    expect(rows[0]!.policy_snapshot.version).toBe(2);
    // Đơn mới dùng chính sách mới: giữ 5 phút, trẻ em tính 99.000đ.
    const r2 = await s.bookings.createHold(
      { tripId: seed.limoTrip.id, ...contact, items: [{ seatCode: 'A5', infantCount: 1 }] },
      newKey(),
    );
    expect(r2.booking.totalAmount).toBe(450_000 + 99_000);
    expect(r2.booking.holdExpiresAt).toBe(new Date(T0.getTime() + 5 * 60_000).toISOString());
    await s.operators.updatePolicy(seed.op.id, {
      holdMinutes: 10,
      maxUnitsPerBooking: 5,
      childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false }, maxActiveHoldsPerPhone: 20,
    });
  });
});

describe('createHold — 40-bed sleeper numbered by row (Images/40-GIUONG.webp)', () => {
  it('prices D1 (lower floor) and D10 (upper floor) by the floor they are drawn on, not by their letter', async () => {
    const r = await s.bookings.createHold(
      { tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'D1' }, { seatCode: 'D10' }] },
      newKey(),
    );
    expect(r.booking.items.map((i) => [i.seatCode, i.unitPrice])).toEqual([
      ['D1', 380_000],
      ['D10', 350_000],
    ]);
    const map = await s.trips.seatMap(seed.bedTrip.id);
    expect(map.seats.find((x) => x.code === 'D1')).toMatchObject({ floor: '1', status: 'HELD' });
    expect(map.layout.floors[0]!.rows[0]).toBe('TX . _ . CUA');
    // Thứ tự tự nhiên theo tầng rồi dãy rồi số: A1, A3, …, A9, B1 … (không phải A1, A10, A3).
    const lower = map.seats.filter((x) => x.floor === '1').map((x) => x.code);
    expect(lower.slice(0, 6)).toEqual(['A1', 'A3', 'A5', 'A7', 'A9', 'B1']);
    const upperA = map.seats.filter((x) => x.floor === '2' && x.code.startsWith('A')).map((x) => x.code);
    expect(upperA).toEqual(['A2', 'A4', 'A6', 'A8', 'A10']);
  });
});

describe('createHold — no double selling', () => {
  it('AC-01: of 50 concurrent requests for the same room exactly one wins', async () => {
    const attempts = Array.from({ length: 50 }, () =>
      s.bookings.createHold({ tripId: seed.limoTrip.id, ...contact, items: [{ seatCode: 'A6' }] }, newKey()).then(
        () => 'OK',
        (e) => e.code ?? String(e),
      ),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect(results.filter((r) => r === 'SEAT_UNAVAILABLE')).toHaveLength(49);
    const { rows } = await s.db.query(
      `SELECT COUNT(*)::int AS n FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
       WHERE bi.trip_id = $1 AND bi.seat_code = 'A6' AND b.status = 'HOLDING'`,
      [seed.limoTrip.id],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('AC-02: a multi-seat request with one taken seat holds nothing', async () => {
    const code = await errorCode(
      s.bookings.createHold(
        { tripId: seed.limoTrip.id, ...contact, items: [{ seatCode: 'A7' }, { seatCode: 'A6' }, { seatCode: 'A8' }] },
        newKey(),
      ),
    );
    expect(code).toBe('SEAT_UNAVAILABLE');
    expect(await seatStatus(seed.limoTrip.id, 'A7')).toBe('AVAILABLE');
    expect(await seatStatus(seed.limoTrip.id, 'A8')).toBe('AVAILABLE');
  });

  it('AC-02: overlapping multi-seat requests in parallel never share a seat', async () => {
    const reqs = [
      ['A9', 'A10'],
      ['A10', 'A11'],
      ['A11', 'A12'],
      ['A12', 'A9'],
    ].map((codes) =>
      s.bookings
        .createHold({ tripId: seed.limoTrip.id, ...contact, items: codes.map((seatCode) => ({ seatCode })) }, newKey())
        .then(
          () => 'OK',
          (e) => e.code,
        ),
    );
    const results = await Promise.all(reqs);
    expect(results.filter((r) => r === 'OK').length).toBeGreaterThanOrEqual(1);
    const { rows } = await s.db.query(
      `SELECT seat_code, COUNT(*)::int AS n FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
       WHERE bi.trip_id = $1 AND b.status = 'HOLDING' AND bi.seat_code = ANY($2::text[]) GROUP BY seat_code`,
      [seed.limoTrip.id, ['A9', 'A10', 'A11', 'A12']],
    );
    for (const r of rows) expect(r.n).toBe(1);
  });

  it('refuses a blocked (not sellable) seat', async () => {
    await s.db.query("UPDATE trip_seats SET sellable = false WHERE trip_id = $1 AND seat_code = 'B12'", [seed.limoTrip.id]);
    expect(
      await errorCode(s.bookings.createHold({ tripId: seed.limoTrip.id, ...contact, items: [{ seatCode: 'B12' }] }, newKey())),
    ).toBe('SEAT_UNAVAILABLE');
    expect(await seatStatus(seed.limoTrip.id, 'B12')).toBe('BLOCKED');
  });
});

describe('createHold — hold expiry', () => {
  it('AC-03: an expired hold frees the seat for the next buyer and is marked EXPIRED', async () => {
    const first = await s.bookings.createHold({ tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'A1' }] }, newKey());
    s.clock.advanceMinutes(9);
    expect(
      await errorCode(s.bookings.createHold({ tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'A1' }] }, newKey())),
    ).toBe('SEAT_UNAVAILABLE');
    s.clock.advanceMinutes(1); // đúng 10 phút: hết hạn
    expect(await seatStatus(seed.bedTrip.id, 'A1')).toBe('AVAILABLE');
    const second = await s.bookings.createHold({ tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'A1' }] }, newKey());
    expect(second.booking.code).not.toBe(first.booking.code);
    const { rows } = await s.db.query<{ status: string }>('SELECT status FROM bookings WHERE code = $1', [first.booking.code]);
    expect(rows[0]!.status).toBe('EXPIRED');
    expect((await s.bookings.getByCode(first.booking.code, first.accessToken)).status).toBe('EXPIRED');
  });

  it('shows a stale hold as EXPIRED before any background job runs', async () => {
    const r = await s.bookings.createHold({ tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'A2' }] }, newKey());
    s.clock.advanceMinutes(11);
    expect((await s.bookings.getByCode(r.booking.code, r.accessToken)).status).toBe('EXPIRED');
    expect(await seatStatus(seed.bedTrip.id, 'A2')).toBe('AVAILABLE');
  });

  it('expireDueHolds releases every overdue hold and keeps the booking history', async () => {
    const r = await s.bookings.createHold(
      { tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'A3' }, { seatCode: 'A4' }] },
      newKey(),
    );
    s.clock.advanceMinutes(30);
    expect(await s.bookings.expireDueHolds()).toBeGreaterThanOrEqual(1);
    const { rows } = await s.db.query(
      `SELECT COUNT(*)::int AS n FROM trip_seats ts JOIN bookings b ON b.id = ts.booking_id WHERE b.code = $1`,
      [r.booking.code],
    );
    expect(rows[0]!.n).toBe(0);
    const { rows: items } = await s.db.query(
      'SELECT COUNT(*)::int AS n FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id WHERE b.code = $1',
      [r.booking.code],
    );
    expect(items[0]!.n).toBe(2);
    expect(await s.bookings.expireDueHolds()).toBe(0);
  });
});

describe('createHold — idempotency', () => {
  it('returns the same booking and token when the same request is retried', async () => {
    const key = newKey();
    const input = { tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'B1' }] };
    const a = await s.bookings.createHold(input, key);
    const b = await s.bookings.createHold({ ...input, contactPhone: '+84 912 345 678' }, key);
    expect(b.replayed).toBe(true);
    expect(b.booking.code).toBe(a.booking.code);
    expect(b.accessToken).toBe(a.accessToken);
  });

  it('returns one booking when the same key is sent concurrently', async () => {
    const key = newKey();
    const input = { tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'B2' }] };
    const results = await Promise.all(Array.from({ length: 5 }, () => s.bookings.createHold(input, key)));
    expect(new Set(results.map((r) => r.booking.code)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
  });

  it('rejects the same key with a different request', async () => {
    const key = newKey();
    await s.bookings.createHold({ tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'B3' }] }, key);
    expect(
      await errorCode(s.bookings.createHold({ tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'B4' }] }, key)),
    ).toBe('IDEMPOTENCY_CONFLICT');
    expect(await seatStatus(seed.bedTrip.id, 'B4')).toBe('AVAILABLE');
  });

  it('rejects the same key reused on another trip of the same operator', async () => {
    const key = newKey();
    await s.bookings.createHold({ tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'B5' }] }, key);
    expect(
      await errorCode(s.bookings.createHold({ tripId: seed.limoTrip.id, ...contact, items: [{ seatCode: 'B5' }] }, key)),
    ).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('rejects a malformed idempotency key', async () => {
    expect(
      await errorCode(s.bookings.createHold({ tripId: seed.bedTrip.id, ...contact, items: [{ seatCode: 'B6' }] }, 'short')),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('createHold — validation and sale window', () => {
  const hold = (items: { seatCode: string; occupancy?: number; infantCount?: number }[], tripId = seed.limoTrip.id) =>
    s.bookings.createHold({ tripId, ...contact, items }, newKey());

  it.each([
    ['two people on a sleeper bed', [{ seatCode: 'B7', occupancy: 2 }], 'bed'],
    ['two infants on one room', [{ seatCode: 'B7', infantCount: 2 }], 'limo'],
    ['a seat the trip does not have', [{ seatCode: 'C1' }], 'limo'],
    ['the same seat twice', [{ seatCode: 'B7' }, { seatCode: 'B7' }], 'limo'],
  ] as const)('rejects %s with VALIDATION_FAILED and holds nothing', async (_n, items, which) => {
    const trip = which === 'bed' ? seed.bedTrip.id : seed.limoTrip.id;
    expect(await errorCode(hold([...items], trip))).toBe('VALIDATION_FAILED');
    expect(await seatStatus(trip, 'B7')).toBe('AVAILABLE');
  });

  it('rejects more units than the policy allows with LIMIT_EXCEEDED', async () => {
    const items = ['B7', 'B8', 'B9', 'B10', 'B11', 'B12'].map((seatCode) => ({ seatCode }));
    expect(await errorCode(hold(items, seed.bedTrip.id))).toBe('LIMIT_EXCEEDED');
  });

  it('rejects an invalid phone number', async () => {
    expect(
      await errorCode(
        s.bookings.createHold({ tripId: seed.limoTrip.id, contactName: 'A', contactPhone: '12345', items: [{ seatCode: 'B7' }] }, newKey()),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('refuses holds before sales open, after sales close and on a cancelled trip', async () => {
    s.clock.set(new Date('2026-12-31T23:59:59Z'));
    expect(await errorCode(hold([{ seatCode: 'B7' }]))).toBe('TRIP_NOT_ON_SALE');
    s.clock.set(new Date('2027-02-01T10:00:00Z')); // đúng giờ đóng bán
    expect(await errorCode(hold([{ seatCode: 'B7' }]))).toBe('TRIP_NOT_ON_SALE');
    s.clock.set(T0);
    await s.db.query("UPDATE trips SET status = 'CANCELLED' WHERE id = $1", [seed.bedTrip.id]);
    expect(await errorCode(hold([{ seatCode: 'B7' }], seed.bedTrip.id))).toBe('TRIP_NOT_ON_SALE');
    await s.db.query("UPDATE trips SET status = 'OPEN' WHERE id = $1", [seed.bedTrip.id]);
  });

  it('returns NOT_FOUND for an unknown trip', async () => {
    expect(await errorCode(hold([{ seatCode: 'A1' }], '00000000-0000-4000-8000-000000000000'))).toBe('NOT_FOUND');
  });
});

it('holds both directions under one code or neither when a return seat is taken', async () => {
  const other = await seedOperatorWithTrips(s, 'RT');
  const route = await s.trips.createRoute(other.op.id, { code: 'HA-HCM', origin: 'Hoài Ân', destination: 'TP.HCM' });
  const inbound = await s.trips.createTrip(other.op.id, { routeId: route.id, vehicleId: other.limo.id,
    name: 'Lượt về', departAt: new Date('2027-02-03T11:00:00Z'), salesCloseAt: new Date('2027-02-03T10:00:00Z'),
    salesOpenAt: new Date('2027-01-01T00:00:00Z'), fares: LIMO_FARES });
  const request = { ...contact, tripId: other.limoTrip.id, items: [{seatCode: 'A2'}],
    returnLeg: {tripId: inbound.id, items: [{seatCode: 'A2'}]} };
  const key = newKey();
  const result = await s.bookings.createHold(request, key);
  expect(result.booking.totalAmount).toBe(900000);
  expect(new Set(result.booking.items.map(i => i.tripId))).toEqual(new Set([request.tripId, inbound.id]));
  expect((await s.bookings.createHold(request, key)).booking.code).toBe(result.booking.code);
  expect(await errorCode(s.bookings.createHold({...request, items: [{seatCode:'A3'}]},newKey()))).toBe('SEAT_UNAVAILABLE');
  expect(await seatStatus(request.tripId, 'A3')).toBe('AVAILABLE');
  s.clock.set(new Date(T0.getTime()+11*60_000));
  await s.bookings.createHold({...contact, tripId: inbound.id, items:[{seatCode:'A2'}]}, newKey());
  expect(await seatStatus(request.tripId, 'A2')).toBe('AVAILABLE');
});
