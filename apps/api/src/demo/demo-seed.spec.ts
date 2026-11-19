import { saigonSide } from './demo-seed';

describe('saigonSide', () => {
  it('uses route codes first, whichever direction is listed first', () => {
    expect(saigonSide([
      { code: 'HA-SG', origin: 'Bến xe Hoài Ân', destination: 'Bến xe An Sương' },
      { code: 'SG-HA', origin: 'Bến xe An Sương', destination: 'Bến xe Hoài Ân' },
    ])).toBe('Bến xe An Sương');
  });

  it('falls back to the place name, then to TP.HCM', () => {
    expect(saigonSide([{ code: 'HA-HCM', origin: 'Hoài Ân', destination: 'TP.HCM' }])).toBe('TP.HCM');
    expect(saigonSide([{ code: 'X-Y', origin: 'Sài Gòn', destination: 'Đà Lạt' }])).toBe('Sài Gòn');
    expect(saigonSide([{ code: 'A-B', origin: 'Đà Nẵng', destination: 'Huế' }])).toBe('TP.HCM');
    expect(saigonSide([])).toBe('TP.HCM');
  });
});
