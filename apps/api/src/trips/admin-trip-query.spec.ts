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
