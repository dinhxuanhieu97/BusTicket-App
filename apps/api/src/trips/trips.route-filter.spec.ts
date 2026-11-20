import { FixedClock } from '../common/clock';
import type { Db } from '../db/db';
import type { OperatorsService } from '../operators/operators.service';
import { adminTripRange } from './admin-trip-query';
import { TripsService } from './trips.service';

const OP = '11111111-1111-4111-8111-111111111111';
const range = { from: '2027-01-01', to: '2027-02-01' };
const row = (i: number) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`, depart_at: new Date(`2027-01-0${i}T10:00:00Z`),
  cursor_at: `2027-01-0${i}T10:00:00.000000Z`, route_code: 'HCM-QN',
});

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

describe('GF13 — route filter query', () => {
  it.each(['HA', 'HCM-QN', 'A1-B2-C3', 'X'.repeat(32)])('accepts route code %s', (route) => {
    expect(adminTripRange({ ...range, route }).route).toBe(route);
  });

  it.each(['X', 'X'.repeat(33), 'hcm-qn', 'HCM QN', 'HCM_QN', "HA'--", ''])('rejects route code %p', (route) => {
    expect(() => adminTripRange({ ...range, route })).toThrow();
  });
});

describe('GF13 — TripsService.listAdminRange with a route', () => {
  it('passes the route code as a parameter and resolves it inside the same operator', async () => {
    const { trips, calls } = service([]);
    await trips.listAdminRange(OP, { ...range, route: 'HCM-QN' });
    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0]!;
    expect(params[0]).toBe(OP);
    expect(params[7]).toBe('HCM-QN');
    expect(sql).toMatch(/route_id IN \(SELECT id FROM routes WHERE operator_id = \$1 AND code = \$8\)/);
    expect(sql).not.toContain('HCM-QN');
  });

  it('sends null (no filter) when no route is given', async () => {
    const { trips, calls } = service([]);
    await trips.listAdminRange(OP, range);
    expect(calls[0]!.params[7]).toBeNull();
  });

  it('pages a filtered range: limit + 1 rows give a cursor to the last shown trip', async () => {
    const { trips, calls } = service([row(1), row(2), row(3)]);
    const r = await trips.listAdminRange(OP, { ...range, route: 'HCM-QN', limit: 2 });
    expect(calls[0]!.params[6]).toBe(3);
    expect(r.trips.map((t) => t.id)).toEqual([row(1).id, row(2).id]);
    expect(r.nextCursor).toBe(`${row(2).cursor_at}|${row(2).id}`);
    expect(r.trips[0]).not.toHaveProperty('cursor_at');
  });

  it('has no cursor on the last page of a route', async () => {
    const { trips } = service([row(1)]);
    expect((await trips.listAdminRange(OP, { ...range, route: 'HCM-QN', limit: 2 })).nextCursor).toBeNull();
  });

  it('returns nothing for a malformed operator id without querying', async () => {
    const { trips, calls } = service([row(1)]);
    expect(await trips.listAdminRange('nope', { ...range, route: 'HCM-QN' })).toEqual({ trips: [], nextCursor: null });
    expect(calls).toHaveLength(0);
  });
});
