import { FixedClock } from '../common/clock';
import { fakeRevenueDb } from '../../test/fakes/revenue-db';
import { ReportsService } from './reports.service';

const OP = '11111111-1111-4111-8111-111111111111';
const clock = new FixedClock(new Date('2027-01-21T09:00:00Z'));

describe('GF8 — ReportsService.revenue totals (no 200-payment cap)', () => {
  it('sums SQL aggregates for the whole range, however many payments there are', async () => {
    const { db } = fakeRevenueDb({
      days: [
        { date: '2027-01-20', amount: 1_500_000_000, count: 5000 },
        { date: '2027-01-22', amount: 200_000, count: 1 },
      ],
      allocated: 1_500_200_000,
    });
    const r = await new ReportsService(db, clock).revenue(OP, { from: '2027-01-20', to: '2027-01-23' });
    expect(r.totals).toEqual({ received: 1_500_200_000, refunded: 0, net: 1_500_200_000, payments: 5001, refunds: 0 });
    expect(r.byDay.map((d) => [d.date, d.received, d.payments])).toEqual([
      ['2027-01-20', 1_500_000_000, 5000],
      ['2027-01-21', 0, 0],
      ['2027-01-22', 200_000, 1],
    ]);
  });

  it('passes methods and hours through unchanged', async () => {
    const methods = [{ method: 'BANK_TRANSFER', amount: 500_000, count: 2 }, { method: 'CASH', amount: 130_000, count: 1 }];
    const hours = [{ hour: 8, amount: 130_000, count: 1 }, { hour: 21, amount: 500_000, count: 2 }];
    const { db } = fakeRevenueDb({ days: [{ date: '2027-01-20', amount: 630_000, count: 3 }], methods, hours, allocated: 630_000 });
    const r = await new ReportsService(db, clock).revenue(OP, { from: '2027-01-20', to: '2027-01-21' });
    expect(r.byMethod).toEqual(methods);
    expect(r.byHour).toEqual(hours);
  });

  it('runs all seven queries scoped to the operator with Vietnam-midnight bounds', async () => {
    const { db, calls } = fakeRevenueDb({});
    await new ReportsService(db, clock).revenue(OP, { from: '2027-01-20', to: '2027-01-21' });
    expect(calls).toHaveLength(7);
    for (const c of calls) {
      expect(c.params).toEqual([OP, new Date('2027-01-19T17:00:00Z'), new Date('2027-01-20T17:00:00Z')]);
      expect(c.sql).toMatch(/operator_id = \$1/);
    }
  });

  it('a range with no payments has zero totals and one row per day', async () => {
    const { db } = fakeRevenueDb({});
    const r = await new ReportsService(db, clock).revenue(OP, { from: '2027-01-01', to: '2027-01-08' });
    expect(r.byDay).toHaveLength(7);
    expect(r.totals).toEqual({ received: 0, refunded: 0, net: 0, payments: 0, refunds: 0 });
    expect(r.unallocated).toBe(0);
  });

  it('returns an empty report without querying for a malformed operator id', async () => {
    const { db, calls } = fakeRevenueDb({ days: [{ date: '2027-01-20', amount: 9, count: 1 }] });
    const r = await new ReportsService(db, clock).revenue('nope', { from: '2027-01-20', to: '2027-01-22' });
    expect(calls).toHaveLength(0);
    expect(r.byDay).toHaveLength(2);
    expect(r.totals.received).toBe(0);
  });

  it.each([
    { from: '2027-01-21', to: '2027-01-20' },
    { from: '2027-01-20', to: '2028-01-22' },
    { from: '2027-02-30', to: '2027-03-01' },
    { from: '2027-01-20', to: '2027-01-21', route: 'X' },
  ])('rejects %j before querying', async (input) => {
    const { db, calls } = fakeRevenueDb({});
    await expect(new ReportsService(db, clock).revenue(OP, input)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
