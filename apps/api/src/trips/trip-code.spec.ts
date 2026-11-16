import { pickTripCode, tripCodeBase } from './trip-code';

describe('trip code', () => {
  it('uses operator code, Vietnam date (ddmmyy) and route code without dashes', () => {
    // 11/11/2026 17:30 giờ VN = 10:30 UTC cùng ngày
    expect(tripCodeBase('PN', new Date('2026-11-11T10:30:00Z'), 'HA-SG')).toBe('PN111126-HASG');
  });

  it('uses the Vietnam calendar day, not the UTC day, near midnight', () => {
    // 00:30 ngày 12/11 giờ VN = 17:30 ngày 11/11 UTC
    expect(tripCodeBase('PN', new Date('2026-11-11T17:30:00Z'), 'SG-HA')).toBe('PN121126-SGHA');
  });

  it('keeps the base when free and adds -2, -3 when taken', () => {
    expect(pickTripCode('PN111126-HASG', new Set())).toBe('PN111126-HASG');
    expect(pickTripCode('PN111126-HASG', new Set(['PN111126-HASG']))).toBe('PN111126-HASG-2');
    expect(pickTripCode('PN111126-HASG', new Set(['PN111126-HASG', 'PN111126-HASG-2']))).toBe('PN111126-HASG-3');
  });

  it('does not treat other routes or days as collisions', () => {
    expect(pickTripCode('PN111126-HASG', new Set(['PN111126-SGHA', 'PN121126-HASG']))).toBe('PN111126-HASG');
  });
});
