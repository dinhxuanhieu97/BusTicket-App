import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "zmp-ui";
import { copy } from "@/constants/copy";
import { useTrips } from "@/services/trip/trip.queries";
import { useBookingDraft } from "@/stores/booking-draft.store";
import type { TripSummary } from "@/types/api.types";
import { cn } from "@/utils/cn";
import { formatCurrency } from "@/utils/format";
import { formatVnTime, upcomingDays, vnDate } from "@/utils/time";
import { EmptyState } from "@/components/booking/empty-state";

const DAYS_SHOWN = 7;

export default function SearchPage() {
  const navigate = useNavigate();
  const openTrip = useBookingDraft((s) => s.openTrip);
  const days = useMemo(() => upcomingDays(new Date(), DAYS_SHOWN), []);
  const [date, setDate] = useState(days[0].date);
  const [route, setRoute] = useState<string>("");
  const { data: trips = [], isLoading, isFetching, refetch, isError } = useTrips(date);

  const routes = useMemo(() => {
    const seen = new Map<string, TripSummary["route"]>();
    trips.forEach((t) => seen.set(t.route.code, t.route));
    return [...seen.values()];
  }, [trips]);
  const visible = route ? trips.filter((t) => t.route.code === route) : trips;

  const pick = (trip: TripSummary) => {
    openTrip(trip.id, trip);
    navigate(`/trip/${trip.id}`);
  };

  return (
    <div className="relative flex flex-col gap-3 px-4 pb-6 pt-2">
      <div className="text-large-m">{copy.search.title}</div>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => setDate(d.date)}
            className={cn(
              "flex min-w-16 shrink-0 flex-col items-center rounded-xl px-3 py-2",
              date === d.date ? "bg-primary text-white" : "bg-white text-text-primary",
            )}
          >
            <span className="text-xxsmall">{d.label}</span>
            <span className="text-normal-sb">{d.sub}</span>
          </button>
        ))}
        <label className="flex min-w-24 shrink-0 flex-col items-center justify-center rounded-xl bg-white px-3 py-2 text-xxsmall text-text-secondary">
          {copy.search.otherDate}
          <input
            type="date"
            className="w-24 bg-transparent text-xxsmall text-text-primary"
            min={vnDate(new Date())}
            value={days.some((d) => d.date === date) ? "" : date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
      </div>

      {routes.length > 1 && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {[{ code: "", origin: copy.search.allRoutes, destination: "" }, ...routes].map((r) => (
            <button
              key={r.code || "all"}
              type="button"
              onClick={() => setRoute(r.code)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xxsmall",
                route === r.code ? "border-primary text-primary" : "border-transparent bg-white text-text-secondary",
              )}
            >
              {r.destination ? `${r.origin} → ${r.destination}` : r.origin}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : isError ? (
        <EmptyState title={copy.common.error} actionLabel={copy.common.retry} onAction={() => void refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState title={copy.search.empty} hint={copy.search.emptyHint} />
      ) : (
        <div className={cn("flex flex-col gap-3", isFetching && "opacity-60")}>
          {visible.map((trip) => (
            <TripCard key={trip.id} trip={trip} onPick={() => pick(trip)} />
          ))}
        </div>
      )}
    </div>
  );
}

function TripCard({ trip, onPick }: { trip: TripSummary; onPick: () => void }) {
  const soldOut = trip.availableUnits <= 0;
  return (
    <button
      type="button"
      disabled={soldOut}
      onClick={onPick}
      className="flex w-full flex-col gap-2 rounded-xl bg-white p-4 text-left disabled:opacity-50"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xlarge-sb">{formatVnTime(trip.departAt)}</span>
        {trip.fromPrice !== null && (
          <span className="text-normal-sb text-primary">
            <span className="text-xxsmall text-text-secondary">{copy.search.fromPrice} </span>
            {formatCurrency(trip.fromPrice)}
          </span>
        )}
      </div>
      <div className="text-small">
        {trip.route.origin} → {trip.route.destination}
      </div>
      <div className="flex items-center justify-between text-xxsmall text-text-secondary">
        <span>
          {trip.vehicle.layoutName} · {trip.vehicle.name}
        </span>
        <span className={soldOut ? "text-danger" : "text-green500"}>
          {soldOut ? copy.search.soldOut : copy.search.available(trip.availableUnits, trip.unit)}
        </span>
      </div>
    </button>
  );
}
