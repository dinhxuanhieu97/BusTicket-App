import type { LayoutFloor, PublicSeatStatus, SeatMap } from "@/types/api.types";

/** Ô không phải chỗ (apps/api/src/seat-layouts/layout-parser.ts MARKER_TOKENS). */
export const MARKER_LABELS: Record<string, string> = { ".": "", _: "", TX: "Tài xế", CUA: "Cửa", WC: "WC" };

export type SeatCell = {
  kind: "seat";
  code: string;
  status: PublicSeatStatus;
  maxOccupancy: number;
};
export type MarkerCell = { kind: "marker"; token: string; label: string };
export type Cell = SeatCell | MarkerCell;

export interface FloorGrid {
  code: string;
  label: string;
  columns: number;
  rows: Cell[][];
}

/**
 * Dựng lưới hiển thị cho một tầng từ định nghĩa sơ đồ + trạng thái chỗ.
 * Mã chỗ có trong định nghĩa nhưng máy chủ không trả trạng thái → coi như không bán (an toàn hơn coi là trống).
 */
export function buildFloorGrid(floor: LayoutFloor, seats: SeatMap["seats"]): FloorGrid {
  const byCode = new Map(seats.map((s) => [s.code, s]));
  const tokenRows = floor.rows.map((r) => r.trim().split(/\s+/).filter(Boolean));
  const columns = Math.max(1, ...tokenRows.map((r) => r.length));
  const rows = tokenRows.map((tokens) => {
    const cells: Cell[] = tokens.map((token) => {
      if (token in MARKER_LABELS) return { kind: "marker", token, label: MARKER_LABELS[token] };
      const seat = byCode.get(token);
      return {
        kind: "seat",
        code: token,
        status: seat?.status ?? "BLOCKED",
        maxOccupancy: seat?.maxOccupancy ?? 1,
      };
    });
    while (cells.length < columns) cells.push({ kind: "marker", token: "_", label: "" });
    return cells;
  });
  return { code: floor.code, label: floor.label, columns, rows };
}

export function buildGrids(map: SeatMap): FloorGrid[] {
  return map.layout.floors.map((f) => buildFloorGrid(f, map.seats));
}
