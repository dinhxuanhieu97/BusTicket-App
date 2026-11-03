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
    { code: '1', label: 'Tầng dưới', rows: ['A1 . B1', 'A3 . B3'] },
    { code: '2', label: 'Tầng trên', rows: ['A2 . B2'] },
  ],
};

describe('parseLayout', () => {
  it('reads seats with floor, row and column positions', () => {
    const r = parseLayout(twoFloors, 'bed');
    expect(r.capacity).toBe(6);
    expect(r.seats.find((s) => s.code === 'B3')).toEqual({
      code: 'B3', floor: '1', row: 1, col: 2, maxOccupancy: 1, sellable: true,
    });
  });

  it('takes the floor from where the seat is drawn, not from its code (row-lettered buses)', () => {
    const r = parseLayout(twoFloors, 'bed');
    expect(r.seats.find((s) => s.code === 'A1')!.floor).toBe('1');
    expect(r.seats.find((s) => s.code === 'A2')!.floor).toBe('2');
  });

  it('accepts 1–2 letters and 1–2 digits, and treats markers as non-seat cells', () => {
    const r = parseLayout({ floors: [{ code: '1', label: 'x', rows: ['TX _ . CUA', 'A1 AB12 . WC D10'] }] }, 'seat');
    expect(r.seats.map((s) => [s.code, s.col])).toEqual([['A1', 0], ['AB12', 1], ['D10', 4]]);
  });

  it('allows rooms to hold 2 people and applies per-seat overrides', () => {
    const r = parseLayout(
      { ...twoFloors, defaultMaxOccupancy: 2, seatOverrides: { A1: { maxOccupancy: 1 }, B1: { sellable: false } } },
      'room',
    );
    expect(r.seats.find((s) => s.code === 'A3')!.maxOccupancy).toBe(2);
    expect(r.seats.find((s) => s.code === 'A1')!.maxOccupancy).toBe(1);
    expect(r.seats.find((s) => s.code === 'B1')!.sellable).toBe(false);
    expect(r.capacity).toBe(6);
  });

  it.each([
    ['duplicate seat code on the same floor', { floors: [{ code: '1', label: 'x', rows: ['A1 A1'] }] }, 'bed'],
    ['duplicate seat code across floors', { floors: [{ code: '1', label: 'x', rows: ['A1'] }, { code: '2', label: 'y', rows: ['A1'] }] }, 'bed'],
    ['lower-case code', { floors: [{ code: '1', label: 'x', rows: ['a1'] }] }, 'bed'],
    ['three digits', { floors: [{ code: '1', label: 'x', rows: ['A123'] }] }, 'bed'],
    ['digits only', { floors: [{ code: '1', label: 'x', rows: ['12'] }] }, 'bed'],
    ['unknown marker', { floors: [{ code: '1', label: 'x', rows: ['A1 XYZ'] }] }, 'bed'],
    ['letter floor code', { floors: [{ code: 'A', label: 'x', rows: ['A1'] }] }, 'bed'],
    ['no seats', { floors: [{ code: '1', label: 'x', rows: ['TX . _ CUA'] }] }, 'bed'],
    ['duplicate floor code', { floors: [{ code: '1', label: 'x', rows: ['A1'] }, { code: '1', label: 'y', rows: ['A2'] }] }, 'bed'],
    ['double occupancy on a bed', { ...twoFloors, defaultMaxOccupancy: 2 }, 'bed'],
    ['override double occupancy on a seat', { ...twoFloors, seatOverrides: { A1: { maxOccupancy: 2 } } }, 'seat'],
    ['override for a missing seat', { ...twoFloors, seatOverrides: { Z9: { sellable: false } } }, 'bed'],
    ['nothing sellable', { floors: [{ code: '1', label: 'x', rows: ['A1'] }], seatOverrides: { A1: { sellable: false } } }, 'bed'],
    ['unknown property', { ...twoFloors, extra: true }, 'bed'],
    ['row wider than 12 cells', { floors: [{ code: '1', label: 'x', rows: [Array(13).fill('.').join(' ')] }] }, 'bed'],
    ['not an object', 'A1 A2', 'bed'],
  ] as const)('rejects %s with INVALID_LAYOUT', (_name, def, kind) => {
    expect(errorOf(() => parseLayout(def, kind)).code).toBe('INVALID_LAYOUT');
  });
});

describe('library layouts', () => {
  it.each(LIBRARY_LAYOUTS.map((l) => [l.code, l] as const))('%s parses with the documented capacity', (code, lib) => {
    const expected: Record<string, number> = { LIMO24: 24, BED40: 40, SEAT29: 29 };
    expect(parseLayout(lib.definition, lib.kind).capacity).toBe(expected[code]);
  });

  it('BED40 matches Images/40-GIUONG.webp: odd numbers downstairs, even upstairs, D1–D5 / D6–D10 at the back', () => {
    const bed = LIBRARY_LAYOUTS.find((l) => l.code === 'BED40')!;
    const seats = parseLayout(bed.definition, bed.kind).seats;
    const floorOf = (c: string) => seats.find((s) => s.code === c)!.floor;
    for (const row of ['A', 'B', 'C']) {
      for (let n = 1; n <= 10; n++) expect([`${row}${n}`, floorOf(`${row}${n}`)]).toEqual([`${row}${n}`, n % 2 ? '1' : '2']);
    }
    for (let n = 1; n <= 10; n++) expect([`D${n}`, floorOf(`D${n}`)]).toEqual([`D${n}`, n <= 5 ? '1' : '2']);
    expect(seats.filter((s) => s.floor === '1')).toHaveLength(20);
    // Dãy A bên trái (phía tài xế), dãy C bên phải (phía cửa lên).
    const a1 = seats.find((s) => s.code === 'A1')!;
    const c1 = seats.find((s) => s.code === 'C1')!;
    expect(a1.col).toBeLessThan(c1.col);
    expect(bed.definition.floors[0]!.rows[0]).toBe('TX . _ . CUA');
  });

  it('LIMO24 has A1–A12 downstairs and B1–B12 upstairs, every room for up to 2 people', () => {
    const limo = LIBRARY_LAYOUTS.find((l) => l.code === 'LIMO24')!;
    const seats = parseLayout(limo.definition, limo.kind).seats;
    expect(seats.filter((s) => s.floor === '1').map((s) => s.code).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `A${i + 1}`).sort(),
    );
    expect(new Set(seats.map((s) => s.maxOccupancy))).toEqual(new Set([2]));
  });
});
