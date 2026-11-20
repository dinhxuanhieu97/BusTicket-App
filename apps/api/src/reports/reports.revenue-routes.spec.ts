import { FixedClock } from '../common/clock';
import { fakeRevenueDb } from '../../test/fakes/revenue-db';
import { ReportsService } from './reports.service';

const OP = '11111111-1111-4111-8111-111111111111';
const clock = new FixedClock(new Date('2027-01-21T09:00:00Z'));
const range = { from: '2027-01-20', to: '2027-01-21' };
const r = (id: string, code: string, amount: number, bookings: number) => ({
  id, code, origin: 'TP.HCM', destination: code, amount, bookings,
});

describe('GF16 — ReportsService.revenue byRoute', () => {
  it('merges received and refunded per route and sorts by net, then code', async () => {
    const { db } = fakeRevenueDb({
      days: [{ date: '2027-01-20', amount: 600_000, count: 4 }],
      refunds: [{ date: '2027-01-20', amount: 150_000, count: 1 }],
      routes: [r('r1', 'HCM-DL', 300_000, 2), r('r2', 'HCM-QN', 200_000, 1), r('r3', 'HCM-HA', 100_000, 1)],
      routeRefunds: [r('r1', 'HCM-DL', 150_000, 1)],
      allocated: 600_000,
    });
    const rep = await new ReportsService(db, clock).revenue(OP, range);
    expect(rep.byRoute).toEqual([
      { code: 'HCM-QN', origin: 'TP.HCM', destination: 'HCM-QN', received: 200_000, refunded: 0, net: 200_000, bookings: 1 },
      { code: 'HCM-DL', origin: 'TP.HCM', destination: 'HCM-DL', received: 300_000, refunded: 150_000, net: 150_000, bookings: 2 },
      { code: 'HCM-HA', origin: 'TP.HCM', destination: 'HCM-HA', received: 100_000, refunded: 0, net: 100_000, bookings: 1 },
    ]);
  });

  it('keeps a route that only had refunds in the period (negative net, zero bookings)', async () => {
    const { db } = fakeRevenueDb({ routeRefunds: [r('r9', 'HCM-QN', 80_000, 1)] });
    const rep = await new ReportsService(db, clock).revenue(OP, range);
    expect(rep.byRoute).toEqual([
      { code: 'HCM-QN', origin: 'TP.HCM', destination: 'HCM-QN', received: 0, refunded: 80_000, net: -80_000, bookings: 0 },
    ]);
  });

  it('breaks net ties by route code', async () => {
    const { db } = fakeRevenueDb({ routes: [r('b', 'B-1', 100, 1), r('a', 'A-1', 100, 1)] });
    const rep = await new ReportsService(db, clock).revenue(OP, range);
    expect(rep.byRoute.map((x) => x.code)).toEqual(['A-1', 'B-1']);
  });

  it('does not expose internal route ids', async () => {
    const { db } = fakeRevenueDb({ routes: [r('secret-id', 'HCM-DL', 100, 1)] });
    const rep = await new ReportsService(db, clock).revenue(OP, range);
    expect(rep.byRoute[0]).not.toHaveProperty('id');
  });

  it('unallocated = received in the period − amount allocated to bookings', async () => {
    const { db } = fakeRevenueDb({ days: [{ date: '2027-01-20', amount: 630_000, count: 3 }], allocated: 530_000 });
    expect((await new ReportsService(db, clock).revenue(OP, range)).unallocated).toBe(100_000);
  });

  it('route shares are scoped to the operator on both bookings and trips', async () => {
    const { db, calls } = fakeRevenueDb({});
    await new ReportsService(db, clock).revenue(OP, range);
    const shareQueries = calls.filter((c) => /shares/.test(c.sql));
    expect(shareQueries).toHaveLength(2);
    for (const q of shareQueries) {
      expect(q.sql).toMatch(/JOIN bookings b ON b\.id = m\.booking_id AND b\.operator_id = \$1/);
      expect(q.sql).toMatch(/JOIN trips t ON t\.id = sh\.trip_id AND t\.operator_id = \$1/);
    }
  });
});
