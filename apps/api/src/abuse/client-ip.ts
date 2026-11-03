import { isIP } from 'node:net';

/**
 * Khóa đại diện cho một "nguồn" khi giới hạn tần suất:
 * - IPv4 và IPv4 nhúng trong IPv6 (`::ffff:1.2.3.4`) → cùng khóa `v4:1.2.3.4`.
 * - IPv6 → gom theo /64 (`v6:2001:0db8:0001:0002::/64`), vì một thuê bao thường được cấp cả /64
 *   và có thể đổi địa chỉ cho mỗi yêu cầu.
 */
export function clientKey(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const raw = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped && isIP(mapped[1]!) === 4) return `v4:${mapped[1]}`;
  if (isIP(raw) === 4) return `v4:${raw}`;
  if (isIP(raw) === 6) {
    const groups = expandIpv6(raw);
    if (groups) return `v6:${groups.slice(0, 4).join(':')}::/64`;
  }
  return `raw:${raw}`;
}

/** Mở rộng IPv6 thành 8 nhóm 4 chữ số hex. Địa chỉ có phần IPv4 ở cuối được đổi sang 2 nhóm hex. */
export function expandIpv6(addr: string): string[] | null {
  let a = addr.split('%')[0]!; // bỏ zone id
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const [b0, b1, b2, b3] = v4.slice(1).map(Number) as [number, number, number, number];
    a = a.slice(0, v4.index) + ((b0 << 8) | b1).toString(16) + ':' + ((b2 << 8) | b3).toString(16);
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

/**
 * Đọc biến TRUST_PROXY cho Express: số tầng proxy (`1`), `true`/`false`, hoặc danh sách
 * `loopback, 10.0.0.0/8`. Không đặt → không tin X-Forwarded-For.
 */
export function parseTrustProxy(value: string | undefined): boolean | number | string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}
