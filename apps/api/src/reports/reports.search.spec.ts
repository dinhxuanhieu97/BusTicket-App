import { FixedClock } from '../common/clock';
import type { Db } from '../db/db';
import { ReportsService } from './reports.service';

/** DB giả: ghi lại mọi truy vấn, trả hàng theo bảng chính của câu SQL. */
function fakeDb(rows: { trips?: object[]; bookings?: object[] } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: /FROM bookings b/.test(sql) ? rows.bookings ?? [] : rows.trips ?? [], rowCount: 0 };
    }),
  };
  return { db: db as unknown as Db, calls };
}

const OP = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2027-02-01T09:00:00Z');
const service = (db: Db) => new ReportsService(db, new FixedClock(NOW));

describe('GF1 — ReportsService.search', () => {
  it('maps trips and bookings to the public shape', async () => {
    const departAt = new Date('2027-02-05T10:30:00Z');
    const { db } = fakeDb({
      trips: [{ id: 't1', code: 'PN050227-A', name: 'HCM → ĐL', status: 'OPEN', depart_at: departAt, route_code: 'HCM-DL' }],
      bookings: [{
        code: 'PNAB12', status: 'CONFIRMED', contact_name: 'Khách', contact_phone: '+84912345678', total_amount: 450000,
        trip_id: 't1', trip_code: 'PN050227-A', trip_name: 'HCM → ĐL', depart_at: departAt,
      }],
    });
    const r = await service(db).search(OP, 'OWNER', { q: ' pn ' });
    expect(r).toEqual({
      q: 'pn',
      trips: [{ id: 't1', code: 'PN050227-A', name: 'HCM → ĐL', status: 'OPEN', departAt, routeCode: 'HCM-DL' }],
      bookings: [{
        code: 'PNAB12', status: 'CONFIRMED', contactName: 'Khách', contactPhone: '+84912345678', totalAmount: 450000,
        trip: { id: 't1', code: 'PN050227-A', name: 'HCM → ĐL', departAt },
      }],
    });
  });

  it('never queries bookings for a role without booking.read', async () => {
    const { db, calls } = fakeDb({ bookings: [{ code: 'LEAK' }] });
    const r = await service(db).search(OP, 'PLATFORM_ADMIN', { q: 'PN' });
    expect(r.bookings).toBeNull();
    expect(calls.some((c) => /FROM bookings/.test(c.sql))).toBe(false);
  });

  it('scopes every query to the operator and passes the term as parameters', async () => {
    const { db, calls } = fakeDb();
    await service(db).search(OP, 'DISPATCHER', { q: '0912 345 678' });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.params[0]).toBe(OP);
      expect(c.sql).not.toContain('0912');
    }
    const bookingCall = calls.find((c) => /FROM bookings/.test(c.sql))!;
    expect(bookingCall.params).toEqual([OP, '0912345678%', '%0912 345 678%', '912345678']);
  });

  it('escapes LIKE wildcards so "%" and "_" match literally', async () => {
    const { db, calls } = fakeDb();
    await service(db).search(OP, 'OWNER', { q: '5%_x' });
    const tripCall = calls.find((c) => /FROM trips/.test(c.sql))!;
    expect(tripCall.params.slice(1, 3)).toEqual(['5\\%\\_X%', '%5\\%\\_x%']);
  });

  it('returns empty results without touching the DB for a malformed operator id', async () => {
    const { db, calls } = fakeDb();
    expect(await service(db).search('not-a-uuid', 'OWNER', { q: 'PN' })).toEqual({ q: 'PN', trips: [], bookings: [] });
    expect(await service(db).search('not-a-uuid', 'PLATFORM_ADMIN', { q: 'PN' })).toEqual({ q: 'PN', trips: [], bookings: null });
    expect(calls).toHaveLength(0);
  });

  it.each([{ q: 'a' }, { q: '   ' }, { q: 'x'.repeat(65) }, {}, { q: 'PN', extra: 1 }])('rejects invalid input %j', async (input) => {
    const { db, calls } = fakeDb();
    await expect(service(db).search(OP, 'OWNER', input)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
