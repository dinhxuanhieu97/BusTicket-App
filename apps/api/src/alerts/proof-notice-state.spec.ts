import { proofNoticeState } from './staff-alerts.service';

describe('proofNoticeState', () => {
  const now = new Date('2026-11-26T10:00:00Z');
  const later = new Date('2026-11-26T11:00:00Z');
  const earlier = new Date('2026-11-26T09:00:00Z');

  it('holding with time left is pending review', () => {
    expect(proofNoticeState('HOLDING', later, now)).toBe('PENDING');
  });
  it('holding past its release time counts as expired', () => {
    expect(proofNoticeState('HOLDING', earlier, now)).toBe('EXPIRED');
    expect(proofNoticeState('HOLDING', null, now)).toBe('EXPIRED');
  });
  it('maps final statuses', () => {
    expect(proofNoticeState('EXPIRED', null, now)).toBe('EXPIRED');
    expect(proofNoticeState('CANCELLED', null, now)).toBe('CANCELLED');
    expect(proofNoticeState('CONFIRMED', null, now)).toBe('CONFIRMED');
  });
});
