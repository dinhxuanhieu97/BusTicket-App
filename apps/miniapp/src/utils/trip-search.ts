import type { TripSummary } from "@/types/api.types";
import type { TripSearch } from "@/stores/trip-search.store";

export function matchingTrips(
  trips: TripSummary[],
  search: TripSearch,
  returning = false,
): TripSummary[] {
  const origin = returning ? search.destination : search.origin;
  const destination = returning ? search.origin : search.destination;
  return trips.filter(
    (trip) =>
      (!origin || trip.route.origin === origin) &&
      (!destination || trip.route.destination === destination),
  );
}
export function validRoundTrip(search: TripSearch): boolean {
  return (
    !search.roundTrip ||
    (!!search.origin &&
      !!search.destination &&
      !!search.returnDate &&
      search.returnDate >= search.date)
  );
}

export function tripResultsUrl(search: TripSearch): string {
  const params = new URLSearchParams({ date: search.date });
  if (search.origin) params.set("from", search.origin);
  if (search.destination) params.set("to", search.destination);
  if (search.roundTrip) params.set("return", search.returnDate);
  params.set("adults", String(search.adults ?? 1));
  params.set("infants", String(search.infants ?? 0));
  return "/trips?" + params.toString();
}

export function readTripSearch(params: URLSearchParams): TripSearch | null {
  const date = params.get("date") ?? "";
  const returnDate = params.get("return") ?? "";
  const isDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(value + "T00:00:00Z").toJSON()?.slice(0, 10) === value;
  if (!isDate(date) || (params.has("return") && !isDate(returnDate)))
    return null;
  const count = (key: string, min: number) => {
    const n = Number(params.get(key));
    return Number.isInteger(n) && n >= min && n <= 40 ? n : min;
  };
  const search = {
    date,
    origin: params.get("from") ?? "",
    destination: params.get("to") ?? "",
    roundTrip: !!returnDate,
    returnDate,
    adults: count("adults", 1),
    infants: count("infants", 0),
  };
  return validRoundTrip(search) ? search : null;
}
