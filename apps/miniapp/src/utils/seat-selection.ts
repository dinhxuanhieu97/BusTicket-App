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

/** Đổi số người của một phòng (1 hoặc 2), không vượt sức chứa. */
export function setOccupancy(selection: Selection, code: string, occupancy: number, maxOccupancy: number): Selection {
  const unit = selection[code];
  if (!unit) return selection;
  const next = Math.min(Math.max(1, Math.floor(occupancy)), Math.max(1, maxOccupancy));
  return { ...selection, [code]: { ...unit, occupancy: next } };
}

export function setInfants(selection: Selection, code: string, infantCount: number): Selection {
  const unit = selection[code];
  if (!unit) return selection;
  const next = Math.min(Math.max(0, Math.floor(infantCount)), MAX_INFANTS_PER_UNIT);
  return { ...selection, [code]: { ...unit, infantCount: next } };
}

/**
 * Sau khi tải lại sơ đồ: bỏ những chỗ không còn trống (người khác vừa giữ) và chỗ không còn trong sơ đồ.
 * Trả về danh sách mã bị bỏ để báo cho khách.
 */
export function reconcileSelection(selection: Selection, seats: SeatMap["seats"]): { selection: Selection; removed: string[] } {
  const byCode = new Map(seats.map((s) => [s.code, s]));
  const next: Selection = {};
  const removed: string[] = [];
  for (const [code, unit] of Object.entries(selection)) {
    const seat = byCode.get(code);
    if (seat && seat.status === "AVAILABLE") {
      next[code] = { ...unit, occupancy: Math.min(unit.occupancy, seat.maxOccupancy) };
    } else removed.push(code);
  }
  return { selection: removed.length || hasClampedOccupancy(selection, next) ? next : selection, removed };
}

function hasClampedOccupancy(a: Selection, b: Selection): boolean {
  return Object.keys(b).some((k) => a[k]?.occupancy !== b[k].occupancy);
}

/** Giá một chỗ theo (tầng, số người); null khi nhà xe chưa đặt giá cho tổ hợp đó. */
export function unitPrice(fares: Fare[], floor: string, occupancy: number): number | null {
  return fares.find((f) => f.floor === floor && f.occupancy === occupancy)?.price ?? null;
}

/**
 * Tạm tính (chưa gồm giá trẻ em vì API công khai chưa trả chính sách trẻ em).
 * Giá chính thức là `totalAmount` máy chủ trả khi giữ chỗ. Trả null nếu thiếu giá của một chỗ nào đó.
 */
export function estimateTotal(selection: Selection, seats: SeatMap["seats"], fares: Fare[]): number | null {
  const byCode = new Map(seats.map((s) => [s.code, s]));
  let total = 0;
  for (const [code, unit] of Object.entries(selection)) {
    const seat = byCode.get(code);
    if (!seat) return null;
    const price = unitPrice(fares, seat.floor, unit.occupancy);
    if (price === null) return null;
    total += price;
  }
  return total;
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
