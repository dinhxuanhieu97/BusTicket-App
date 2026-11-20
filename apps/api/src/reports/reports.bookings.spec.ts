import { FixedClock } from '../common/clock';
import type { Db } from '../db/db';
import { ReportsService } from './reports.service';

type Row = { date: string; bookings: number; cancelled: number; abandoned: number; holding: number; seats: number };

function fakeDb(rows: Row[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    }),
  };
  return { db: db as unknown as Db, calls };
}

const OP = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2027-01-21T09:00:00Z');
const row = (date: string, v: Partial<Row>): Row => ({ date, bookings: 0, cancelled: 0, abandoned: 0, holding: 0, seats: 0, ...v });

describe('GF7 — ReportsService.bookings', () => {
  it('fills every Vietnam day of the range and sums totals with the cancel rate', async () => {
    const { db } = fakeDb([
      row('2027-01-20', { bookings: 4, cancelled: 1, abandoned: 2, holding: 1, seats: 6 }),
      row('2027-01-22', { bookings: 4, cancelled: 0, seats: 4 }),
    ]);
    const r = await new ReportsService(db, new FixedClock(NOW)).bookings(OP, { from: '2027-01-20', to: '2027-01-23' });
    expect(r.byDay.map((d) => [d.date, d.seats])).toEqual([['2027-01-20', 6], ['2027-01-21', 0], ['2027-01-22', 4]]);
    expect(r.totals).toEqual({ bookings: 8, cancelled: 1, abandoned: 2, holding: 1, seats: 10, cancelRate: 0.125 });
    expect(r).toMatchObject({ from: '2027-01-20', to: '2027-01-23' });
  });

  it('has no cancel rate (null, not 0 or NaN) when no booking was created', async () => {
    const { db } = fakeDb([row('2027-01-20', { abandoned: 3 })]);
    const r = await new ReportsService(db, new FixedClock(NOW)).bookings(OP, { from: '2027-01-20', to: '2027-01-21' });
    expect(r.totals.cancelRate).toBeNull();
    expect(r.totals.abandoned).toBe(3);
  });

  it('rounds the cancel rate to four decimals', async () => {
    const { db } = fakeDb([row('2027-01-20', { bookings: 3, cancelled: 1 })]);
    const r = await new ReportsService(db, new FixedClock(NOW)).bookings(OP, { from: '2027-01-20', to: '2027-01-21' });
    expect(r.totals.cancelRate).toBe(0.3333);
  });

  it('passes the range as Vietnam midnights and "now" for holds past their release time', async () => {
    const { db, calls } = fakeDb([]);
    await new ReportsService(db, new FixedClock(NOW)).bookings(OP, { from: '2027-01-20', to: '2027-01-21' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual([OP, new Date('2027-01-19T17:00:00Z'), new Date('2027-01-20T17:00:00Z'), NOW]);
    expect(calls[0]!.sql).toMatch(/b\.operator_id = \$1 AND b\.created_at >= \$2 AND b\.created_at < \$3/);
  });

  it('ignores rows for days outside the range', async () => {
    const { db } = fakeDb([row('2027-01-19', { bookings: 99, cancelled: 99 }), row('2027-01-20', { bookings: 2, cancelled: 1 })]);
    const r = await new ReportsService(db, new FixedClock(NOW)).bookings(OP, { from: '2027-01-20', to: '2027-01-21' });
    expect(r.totals).toMatchObject({ bookings: 2, cancelled: 1, cancelRate: 0.5 });
  });

  it('returns empty days without querying for a malformed operator id', async () => {
    const { db, calls } = fakeDb([row('2027-01-20', { bookings: 5 })]);
    const r = await new ReportsService(db, new FixedClock(NOW)).bookings('nope', { from: '2027-01-20', to: '2027-01-22' });
    expect(calls).toHaveLength(0);
    expect(r.byDay).toHaveLength(2);
    expect(r.totals).toEqual({ bookings: 0, cancelled: 0, abandoned: 0, holding: 0, seats: 0, cancelRate: null });
  });

  it.each([{ from: '2027-01-21', to: '2027-01-21' }, { from: '2027-01-20' }, { from: '2027-01-20', to: '2028-01-22' }])(
    'rejects an invalid range %j before querying',
    async (input) => {
      const { db, calls } = fakeDb([]);
      await expect(new ReportsService(db, new FixedClock(NOW)).bookings(OP, input)).rejects.toThrow();
      expect(calls).toHaveLength(0);
    },
  );
});
