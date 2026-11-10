import { useEffect, useMemo } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
  Link,
} from "react-router-dom";
import { Spinner } from "zmp-ui";
import { copy } from "@/constants/copy";
import { useTrips } from "@/services/trip/trip.queries";
import { useBookingDraft } from "@/stores/booking-draft.store";
import { useTripSearch, type TripSearch } from "@/stores/trip-search.store";
import type { TripSummary } from "@/types/api.types";
import { formatVnDate, formatVnTime } from "@/utils/time";
import { EmptyState } from "@/components/booking/empty-state";
import { matchingTrips, readTripSearch } from "@/utils/trip-search";

export default function TripResultsPage() {
  const [params] = useSearchParams();
  const search = useMemo(() => readTripSearch(params), [params]);
  const submit = useTripSearch((s) => s.submit);
  useEffect(() => {
    if (search) submit(search);
  }, [search, submit]);
  const outbound = useLocation().state?.outbound as TripSummary | undefined;
  if (!search) return <Navigate to="/" replace />;
  return (
    <main className="pn-page">
      <Link to="/" className="pn-link">
        Thay đổi tìm kiếm
      </Link>
      {search.roundTrip && (
        <h1 className="pn-section-title">
          {outbound ? "Chọn chuyến về" : "Chọn chuyến đi"}
        </h1>
      )}
      {outbound && (
        <p className="pn-meta">
          Lượt đi · {outbound.route.origin} → {outbound.route.destination} ·{" "}
          {formatVnDate(outbound.departAt)} · {formatVnTime(outbound.departAt)}
        </p>
      )}
      <Leg search={search} outbound={outbound} />
    </main>
  );
}

function Leg({
  search,
  outbound,
}: {
  search: TripSearch;
  outbound?: TripSummary;
}) {
  const location = useLocation();
  const returning = !!outbound;
  const date = returning ? search.returnDate : search.date;
  const results = useTrips(date);
  const trips = matchingTrips(results.data ?? [], search, returning).filter(
    (t) => !outbound || Date.parse(t.departAt) > Date.parse(outbound.departAt),
  );
  const from = returning ? search.destination : search.origin;
  const to = returning ? search.origin : search.destination;
  const navigate = useNavigate();
  const startJourney = useBookingDraft((s) => s.startJourney);
  return (
    <section aria-busy={results.isFetching}>
      <h2 className="pn-section-title">
        {from || copy.search.allOrigins} → {to || copy.search.allDestinations}
      </h2>
      <p className="pn-meta mb-4">
        {returning ? copy.search.inbound : copy.search.outbound} ·{" "}
        {formatVnDate(date + "T00:00:00+07:00")}
      </p>
      {results.isLoading || results.isPlaceholderData ? (
        <div className="pn-loading" role="status">
          <Spinner />
          {copy.common.loading}
        </div>
      ) : results.isError ? (
        <EmptyState
          title={copy.common.error}
          hint={copy.common.networkError}
          actionLabel={copy.common.retry}
          onAction={() => void results.refetch()}
        />
      ) : !trips.length ? (
        <EmptyState title={copy.search.empty} hint={copy.search.emptyHint} />
      ) : (
        trips.map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
            onPick={() => {
              if (search.roundTrip && !outbound) {
                navigate(location.pathname + location.search, {
                  state: { outbound: trip },
                });
                return;
              }
              startJourney(outbound ?? trip, outbound ? trip : undefined);
              navigate(
                "/trip/" +
                  (outbound ?? trip).id +
                  (outbound ? "?roundTrip=1" : ""),
              );
            }}
          />
        ))
      )}
    </section>
  );
}

function TripCard({ trip, onPick }: { trip: TripSummary; onPick: () => void }) {
  const soldOut = trip.availableUnits <= 0;
  return (
    <button
      type="button"
      disabled={soldOut}
      onClick={onPick}
      className="pn-card pn-trip"
    >
      <span className="pn-trip-time">{formatVnTime(trip.departAt)}</span>
      <span className="pn-trip-route">
        {trip.route.origin} → {trip.route.destination}
      </span>
      <span className="pn-meta">
        {trip.vehicle.layoutName} · {trip.vehicle.name}
      </span>
      <span className="pn-row pn-trip-foot">
        <span className={soldOut ? "pn-meta" : "pn-available"}>
          {soldOut
            ? copy.search.soldOut
            : copy.search.available(trip.availableUnits, trip.unit)}
        </span>
        <span className="pn-link">
          {soldOut ? copy.search.soldOut : copy.search.choose}
          <span aria-hidden="true"> →</span>
        </span>
      </span>
    </button>
  );
}
