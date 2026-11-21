import { foldVn, likeEscape, reportRange, searchTerms, vnDates } from './report-query';

describe('report range', () => {
  it('uses Vietnam midnight bounds with an exclusive end and lists every day', () => {
    const r = reportRange({ from: '2028-02-28', to: '2028-03-01' });
    expect(r.start.toISOString()).toBe('2028-02-27T17:00:00.000Z');
    expect(r.end.toISOString()).toBe('2028-02-29T17:00:00.000Z');
    expect(r.days).toBe(2);
    expect(vnDates(r.from, r.days)).toEqual(['2028-02-28', '2028-02-29']);
    expect(reportRange({ from: '2027-01-01', to: '2028-01-02' }).days).toBe(366);
  });
  it.each([
    { from: '2027-01-01', to: '2027-01-01' },
    { from: '2027-01-02', to: '2027-01-01' },
    { from: '2027-01-01', to: '2028-01-03' },
    { from: '2027-02-29', to: '2027-03-01' },
    { from: '2027-01-01' },
    { from: '2027-01-01', to: '2027-01-02', route: 'X' },
  ])('rejects %j', (input) => expect(() => reportRange(input)).toThrow());
});

describe('search terms', () => {
  it('extracts the phone body from local, international and partial numbers', () => {
    expect(searchTerms({ q: '0912 345 678' }).phone).toBe('912345678');
    expect(searchTerms({ q: '+84 912 345 678' }).phone).toBe('912345678');
    expect(searchTerms({ q: '84912345678' }).phone).toBe('912345678');
    expect(searchTerms({ q: '8491' }).phone).toBe('8491');
    expect(searchTerms({ q: '091' }).phone).toBeNull();
    expect(searchTerms({ q: 'Mai 0912' }).phone).toBeNull();
  });
  it('upper-cases codes, trims, and bounds the length', () => {
    expect(searchTerms({ q: '  pn abc  ' })).toEqual({ q: 'pn abc', code: 'PNABC', phone: null, fold: 'pn abc' });
    expect(() => searchTerms({ q: ' a ' })).toThrow();
    expect(() => searchTerms({ q: 'x'.repeat(65) })).toThrow();
    expect(() => searchTerms({})).toThrow();
  });
  it('escapes LIKE wildcards', () => {
    expect(likeEscape('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});

describe('foldVn (GB3)', () => {
  it.each([
    ['Nguyễn Văn Đức', 'nguyen van duc'],
    ['TRẦN THỊ MAI', 'tran thi mai'],
    ['Phạm Ngọc Ánh', 'pham ngoc anh'],
    ['Lê Hữu Phước', 'le huu phuoc'],
    ['Võ Thị Ỷ', 'vo thi y'],
    ['xe giường 19:30', 'xe giuong 19:30'],
  ])('folds %s to %s', (input, out) => expect(foldVn(input)).toBe(out));
  it('handles decomposed (NFD) input and leaves plain text and LIKE characters alone', () => {
    expect(foldVn('Nguyễn'.normalize('NFD'))).toBe('nguyen');
    expect(foldVn('50%_off')).toBe('50%_off');
    expect(searchTerms({ q: '  Đỗ Mạnh ' }).fold).toBe('do manh');
  });
});
