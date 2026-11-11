import type { CreateHoldRequest, Fare, SeatMap } from "@/types/api.types";

export interface SelectedUnit {
  occupancy: number;
  infantCount: number;
}

/** Chỗ đang chọn, theo mã chỗ. */
export type Selection = Record<string, SelectedUnit>;

/** Giới hạn trẻ em kèm mỗi chỗ theo schema máy chủ (createHoldSchema). Chính sách nhà xe có thể thấp hơn; máy chủ kiểm tra. */
export const MAX_INFANTS_PER_UNIT = 2;

export type ToggleResult = { selection: Selection; error?: "MAX_UNITS" | "NOT_AVAILABLE" };

/** Chọn/bỏ chọn một chỗ. Chỉ chọn được chỗ đang trống, không quá `maxUnits` chỗ mỗi đơn. */
export function toggleSeat(
  selection: Selection,
  seat: { code: string; status: string },
  maxUnits: number,
): ToggleResult {
  if (selection[seat.code]) {
    const { [seat.code]: _removed, ...rest } = selection;
    return { selection: rest };
  }
  if (seat.status !== "AVAILABLE") return { selection, error: "NOT_AVAILABLE" };
  if (Object.keys(selection).length >= maxUnits) return { selection, error: "MAX_UNITS" };
  return { selection: { ...selection, [seat.code]: { occupancy: 1, infantCount: 0 } } };
}

/**
 * Đổi số người của một phòng (1 hoặc 2), không vượt sức chứa.
 * Trẻ em đi kèm chỉ áp dụng cho phòng đơn → chuyển sang phòng đôi thì bỏ trẻ em.
 */
export function setOccupancy(selection: Selection, code: string, occupancy: number, maxOccupancy: number): Selection {
  const unit = selection[code];
  if (!unit) return selection;
  const next = Math.min(Math.max(1, Math.floor(occupancy)), Math.max(1, maxOccupancy));
  return { ...selection, [code]: { occupancy: next, infantCount: next > 1 ? 0 : unit.infantCount } };
}

/** Số trẻ em đi kèm: chỉ cho phòng/chỗ 1 người, tối đa theo chính sách nhà xe (`maxPerUnit`). */
export function setInfants(selection: Selection, code: string, infantCount: number, maxPerUnit = MAX_INFANTS_PER_UNIT): Selection {
  const unit = selection[code];
  if (!unit) return selection;
  const cap = unit.occupancy > 1 ? 0 : Math.min(maxPerUnit, MAX_INFANTS_PER_UNIT);
  const next = Math.min(Math.max(0, Math.floor(infantCount)), cap);
  return { ...selection, [code]: { ...unit, infantCount: next } };
}

/**
 * Sau khi tải lại sơ đồ: bỏ những chỗ không còn trống (người khác vừa giữ) và chỗ không còn trong sơ đồ.
 * Trả về danh sách mã bị bỏ để báo cho khách.
 */
export function reconcileSelection(
  selection: Selection,
  seats: SeatMap["seats"],
  infantMax = MAX_INFANTS_PER_UNIT,
): { selection: Selection; removed: string[] } {
  const byCode = new Map(seats.map((s) => [s.code, s]));
  const next: Selection = {};
  const removed: string[] = [];
  for (const [code, unit] of Object.entries(selection)) {
    const seat = byCode.get(code);
    if (seat && seat.status === "AVAILABLE") {
      // Sức chứa hoặc giới hạn trẻ em của nhà xe có thể đổi giữa chừng: kẹp lại để không gửi yêu cầu sai.
      const occupancy = Math.min(unit.occupancy, seat.maxOccupancy);
      const infantCount = occupancy > 1 ? 0 : Math.min(unit.infantCount, Math.max(0, infantMax));
      next[code] = { occupancy, infantCount };
    } else removed.push(code);
  }
  return { selection: removed.length || hasClampedOccupancy(selection, next) ? next : selection, removed };
}

function hasClampedOccupancy(a: Selection, b: Selection): boolean {
  return Object.keys(b).some((k) => a[k]?.occupancy !== b[k].occupancy || a[k]?.infantCount !== b[k].infantCount);
}

/** Giá một chỗ theo (tầng, số người); null khi nhà xe chưa đặt giá cho tổ hợp đó. */
export function unitPrice(fares: Fare[], floor: string, occupancy: number): number | null {
  return fares.find((f) => f.floor === floor && f.occupancy === occupancy)?.price ?? null;
}

/**
 * Tạm tính, gồm giá trẻ em nếu có chính sách trẻ em của nhà xe.
 * Giá chính thức là `totalAmount` máy chủ trả khi giữ chỗ. Trả null nếu thiếu giá của một chỗ nào đó.
 */
export function estimateTotal(
  selection: Selection,
  seats: SeatMap["seats"],
  fares: Fare[],
  childPolicy?: { price: number },
): number | null {
  const byCode = new Map(seats.map((s) => [s.code, s]));
  let total = 0;
  for (const [code, unit] of Object.entries(selection)) {
    const seat = byCode.get(code);
    if (!seat) return null;
    const price = unitPrice(fares, seat.floor, unit.occupancy);
    if (price === null) return null;
    total += price + (childPolicy ? childPolicy.price * unit.infantCount : 0);
  }
  return total;
}

/** Dự tính cọc từng chỗ theo chính sách của nhà xe. */
export function unitDeposit(map: SeatMap, seatCode: string, unit: SelectedUnit): number | null {
  const fixed = map.booking.fixedDeposit;
  const seat = map.seats.find((s) => s.code === seatCode);
  if (!fixed || !seat) return null;
  const price = unitPrice(map.fares, seat.floor, unit.occupancy);
  if (price === null) return null;
  const lineTotal = price + (map.booking.childPolicy?.price ?? 0) * unit.infantCount;
  return Math.min(lineTotal, unit.occupancy === 1 ? fixed.single : fixed.double);
}

/** Tính cọc cho cả đơn, gồm hai lượt khi đặt khứ hồi. */
export function estimateDeposit(
  first: { selection: Selection; map: SeatMap },
  second?: { selection: Selection; map: SeatMap },
): number | null {
  const legs = second ? [first, second] : [first];
  if (first.map.booking.fixedDeposit) {
    let sum = 0;
    for (const { selection, map } of legs) {
      for (const [code, unit] of Object.entries(selection)) {
        const deposit = unitDeposit(map, code, unit);
        if (deposit === null) return null;
        sum += deposit;
      }
    }
    return sum;
  }

  const percent = first.map.booking.depositPercent;
  if (percent === undefined) return null;
  let total = 0;
  for (const { selection, map } of legs) {
    const legTotal = estimateTotal(selection, map.seats, map.fares, map.booking.childPolicy);
    if (legTotal === null) return null;
    total += legTotal;
  }
  return Math.min(total, Math.ceil(total * percent / 100 / 1000) * 1000);
}

const codeOrder = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** Dòng gửi lên `POST /bookings`, sắp xếp ổn định để cùng một lựa chọn luôn ra cùng một yêu cầu. */
export function toHoldItems(selection: Selection): CreateHoldRequest["items"] {
  return Object.keys(selection)
    .sort(codeOrder)
    .map((seatCode) => ({ seatCode, occupancy: selection[seatCode].occupancy, infantCount: selection[seatCode].infantCount }));
}

export function selectedCodes(selection: Selection): string[] {
  return Object.keys(selection).sort(codeOrder);
}
