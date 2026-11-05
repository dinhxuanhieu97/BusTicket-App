import { DomainError } from '../common/errors';
import { DEFAULT_POLICY } from '../operators/policy';
import { Fare, MAX_BOOKING_TOTAL, priceItems, SeatInfo } from './pricing';

const seats: SeatInfo[] = [
  { seatCode: 'A1', floor: '1', maxOccupancy: 2 },
  { seatCode: 'B1', floor: '2', maxOccupancy: 2 },
  { seatCode: 'A2', floor: '1', maxOccupancy: 1 },
];
const fares: Fare[] = [
  { floor: '1', occupancy: 1, price: 450_000 },
  { floor: '1', occupancy: 2, price: 700_000 },
  { floor: '2', occupancy: 1, price: 420_000 },
  { floor: '2', occupancy: 2, price: 650_000 },
];
const child = DEFAULT_POLICY.childPolicy;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return 'NO_ERROR';
}

describe('priceItems', () => {
  it('prices single and double rooms by floor and sums the total', () => {
    const r = priceItems(
      [
        { seatCode: 'A1', occupancy: 2, infantCount: 0 },
        { seatCode: 'B1', occupancy: 1, infantCount: 0 },
      ],
      seats,
      fares,
      child,
    );
    expect(r.items.map((i) => i.unitPrice)).toEqual([700_000, 420_000]);
    expect(r.total).toBe(1_120_000);
  });

  it('charges nothing for an infant under the default policy', () => {
    const r = priceItems([{ seatCode: 'A1', occupancy: 1, infantCount: 1 }], seats, fares, child);
    expect(r.items[0]).toMatchObject({ infantPrice: 0, lineTotal: 450_000 });
  });

  it('charges the configured infant price when the operator sets one', () => {
    const r = priceItems([{ seatCode: 'A1', occupancy: 1, infantCount: 1 }], seats, fares, { ...child, price: 50_000 });
    expect(r.items[0]).toMatchObject({ infantPrice: 50_000, lineTotal: 500_000 });
    expect(r.total).toBe(500_000);
  });

  it('allows an accompanying infant only in a single room (occupancy 1)', () => {
    expect(priceItems([{ seatCode: 'A1', occupancy: 1, infantCount: 1 }], seats, fares, child).total).toBe(450_000);
    expect(codeOf(() => priceItems([{ seatCode: 'A1', occupancy: 2, infantCount: 1 }], seats, fares, child))).toBe('VALIDATION_FAILED');
  });

  it('rejects more people than the seat holds', () => {
    expect(codeOf(() => priceItems([{ seatCode: 'A2', occupancy: 2, infantCount: 0 }], seats, fares, child))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('rejects zero occupancy', () => {
    expect(codeOf(() => priceItems([{ seatCode: 'A1', occupancy: 0, infantCount: 0 }], seats, fares, child))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('rejects more infants than the policy allows', () => {
    expect(codeOf(() => priceItems([{ seatCode: 'A1', occupancy: 1, infantCount: 2 }], seats, fares, child))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('counts infants toward capacity when the policy says so', () => {
    const strict = { ...child, countsTowardCapacity: true };
    expect(codeOf(() => priceItems([{ seatCode: 'A1', occupancy: 2, infantCount: 1 }], seats, fares, strict))).toBe(
      'VALIDATION_FAILED',
    );
    expect(priceItems([{ seatCode: 'A1', occupancy: 1, infantCount: 1 }], seats, fares, strict).total).toBe(450_000);
  });

  it('fails with FARE_NOT_CONFIGURED when a fare is missing', () => {
    const noDouble = fares.filter((f) => !(f.floor === '1' && f.occupancy === 2));
    expect(codeOf(() => priceItems([{ seatCode: 'A1', occupancy: 2, infantCount: 0 }], seats, noDouble, child))).toBe(
      'FARE_NOT_CONFIGURED',
    );
  });

  it('rejects a total above the booking limit with LIMIT_EXCEEDED', () => {
    const many: SeatInfo[] = Array.from({ length: 20 }, (_, i) => ({ seatCode: `A${String(i + 1).padStart(2, '0')}`, floor: '1', maxOccupancy: 1 }));
    const huge: Fare[] = [{ floor: '1', occupancy: 1, price: MAX_BOOKING_TOTAL / 10 }];
    const items = many.map((s) => ({ seatCode: s.seatCode, occupancy: 1, infantCount: 0 }));
    expect(codeOf(() => priceItems(items, many, huge, child))).toBe('LIMIT_EXCEEDED');
    expect(priceItems(items.slice(0, 10), many, huge, child).total).toBe(MAX_BOOKING_TOTAL);
  });

  it('rejects a seat that is not on the trip', () => {
    expect(codeOf(() => priceItems([{ seatCode: 'C1', occupancy: 1, infantCount: 0 }], seats, fares, child))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('depositAmount', () => {
  const { depositAmount } = jest.requireActual('./pricing') as typeof import('./pricing');
  it.each([
    [700_000, 50, 350_000],
    [450_000, 50, 225_000],
    [380_000, 30, 114_000],
    [380_100, 30, 115_000], // làm tròn lên bội số 1.000đ
    [500, 30, 500], // không vượt tổng
    [380_000, 100, 380_000],
    [0, 50, 0],
  ])('total %i at %i%% → %i', (total, pct, expected) => {
    expect(depositAmount(total, pct)).toBe(expected);
  });
});

describe('amountDueNow', () => {
  const { amountDueNow } = jest.requireActual('./pricing') as typeof import('./pricing');
  const now = new Date('2027-01-20T03:00:00Z');
  const base = { deposit_amount: 350_000, total_amount: 700_000, paid_amount: 100_000 };
  it('live hold → remaining deposit', () => {
    expect(amountDueNow({ ...base, status: 'HOLDING', hold_expires_at: new Date(now.getTime() + 60_000) }, now)).toBe(250_000);
  });
  it('confirmed → remaining total', () => {
    expect(amountDueNow({ ...base, status: 'CONFIRMED', hold_expires_at: null }, now)).toBe(600_000);
  });
  it.each([
    ['expired hold not yet marked', { status: 'HOLDING', hold_expires_at: now }],
    ['expired', { status: 'EXPIRED', hold_expires_at: now }],
    ['cancelled', { status: 'CANCELLED', hold_expires_at: null }],
    ['completed', { status: 'COMPLETED', hold_expires_at: null }],
  ])('%s → 0', (_n, s) => {
    expect(amountDueNow({ ...base, ...s }, now)).toBe(0);
  });
});
