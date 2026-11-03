/**
 * Thư viện mẫu sơ đồ dùng chung phải tự lên phiên bản mới khi định nghĩa trong code đổi
 * (vd. DB tạo trước khi chuyển sang sơ đồ thật trong Images/: LIMO24 tầng A/B, mã A01…).
 */
import { buildServices, errorCode, LIMO_FARES, resetDatabase, Services } from './helpers';

let s: Services;

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  // Giả lập thư viện cũ đã có sẵn trong DB (định dạng cũ, chèn thẳng vì bộ đọc mới không còn chấp nhận).
  const old = { defaultMaxOccupancy: 2, floors: [{ code: 'A', label: 'Tầng dưới', rows: ['A01 . A02'] }, { code: 'B', label: 'Tầng trên', rows: ['B01 . B02'] }] };
  const { rows } = await s.db.query<{ id: string }>(
    `INSERT INTO seat_layouts (operator_id, code, version, name, unit, kind, definition, capacity)
     VALUES (NULL, 'LIMO24', 1, 'Limousine 24 phòng', 'phòng', 'room', $1, 4) RETURNING id`,
    [JSON.stringify(old)],
  );
  await s.db.query(
    `INSERT INTO seats (seat_layout_id, code, floor, row_idx, col_idx, max_occupancy) VALUES
       ($1,'A01','A',0,0,2), ($1,'A02','A',0,2,2), ($1,'B01','B',0,0,2), ($1,'B02','B',0,2,2)`,
    [rows[0]!.id],
  );
});
afterAll(() => s.db.close());

describe('shared layout library upgrade', () => {
  it('new operators get the current library definition, and trips with floors 1/2 can be created', async () => {
    const op = await s.operators.create({ code: 'UP', name: 'Nhà xe UP' });
    const [limo] = await s.vehicles.list(op.id);
    const { rows } = await s.db.query<{ version: number; capacity: number }>(
      'SELECT version, capacity FROM seat_layouts WHERE id = $1',
      [limo!.seat_layout_id],
    );
    expect(rows[0]).toEqual({ version: 2, capacity: 24 });
    const route = await s.trips.createRoute(op.id, { code: 'R1', origin: 'a', destination: 'b' });
    const trip = await s.trips.createTrip(op.id, {
      routeId: route.id, vehicleId: limo!.id, name: 'x', fares: LIMO_FARES,
      departAt: '2027-02-01T11:00:00Z', salesOpenAt: '2027-01-01T00:00:00Z', salesCloseAt: '2027-02-01T10:00:00Z',
    });
    expect(trip.seat_layout_id).toBe(limo!.seat_layout_id);
  });

  it('does not create another version when the definition has not changed', async () => {
    await s.layouts.ensureLibrary();
    await s.operators.create({ code: 'UQ', name: 'Nhà xe UQ' });
    const { rows } = await s.db.query("SELECT COUNT(*)::int AS n FROM seat_layouts WHERE operator_id IS NULL AND code = 'LIMO24'");
    expect(rows[0]!.n).toBe(2);
  });

  it('rejects seat codes with a leading zero so A01 and A1 cannot both exist', async () => {
    const op = await s.operators.getByCode('UP');
    expect(
      await errorCode(
        s.layouts.create(op.id, { code: 'ZZ', name: 'z', unit: 'giường', kind: 'bed', definition: { floors: [{ code: '1', label: 'x', rows: ['A01 A1'] }] } }),
      ),
    ).toBe('INVALID_LAYOUT');
  });
});
