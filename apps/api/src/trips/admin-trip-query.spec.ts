import { adminTripRange } from './admin-trip-query';
describe('admin date range', () => {
  it('uses exclusive Vietnam month/year bounds including leap years', () => {
    const q = adminTripRange({ from: '2028-02-01', to: '2028-03-01' });
    expect(q.start.toISOString()).toBe('2028-01-31T17:00:00.000Z');
    expect(q.end.toISOString()).toBe('2028-02-29T17:00:00.000Z');
    expect(adminTripRange({ from: '2028-01-01', to: '2029-01-01' }).limit).toBe(25);
  });
  it.each([
    { from: '2027-02-29', to: '2027-03-01' },
    { from: '2027-01-01', to: '2029-01-01' },
    { from: '2027-01-01', to: '2027-01-01' },
    { from: '2027-01-01', to: '2027-02-01', limit: 101 },
    { from: '2027-01-01', to: '2027-02-01', cursor: 'bad' },
    { from: '2027-01-01', to: '2027-02-01', route: 'hcm-ha' },
    { from: '2027-01-01', to: '2027-02-01', route: ['A-1', 'B-2'] },
  ])('rejects invalid or unbounded query %j', (input) => expect(() => adminTripRange(input)).toThrow());
});

describe('GF9 — trip range paging cursor', () => {
  const range = { from: '2027-01-01', to: '2027-02-01' };
  const id = '22222222-2222-4222-8222-222222222222';

  it('accepts a cursor "<departAt>|<id>" inside the range and coerces limit from the query string', () => {
    const q = adminTripRange({ ...range, limit: '100', cursor: `2027-01-15T10:30:00.000Z|${id}` });
    expect(q.limit).toBe(100);
    expect(q.after).toEqual({ at: '2027-01-15T10:30:00.000Z', id });
  });

  it('has no cursor on the first page', () => {
    expect(adminTripRange(range).after).toBeNull();
  });

  it.each([
    [`2027-01-15T10:30:00.000Z|${id}|x`, 'extra part'],
    ['2027-01-15T10:30:00.000Z|not-a-uuid', 'bad id'],
    [`yesterday|${id}`, 'bad time'],
    [`2026-12-31T16:59:59.999Z|${id}`, 'before the range (VN midnight)'],
    [`2027-01-31T17:00:00.000Z|${id}`, 'at the exclusive end'],
    [`2027-01-15T10:30:00.000Z|${id}`.padEnd(151, 'x'), 'too long'],
  ])('rejects cursor %s (%s)', (cursor) => {
    expect(() => adminTripRange({ ...range, cursor })).toThrow();
  });

  it.each([0, -1, 1.5, 'abc'])('rejects limit %p', (limit) => {
    expect(() => adminTripRange({ ...range, limit })).toThrow();
  });
});
