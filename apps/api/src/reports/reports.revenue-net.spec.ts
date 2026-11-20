import { FixedClock } from '../common/clock';
import { fakeRevenueDb } from '../../test/fakes/revenue-db';
import { ReportsService } from './reports.service';

const OP = '11111111-1111-4111-8111-111111111111';
const clock = new FixedClock(new Date('2027-01-21T09:00:00Z'));
const range = { from: '2027-01-20', to: '2027-01-22' };

describe('GF17 — ReportsService.revenue net = received − refunded', () => {
  it('computes net per day and in the totals, counting refunds separately from payments', async () => {
    const { db } = fakeRevenueDb({
      days: [{ date: '2027-01-20', amount: 630_000, count: 3 }],
      refunds: [
        { date: '2027-01-20', amount: 100_000, count: 1 },
        { date: '2027-01-21', amount: 50_000, count: 1 },
      ],
      allocated: 630_000,
    });
    const rep = await new ReportsService(db, clock).revenue(OP, range);
    expect(rep.byDay).toEqual([
      { date: '2027-01-20', received: 630_000, refunded: 100_000, net: 530_000, payments: 3, refunds: 1 },
      { date: '2027-01-21', received: 0, refunded: 50_000, net: -50_000, payments: 0, refunds: 1 },
    ]);
    expect(rep.totals).toEqual({ received: 630_000, refunded: 150_000, net: 480_000, payments: 3, refunds: 2 });
  });

  it('a period with only refunds has a negative net', async () => {
    const { db } = fakeRevenueDb({ refunds: [{ date: '2027-01-21', amount: 200_000, count: 2 }] });
    const rep = await new ReportsService(db, clock).revenue(OP, range);
    expect(rep.totals).toEqual({ received: 0, refunded: 200_000, net: -200_000, payments: 0, refunds: 2 });
  });

  it('ignores refund rows dated outside the requested days', async () => {
    const { db } = fakeRevenueDb({ refunds: [{ date: '2027-01-25', amount: 999, count: 1 }] });
    const rep = await new ReportsService(db, clock).revenue(OP, range);
    expect(rep.totals.refunded).toBe(0);
  });

  it('counts only finished refunds (REFUNDED) by the day they were paid out (resolved_at)', async () => {
    const { db, calls } = fakeRevenueDb({});
    await new ReportsService(db, clock).revenue(OP, range);
    const q = calls.find((c) => /FROM refund_obligations WHERE/.test(c.sql))!;
    expect(q.sql).toMatch(/status = 'REFUNDED'/);
    expect(q.sql).toMatch(/resolved_at >= \$2 AND resolved_at < \$3/);
    expect(q.params).toEqual([OP, new Date('2027-01-19T17:00:00Z'), new Date('2027-01-21T17:00:00Z')]);
  });
});
