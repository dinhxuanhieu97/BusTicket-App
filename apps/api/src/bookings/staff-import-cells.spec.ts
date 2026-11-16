import { phoneFromCell, wholeNumber } from './staff-bookings.service';

describe('import cell parsing', () => {
  it('reads whole VND amounts and rejects decimals', () => {
    expect(wholeNumber(840000)).toBe(840000);
    expect(wholeNumber('840.000')).toBe(840000);
    expect(wholeNumber('840,000đ')).toBe(840000);
    expect(wholeNumber('1.200.000 VND')).toBe(1200000);
    expect(wholeNumber(' ')).toBeUndefined();
    expect(wholeNumber(null)).toBeUndefined();
    for (const bad of ['5000.00', '1.234,5', '12.34', '1,2', '-5', 'abc', 1.5]) expect(wholeNumber(bad)).toBeNaN();
  });

  it('restores the leading zero Excel drops and strips separators', () => {
    expect(phoneFromCell(912345678)).toBe('0912345678');
    expect(phoneFromCell('912 345 678')).toBe('0912345678');
    expect(phoneFromCell('912.345.678')).toBe('0912345678');
    expect(phoneFromCell('0912-345-678')).toBe('0912345678');
    expect(phoneFromCell('(+84) 912345678')).toBe('+84912345678');
  });
});
