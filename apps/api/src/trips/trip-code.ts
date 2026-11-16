/**
 * Mã chuyến hiển thị: `<mã nhà xe><ddmmyy theo giờ VN>-<mã tuyến không gạch>`, ví dụ `PN111126-HASG`.
 * Trùng trong cùng nhà xe thì thêm `-2`, `-3`... (xem `pickTripCode`).
 */
export function tripCodeBase(operatorCode: string, departAt: Date, routeCode: string): string {
  const vn = new Date(departAt.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dd = pad(vn.getUTCDate());
  const mm = pad(vn.getUTCMonth() + 1);
  const yy = pad(vn.getUTCFullYear() % 100);
  const route = routeCode.replace(/[^A-Z0-9]/g, '');
  return `${operatorCode}${dd}${mm}${yy}-${route}`;
}

/** Chọn mã chưa bị dùng: `base`, rồi `base-2`, `base-3`... `taken` là các mã đã có cùng tiền tố. */
export function pickTripCode(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
