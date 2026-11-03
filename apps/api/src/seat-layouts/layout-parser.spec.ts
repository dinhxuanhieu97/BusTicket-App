import { DomainError } from '../common/errors';
import { parseLayout } from './layout-parser';
import { LIBRARY_LAYOUTS } from './library';

function errorOf(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error('expected DomainError');
}

const twoFloors = {
  floors: [
    { code: 'A', label: 'Tầng dưới', rows: ['A01 . A02', 'A03 . A04'] },
    { code: 'B', label: 'Tầng trên', rows: ['B01 . B02'] },
  ],
};

describe('parseLayout', () => {
  it('reads seats with floor, row and column positions', () => {
    const r = parseLayout(twoFloors, 'bed');
    expect(r.capacity).toBe(6);
    expect(r.seats.find((s) => s.code === 'A04')).toEqual({
      code: 'A04', floor: 'A', row: 1, col: 2, maxOccupancy: 1, sellable: true,
    });
  });

  it('treats "." and "_" as non-seat cells', () => {
    const r = parseLayout({ floors: [{ code: 'A', label: 'x', rows: ['A01 _ . A02'] }] }, 'seat');
    expect(r.seats.map((s) => [s.code, s.col])).toEqual([['A01', 0], ['A02', 3]]);
  });

  it('allows rooms to hold 2 people and applies per-seat overrides', () => {
    const r = parseLayout(
      { ...twoFloors, defaultMaxOccupancy: 2, seatOverrides: { A01: { maxOccupancy: 1 }, B02: { sellable: false } } },
      'room',
    );
    expect(r.seats.find((s) => s.code === 'A02')!.maxOccupancy).toBe(2);
    expect(r.seats.find((s) => s.code === 'A01')!.maxOccupancy).toBe(1);
    expect(r.seats.find((s) => s.code === 'B02')!.sellable).toBe(false);
    expect(r.capacity).toBe(6);
  });

  it.each([
    ['duplicate seat code', { floors: [{ code: 'A', label: 'x', rows: ['A01 A01'] }] }, 'bed'],
    ['seat on the wrong floor', { floors: [{ code: 'A', label: 'x', rows: ['B01'] }] }, 'bed'],
    ['malformed token', { floors: [{ code: 'A', label: 'x', rows: ['A1'] }] }, 'bed'],
    ['no seats', { floors: [{ code: 'A', label: 'x', rows: ['. _'] }] }, 'bed'],
    ['duplicate floor code', { floors: [{ code: 'A', label: 'x', rows: ['A01'] }, { code: 'A', label: 'y', rows: ['A02'] }] }, 'bed'],
    ['double occupancy on a bed', { ...twoFloors, defaultMaxOccupancy: 2 }, 'bed'],
    ['override double occupancy on a seat', { ...twoFloors, seatOverrides: { A01: { maxOccupancy: 2 } } }, 'seat'],
    ['override for a missing seat', { ...twoFloors, seatOverrides: { A09: { sellable: false } } }, 'bed'],
    ['nothing sellable', { floors: [{ code: 'A', label: 'x', rows: ['A01'] }], seatOverrides: { A01: { sellable: false } } }, 'bed'],
    ['unknown property', { ...twoFloors, extra: true }, 'bed'],
    ['row wider than 12 cells', { floors: [{ code: 'A', label: 'x', rows: [Array(13).fill('.').join(' ')] }] }, 'bed'],
    ['not an object', 'A01 A02', 'bed'],
  ] as const)('rejects %s with INVALID_LAYOUT', (_name, def, kind) => {
    expect(errorOf(() => parseLayout(def, kind)).code).toBe('INVALID_LAYOUT');
  });
});

describe('library layouts', () => {
  it.each(LIBRARY_LAYOUTS.map((l) => [l.code, l] as const))('%s parses with the documented capacity', (code, lib) => {
    const expected: Record<string, number> = { LIMO24: 24, BED36: 36, SEAT29: 29 };
    const r = parseLayout(lib.definition, lib.kind);
    expect(r.capacity).toBe(expected[code]);
  });

  it('limousine rooms default to 2 people, sleeper beds to 1', () => {
    const limo = LIBRARY_LAYOUTS.find((l) => l.code === 'LIMO24')!;
    const bed = LIBRARY_LAYOUTS.find((l) => l.code === 'BED36')!;
    expect(new Set(parseLayout(limo.definition, limo.kind).seats.map((s) => s.maxOccupancy))).toEqual(new Set([2]));
    expect(new Set(parseLayout(bed.definition, bed.kind).seats.map((s) => s.maxOccupancy))).toEqual(new Set([1]));
  });
});
