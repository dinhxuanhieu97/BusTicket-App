import { copy } from "@/constants/copy";

export function RouteArrow() {
  return (
    <svg
      className="pn-journey-arrow"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M3 12h18m-6-6 6 6-6 6" />
    </svg>
  );
}

/** Older saved bookings may only have a trip name; never invent missing endpoints. */
export function Journey({
  route,
  fallback,
}: {
  route: string;
  fallback: string;
}) {
  const parts = route.split(" → ");
  if (parts.length !== 2 || !parts.every(Boolean))
    return (
      <div className="pn-date" style={{ marginTop: 16 }}>
        {route || fallback}
      </div>
    );
  return (
    <div className="pn-journey">
      <div>
        <small>{copy.search.origin}</small>
        <strong>{parts[0]}</strong>
      </div>
      <RouteArrow />
      <div>
        <small>{copy.search.destination}</small>
        <strong>{parts[1]}</strong>
      </div>
    </div>
  );
}
