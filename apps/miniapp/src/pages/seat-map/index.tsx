import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Spinner, useSnackbar } from "zmp-ui";
import { copy } from "@/constants/copy";
import { Tabs } from "@/components/common/tabs";
import { EmptyState } from "@/components/booking/empty-state";
import { SeatGrid, SeatLegend } from "@/components/booking/seat-grid";
import { Stepper } from "@/components/booking/stepper";
import { useSeatMap } from "@/services/trip/trip.queries";
import { useBookingDraft } from "@/stores/booking-draft.store";
import { buildGrids, type SeatCell } from "@/utils/seat-layout";
import {
  MAX_INFANTS_PER_UNIT,
  estimateTotal,
  reconcileSelection,
  selectedCodes,
  setInfants,
  setOccupancy,
  toggleSeat,
  unitPrice,
} from "@/utils/seat-selection";
import { formatCurrency } from "@/utils/format";
import { formatVnDate, formatVnTime } from "@/utils/time";

export default function SeatMapPage() {
  const { tripId = "" } = useParams();
  const navigate = useNavigate();
  const { openSnackbar } = useSnackbar();
  const { data: map, isLoading, isError, refetch } = useSeatMap(tripId);
  const openTrip = useBookingDraft((s) => s.openTrip);
  const selection = useBookingDraft((s) => s.selection);
  const setSelection = useBookingDraft((s) => s.setSelection);
  const [floor, setFloor] = useState<string>("");

  useEffect(() => openTrip(tripId), [openTrip, tripId]);

  // Mỗi lần sơ đồ tải lại: bỏ những chỗ vừa bị người khác giữ.
  useEffect(() => {
    if (!map) return;
    const current = useBookingDraft.getState().selection;
    const cap = Math.min(map.booking.childPolicy?.maxPerUnit ?? MAX_INFANTS_PER_UNIT, MAX_INFANTS_PER_UNIT);
    const { selection: next, removed } = reconcileSelection(current, map.seats, cap);
    if (next !== current) setSelection(next);
    if (removed.length) openSnackbar({ text: `${copy.seats.refreshed} (${removed.join(", ")})`, type: "warning" });
  }, [map, setSelection, openSnackbar]);

  const grids = useMemo(() => (map ? buildGrids(map) : []), [map]);
  const activeFloor = grids.find((g) => g.code === floor) ?? grids[0];
  const selected = useMemo(() => new Set(Object.keys(selection)), [selection]);
  const seatByCode = useMemo(() => new Map((map?.seats ?? []).map((s) => [s.code, s])), [map]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (isError || !map) {
    return <EmptyState title={copy.common.error} actionLabel={copy.common.retry} onAction={() => void refetch()} />;
  }

  const unit = map.layout.unit;
  const codes = selectedCodes(selection);
  const child = map.booking.childPolicy;
  const estimate = estimateTotal(selection, map.seats, map.fares, child);
  const infantMax = Math.min(child?.maxPerUnit ?? MAX_INFANTS_PER_UNIT, MAX_INFANTS_PER_UNIT);
  const infantLabel = child ? copy.seats.infantsLabel(child.freeUnderAge) : copy.seats.infants;

  const onSeatPress = (seat: SeatCell) => {
    const result = toggleSeat(selection, seat, map.booking.maxUnitsPerBooking);
    if (result.error === "MAX_UNITS") {
      openSnackbar({ text: copy.seats.maxUnits(map.booking.maxUnitsPerBooking), type: "warning" });
      return;
    }
    if (result.selection !== selection) setSelection(result.selection);
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-3 px-4 pb-40 pt-2">
        <div className="flex flex-col gap-1">
          <div className="text-large-sb">{map.trip.name}</div>
          <div className="text-xxsmall text-text-secondary">
            {formatVnTime(map.trip.departAt)} · {formatVnDate(map.trip.departAt)} · {map.layout.name} · {map.vehicle.name}
          </div>
        </div>

        {!map.trip.onSale && (
          <div className="rounded-lg bg-red100 px-3 py-2 text-xxsmall text-danger">{copy.seats.notOnSale}</div>
        )}

        {grids.length > 1 && (
          <Tabs
            tabs={grids.map((g) => ({
              value: g.code,
              label: g.label,
              badge: codes.filter((c) => seatByCode.get(c)?.floor === g.code).length || undefined,
            }))}
            activeTab={activeFloor.code}
            onChange={setFloor}
            fullWidth
            className="bg-neutral100"
          />
        )}

        {activeFloor && <SeatGrid grid={activeFloor} selected={selected} onSeatPress={onSeatPress} />}
        <SeatLegend />

        {codes.length > 0 && (
          <div className="flex flex-col gap-3 rounded-xl bg-white">
            {codes.map((code) => {
              const seat = seatByCode.get(code)!;
              const unitSel = selection[code];
              const price = seat ? unitPrice(map.fares, seat.floor, unitSel.occupancy) : null;
              return (
                <div key={code} className="flex flex-col gap-2 border-b border-divider01 pb-3 last:border-b-0">
                  <div className="flex items-center justify-between">
                    <span className="text-normal-sb capitalize">
                      {unit} {code}
                    </span>
                    <span className="text-small">{price === null ? "—" : formatCurrency(price)}</span>
                  </div>
                  {seat.maxOccupancy > 1 && (
                    <div className="flex items-center justify-between text-xxsmall text-text-secondary">
                      {copy.seats.occupancy}
                      <Tabs
                        tabs={[
                          { value: "1", label: copy.seats.single },
                          { value: "2", label: copy.seats.double },
                        ]}
                        activeTab={String(unitSel.occupancy)}
                        onChange={(v) => setSelection(setOccupancy(selection, code, Number(v), seat.maxOccupancy))}
                        className="bg-neutral100"
                      />
                    </div>
                  )}
                  {infantMax > 0 &&
                    (unitSel.occupancy === 1 ? (
                      <div className="flex items-center justify-between text-xxsmall text-text-secondary">
                        {infantLabel}
                        <Stepper
                          label={infantLabel}
                          value={unitSel.infantCount}
                          min={0}
                          max={infantMax}
                          onChange={(n) => setSelection(setInfants(selection, code, n, infantMax))}
                        />
                      </div>
                    ) : (
                      <div className="text-xxxsmall text-text-secondary">{copy.seats.infantsSingleOnly}</div>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 flex flex-col gap-2 border-t border-divider01 bg-white px-4 pb-5 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xxsmall text-text-secondary">{copy.seats.selectedCount(codes.length, unit)}</span>
          <span className="text-large-sb text-primary">
            {estimate === null || codes.length === 0 ? "—" : formatCurrency(estimate)}
          </span>
        </div>
        {codes.length > 0 && <div className="text-xxxsmall text-text-secondary">{child ? copy.seats.estimateHint : copy.seats.estimateHintNoChildPolicy}</div>}
        <Button
          fullWidth
          disabled={codes.length === 0 || !map.trip.onSale}
          onClick={() => navigate("/checkout")}
        >
          {copy.common.continue}
        </Button>
      </div>
    </div>
  );
}
