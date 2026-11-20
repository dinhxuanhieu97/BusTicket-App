import { FixedClock } from '../common/clock';
import type { Db } from '../db/db';
import { CLOSING_SOON_MS, ReportsService } from './reports.service';

/** DB giả: trả hàng theo bảng trong câu SQL và ghi lại tham số. */
function fakeDb(data: { closing?: number; payments?: { none: number; needs_review: number; resolved: number }; refunds?: number }) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM trips/.test(sql)) return { rows: [{ n: data.closing ?? 0 }], rowCount: 1 };
      if (/FROM payments/.test(sql)) return { rows: [data.payments ?? { none: 0, needs_review: 0, resolved: 0 }], rowCount: 1 };
      return { rows: [{ n: data.refunds ?? 0 }], rowCount: 1 };
    }),
  };
  return { db: db as unknown as Db, calls };
}

const OP = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2027-02-01T09:00:00Z');

describe('GF2 — ReportsService.counters', () => {
  it('sums payments by review status and counts open refunds for money roles', async () => {
    const { db } = fakeDb({ closing: 1, payments: { none: 405, needs_review: 5, resolved: 2 }, refunds: 1 });
    expect(await new ReportsService(db, new FixedClock(NOW)).counters(OP, 'ACCOUNTANT')).toEqual({
      tripsClosingSoon: 1,
      payments: { total: 412, NONE: 405, NEEDS_REVIEW: 5, RESOLVED: 2 },
      refundsOpen: 1,
    });
  });

  it.each(['DISPATCHER', 'PLATFORM_ADMIN'] as const)('gives %s trip counts only and never reads money tables', async (role) => {
    const { db, calls } = fakeDb({ closing: 3, payments: { none: 9, needs_review: 9, resolved: 9 }, refunds: 9 });
    expect(await new ReportsService(db, new FixedClock(NOW)).counters(OP, role)).toEqual({
      tripsClosingSoon: 3, payments: null, refundsOpen: null,
    });
    expect(calls.map((c) => /FROM (\w+)/.exec(c.sql)![1])).toEqual(['trips']);
  });

  it('looks for trips whose sales close in (now, now + 2h]', async () => {
    const { db, calls } = fakeDb({});
    await new ReportsService(db, new FixedClock(NOW)).counters(OP, 'OWNER');
    const trips = calls.find((c) => /FROM trips/.test(c.sql))!;
    expect(trips.sql).toMatch(/sales_close_at > \$2 AND sales_close_at <= \$3/);
    expect(trips.sql).toMatch(/status = 'OPEN'/);
    expect(trips.params).toEqual([OP, NOW, new Date(NOW.getTime() + CLOSING_SOON_MS)]);
    expect(CLOSING_SOON_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('scopes every query to the operator', async () => {
    const { db, calls } = fakeDb({});
    await new ReportsService(db, new FixedClock(NOW)).counters(OP, 'OWNER');
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.params[0]).toBe(OP);
      expect(c.sql).toMatch(/operator_id = \$1/);
    }
  });

  it('returns zeros without querying for a malformed operator id', async () => {
    const { db, calls } = fakeDb({ closing: 5 });
    expect(await new ReportsService(db, new FixedClock(NOW)).counters('x', 'OWNER')).toEqual({
      tripsClosingSoon: 0, payments: null, refundsOpen: null,
    });
    expect(calls).toHaveLength(0);
  });
});
