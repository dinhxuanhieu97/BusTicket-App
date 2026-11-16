import { boardedCell, parseTicketQr } from './passenger-ops.service';

describe('boardedCell', () => {
  it('reads the "Đã lên xe" column leniently', () => {
    for (const v of ['x', 'X', ' x ', 'Có', 'co', '1', 'đã', '✓', true, 1]) expect(boardedCell(v)).toBe(true);
    for (const v of ['', '  ', 'không', 'chưa', '0', '-', null, undefined, false, 0]) expect(boardedCell(v)).toBeNull();
    for (const v of ['maybe', '2', 2, 'xx']) expect(boardedCell(v)).toBeUndefined();
  });
});

describe('parseTicketQr', () => {
  const proof = 'A'.repeat(43);
  it('extracts code and proof from the verify URL on the ticket', () => {
    expect(parseTicketQr(`https://api.x.vn/api/v1/tickets/PNAB12CD/verify?proof=${proof}`)).toEqual({ code: 'PNAB12CD', proof });
    expect(parseTicketQr(` https://api.x.vn/api/v1/tickets/PNAB12CD/verify?a=1&proof=${proof}&b=2 `)).toEqual({ code: 'PNAB12CD', proof });
  });
  it('rejects anything else', () => {
    expect(parseTicketQr('PNAB12CD')).toBeNull();
    expect(parseTicketQr(`https://api.x.vn/api/v1/tickets/pnab12cd/verify?proof=${proof}`)).toBeNull();
    expect(parseTicketQr(`https://api.x.vn/api/v1/tickets/PNAB12CD/verify?proof=${proof}X`)).toBeNull();
  });
});
