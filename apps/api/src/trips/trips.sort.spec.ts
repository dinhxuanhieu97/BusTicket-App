import { FixedClock } from '../common/clock';
import type { Db } from '../db/db';
import type { OperatorsService } from '../operators/operators.service';
import { adminTripRange } from './admin-trip-query';
import { TripsService } from './trips.service';

const OP = '11111111-1111-4111-8111-111111111111';
const range = { from: '2027-01-01', to: '2027-02-01' };
const trip = (i: number) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, name: `T${i}` });

function service(rows: object[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    }),
  } as unknown as Db;
  return { trips: new TripsService(db, {} as OperatorsService, new FixedClock(new Date('2027-01-01T00:00:00Z'))), calls };
}

describe('T2 — trip list sort query', () => {
  it('defaults to departure ascending with the keyset cursor', () => {
    expect(adminTripRange(range)).toMatchObject({ sort: 'depart', order: 'asc', keyset: true, offset: 0 });
    expect(adminTripRange({ ...range, sort: 'depart', order: 'desc' }).keyset).toBe(false);
  });

  it.each(['price', 'name;DROP', 'NAME', ''])('rejects sort %p', (sort) => {
    expect(() => adminTripRange({ ...range, sort })).toThrow();
  });

  it('rejects an unknown order', () => {
    expect(() => adminTripRange({ ...range, sort: 'name', order: 'up' })).toThrow();
  });

  it('reads an offset cursor only when it matches the requested sort', () => {
    expect(adminTripRange({ ...range, sort: 'name', order: 'desc', cursor: 'o:name:desc:25' }).offset).toBe(25);
    for (const cursor of [
      'o:name:asc:25', // chiều khác
      'o:code:desc:25', // cột khác
      'o:name:desc:-1',
      'o:name:desc:1000001',
      '2027-01-02T10:00:00.000Z|00000000-0000-4000-8000-000000000001', // con trỏ kiểu mặc định
    ]) {
      expect(() => adminTripRange({ ...range, sort: 'name', order: 'desc', cursor })).toThrow('Vị trí phân trang không hợp lệ.');
    }
    // Ngược lại: thứ tự mặc định không nhận con trỏ vị trí.
    expect(() => adminTripRange({ ...range, cursor: 'o:depart:asc:25' })).toThrow('Vị trí phân trang không hợp lệ.');
  });
});

describe('T2 — TripsService.listAdminRange sorted', () => {
  it.each([
    ['name', 'desc', 'ORDER BY name DESC NULLS LAST, depart_at, id'],
    ['available', 'asc', 'ORDER BY available ASC NULLS LAST, depart_at, id'],
    ['vehicle', 'asc', 'ORDER BY vehicle_code ASC'],
    ['status', 'asc', "ORDER BY CASE status WHEN 'DRAFT' THEN 0"],
    ['depart', 'desc', 'ORDER BY depart_at DESC'],
  ])('orders by %s %s from the allow-list with a stable tie-break', async (sort, order, expected) => {
    const { trips, calls } = service([]);
    await trips.listAdminRange(OP, { ...range, sort, order });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain(expected);
  });

  it('passes the route as a parameter and pages by offset', async () => {
    const { trips, calls } = service([trip(1), trip(2), trip(3)]);
    const r = await trips.listAdminRange(OP, { ...range, sort: 'name', route: 'HCM-QN', limit: 2, cursor: 'o:name:asc:4' });
    const { sql, params } = calls[0]!;
    expect(params).toEqual([OP, expect.any(Date), expect.any(Date), expect.any(Date), 'HCM-QN', 3, 4]);
    expect(sql).not.toContain('HCM-QN');
    expect(sql).toMatch(/LIMIT \$6 OFFSET \$7/);
    expect(r.trips.map((t) => t.id)).toEqual([trip(1).id, trip(2).id]);
    expect(r.nextCursor).toBe('o:name:asc:6');
  });

  it('has no cursor on the last sorted page', async () => {
    const { trips } = service([trip(1)]);
    expect((await trips.listAdminRange(OP, { ...range, sort: 'code', limit: 2 })).nextCursor).toBeNull();
  });
});
