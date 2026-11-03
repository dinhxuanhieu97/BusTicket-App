import { clientKey, expandIpv6, parseTrustProxy } from './client-ip';

describe('clientKey', () => {
  it('maps IPv4 and IPv4-mapped IPv6 to the same key', () => {
    expect(clientKey('1.2.3.4')).toBe('v4:1.2.3.4');
    expect(clientKey('::ffff:1.2.3.4')).toBe('v4:1.2.3.4');
    expect(clientKey('::FFFF:1.2.3.4')).toBe('v4:1.2.3.4');
  });

  it('groups IPv6 addresses by /64 whatever their notation', () => {
    const a = clientKey('2001:db8:1:2::1');
    expect(a).toBe('v6:2001:0db8:0001:0002::/64');
    expect(clientKey('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff')).toBe(a);
    expect(clientKey('2001:db8:1:2:0:0:0:abcd')).toBe(a);
    expect(clientKey('2001:db8:1:3::1')).not.toBe(a);
    expect(clientKey('fe80::1%eth0')).toBe('v6:fe80:0000:0000:0000::/64');
  });

  it('returns undefined for no address and a raw key for garbage', () => {
    expect(clientKey(undefined)).toBeUndefined();
    expect(clientKey('')).toBeUndefined();
    expect(clientKey('not-an-ip')).toBe('raw:not-an-ip');
  });
});

describe('expandIpv6', () => {
  it.each([
    ['::1', '0000:0000:0000:0000:0000:0000:0000:0001'],
    ['::', '0000:0000:0000:0000:0000:0000:0000:0000'],
    ['2001:db8::', '2001:0db8:0000:0000:0000:0000:0000:0000'],
    ['64:ff9b::1.2.3.4', '0064:ff9b:0000:0000:0000:0000:0102:0304'],
  ])('expands %s', (input, expected) => {
    expect(expandIpv6(input)!.join(':')).toBe(expected);
  });

  it.each(['1::2::3', '1:2:3:4:5:6:7:8:9', '12345::1', 'g::1'])('rejects %s', (input) => {
    expect(expandIpv6(input)).toBeNull();
  });
});

describe('parseTrustProxy', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['1', 1],
    ['2', 2],
    ['true', true],
    ['false', false],
    ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
  ])('parses %p', (input, expected) => {
    expect(parseTrustProxy(input as string | undefined)).toBe(expected);
  });
});
