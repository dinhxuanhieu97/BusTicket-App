import { useEffect, useMemo, useState } from "react";
import {
  Navigate,
  useSearchParams,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Button, Spinner, useSnackbar } from "zmp-ui";
import { copy } from "@/constants/copy";
import { Tabs } from "@/components/common/tabs";
import { EmptyState } from "@/components/booking/empty-state";
import { SeatGrid, SeatLegend } from "@/components/booking/seat-grid";
import { Stepper } from "@/components/booking/stepper";
import { useSeatMap } from "@/services/trip/trip.queries";
import { useTripSearch } from "@/stores/trip-search.store";
import { useBookingDraft } from "@/stores/booking-draft.store";
import { buildGrids, type SeatCell } from "@/utils/seat-layout";
import {
  MAX_INFANTS_PER_UNIT,
  estimateDeposit,
  reconcileSelection,
  selectedCodes,
  setInfants,
  setOccupancy,
  toggleSeat,
  unitDeposit,
} from "@/utils/seat-selection";
import { formatCurrency } from "@/utils/format";
import { formatVnDate, formatVnTime } from "@/utils/time";

export default function SeatMapPage() {
  const { tripId = "" } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const pair = useBookingDraft((s) => s.pair);
  const outbound = pair?.[0].id === tripId;
  const requested = useTripSearch((s) => s.search);
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
    const { selection: next, removed } = reconcileSelection(current, map.seats);
    if (next !== current) setSelection(next);
    if (removed.length)
      openSnackbar({
        text: `${copy.seats.refreshed} (${removed.join(", ")})`,
        type: "warning",
      });
  }, [map, setSelection, openSnackbar]);

  const grids = useMemo(() => (map ? buildGrids(map) : []), [map]);
  const activeFloor = grids.find((g) => g.code === floor) ?? grids[0];
  const selected = useMemo(() => new Set(Object.keys(selection)), [selection]);
  const seatByCode = useMemo(
    () => new Map((map?.seats ?? []).map((s) => [s.code, s])),
    [map],
  );

  if (params.has("roundTrip") && !pair?.some((t) => t.id === tripId))
    return <Navigate to="/" replace />;
  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (isError || !map) {
    return (
      <EmptyState
        title={copy.common.error}
        actionLabel={copy.common.retry}
        onAction={() => void refetch()}
      />
    );
  }

  const unit = map.layout.unit;
  const codes = selectedCodes(selection);
  const estimate = estimateDeposit({ selection, map });

  const onSeatPress = (seat: SeatCell) => {
    const result = toggleSeat(selection, seat, map.booking.maxUnitsPerBooking);
    if (result.error === "MAX_UNITS") {
      openSnackbar({
        text: copy.seats.maxUnits(map.booking.maxUnitsPerBooking),
        type: "warning",
      });
      return;
    }
    if (result.selection !== selection) setSelection(result.selection);
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-3 px-4 pb-40 pt-2">
        <div className="flex flex-col gap-1">
          <div className="text-large-sb">
            {pair && (outbound ? "Ghế lượt đi · " : "Ghế lượt về · ")}
            {map.trip.name}
          </div>
          <div className="text-xxsmall text-text-secondary">
            {formatVnTime(map.trip.departAt)} ·{" "}
            {formatVnDate(map.trip.departAt)} · {map.layout.name} ·{" "}
            {map.vehicle.name}
          </div>
        </div>

        {map.stops &&
          map.stops.pickup.length + map.stops.dropoff.length > 0 && (
            <details className="pn-card">
              <summary className="pn-link">Xem điểm đón, điểm trả</summary>
              <p className="pn-meta my-3">
                Giờ đón và trả khách là dự kiến, có thể thay đổi do thời tiết,
                tình hình giao thông hoặc sự cố trên đường.
              </p>
              {(["pickup", "dropoff"] as const).map((kind) => (
                <div key={kind}>
                  <strong>{kind === "pickup" ? "Điểm đón" : "Điểm trả"}</strong>
                  {map.stops![kind].map((stop, i) => (
                    <p key={i}>
                      {stop.time}{" "}
                      {stop.day > 0 &&
                        "(" +
                          formatVnDate(
                            new Date(
                              Date.parse(map.trip.departAt) +
                                86400000 * stop.day,
                            ).toISOString(),
                          ) +
                          ")"}{" "}
                      · {stop.name}
                    </p>
                  ))}
                </div>
              ))}
            </details>
          )}
        {!map.trip.onSale && (
          <div className="rounded-lg bg-red100 px-3 py-2 text-xxsmall text-danger">
            {copy.seats.notOnSale}
          </div>
        )}

        {requested.adults && (
          <div className="pn-meta">
            Hành khách dự kiến: {requested.adults} người lớn
            {requested.infants ? ` · ${requested.infants} trẻ dưới 2 tuổi` : ""}
            . Chọn số người thực tế cho từng chỗ bên dưới.
          </div>
        )}
        {grids.length > 1 && (
          <Tabs
            tabs={grids.map((g) => ({
              value: g.code,
              label: g.label,
              badge:
                codes.filter((c) => seatByCode.get(c)?.floor === g.code)
                  .length || undefined,
            }))}
            activeTab={activeFloor.code}
            onChange={setFloor}
            fullWidth
            className="bg-neutral100"
          />
        )}

        {activeFloor && (
          <SeatGrid
            grid={activeFloor}
            selected={selected}
            onSeatPress={onSeatPress}
          />
        )}
        <SeatLegend />

        {codes.length > 0 && (
          <div className="flex flex-col gap-3 rounded-xl bg-white">
            {codes.map((code) => {
              const seat = seatByCode.get(code);
              if (!seat) return null;
              const unitSel = selection[code];
              const deposit = unitDeposit(map, code, unitSel);
              return (
                <div
                  key={code}
                  className="flex flex-col gap-2 border-divider01 border-b pb-3 last:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-normal-sb capitalize">
                      {unit} {code}
                    </span>
                    {deposit !== null && (
                      <span className="text-small">
                        {copy.seats.deposit} {formatCurrency(deposit)}
                      </span>
                    )}
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
                        onChange={(v) =>
                          setSelection(
                            setOccupancy(
                              selection,
                              code,
                              Number(v),
                              seat.maxOccupancy,
                            ),
                          )
                        }
                        className="bg-neutral100"
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xxsmall text-text-secondary">
                    {copy.seats.infants}
                    <Stepper
                      label={copy.seats.infants}
                      value={unitSel.infantCount}
                      min={0}
                      max={MAX_INFANTS_PER_UNIT}
                      onChange={(n) =>
                        setSelection(setInfants(selection, code, n))
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 flex flex-col gap-2 border-divider01 border-t bg-white px-4 pb-5 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xxsmall text-text-secondary">
            {copy.seats.selectedCount(codes.length, unit)}
          </span>
          {estimate !== null && codes.length > 0 && (
            <span className="text-small-sb text-primary">
              {copy.seats.totalDeposit} {formatCurrency(estimate)}
            </span>
          )}
        </div>
        {codes.length > 0 && (
          <div className="text-xxxsmall text-text-secondary">
            {copy.seats.estimateHint}
          </div>
        )}
        <Button
          fullWidth
          disabled={codes.length === 0 || !map.trip.onSale}
          onClick={() =>
            navigate(
              pair && outbound
                ? "/trip/" + pair[1].id + "?roundTrip=1"
                : "/checkout",
            )
          }
        >
          {pair && outbound ? "Chọn ghế lượt về" : copy.common.continue}
        </Button>
      </div>
    </div>
  );
}
