import type { FloorGrid, SeatCell } from "@/utils/seat-layout";
import { cn } from "@/utils/cn";
import { copy } from "@/constants/copy";

/** Màu theo trạng thái, giống bản mẫu prototype/so-do-cho.html: trống / đang chọn / đang giữ / đã đặt / không bán. */
const SEAT_STYLE = {
  AVAILABLE: "border-primary/40 bg-white text-text-primary",
  SELECTED: "border-primary bg-primary text-white",
  HELD: "border-yellow500 bg-yellow100 text-yellow700",
  BOOKED: "border-neutral100 bg-neutral100 text-text-disabled",
  BLOCKED: "border-dashed border-neutral300 bg-white text-text-disabled",
} as const;

interface SeatGridProps {
  grid: FloorGrid;
  selected: ReadonlySet<string>;
  onSeatPress: (seat: SeatCell) => void;
}

export function SeatGrid({ grid, selected, onSeatPress }: SeatGridProps) {
  return (
    <div
      className="grid gap-2 rounded-xl bg-elevation-01 p-3"
      style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))` }}
    >
      {grid.rows.flatMap((row, r) =>
        row.map((cell, c) => {
          const key = `${r}-${c}`;
          if (cell.kind === "marker") {
            return (
              <div key={key} className="flex h-11 items-center justify-center text-xxxsmall text-text-disabled">
                {cell.label}
              </div>
            );
          }
          const isSelected = selected.has(cell.code);
          const style = isSelected ? SEAT_STYLE.SELECTED : SEAT_STYLE[cell.status];
          const pressable = isSelected || cell.status === "AVAILABLE";
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${cell.code} ${statusLabel(cell.status)}`}
              disabled={!pressable}
              onClick={() => onSeatPress(cell)}
              className={cn("flex h-11 items-center justify-center rounded-lg border text-xxsmall-m", style)}
            >
              {cell.code}
            </button>
          );
        }),
      )}
    </div>
  );
}

function statusLabel(status: SeatCell["status"]): string {
  return {
    AVAILABLE: copy.seats.legendAvailable,
    HELD: copy.seats.legendHeld,
    BOOKED: copy.seats.legendBooked,
    BLOCKED: copy.seats.legendBlocked,
  }[status];
}

export function SeatLegend() {
  const items: [keyof typeof SEAT_STYLE, string][] = [
    ["AVAILABLE", copy.seats.legendAvailable],
    ["SELECTED", copy.seats.legendSelected],
    ["HELD", copy.seats.legendHeld],
    ["BOOKED", copy.seats.legendBooked],
    ["BLOCKED", copy.seats.legendBlocked],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {items.map(([k, label]) => (
        <div key={k} className="flex items-center gap-1.5 text-xxsmall text-text-secondary">
          <span className={cn("inline-block size-4 rounded border", SEAT_STYLE[k])} />
          {label}
        </div>
      ))}
    </div>
  );
}
