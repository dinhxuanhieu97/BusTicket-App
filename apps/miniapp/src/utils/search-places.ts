import type { OpenRoute } from "@/types/api.types";

/** Một lựa chọn trong ô Điểm đi/Điểm đến: thành phố/bến (`place`) hoặc một điểm đón/trả thuộc nó (`stop`). */
export interface PlaceOption {
  value: string;
  label: string;
  place: string;
  stop?: string;
}

const SEP = "\u001f";
export const placeKey = (place: string, stop?: string) =>
  stop ? place + SEP + stop : place;

function build(
  routes: readonly OpenRoute[],
  placeOf: (r: OpenRoute) => string,
  stopsOf: (r: OpenRoute) => string[] | undefined,
): PlaceOption[] {
  const places = new Map<string, Set<string>>();
  for (const r of routes) {
    const place = placeOf(r);
    const stops = places.get(place) ?? new Set<string>();
    places.set(place, stops);
    for (const s of stopsOf(r) ?? []) if (s && s !== place) stops.add(s);
  }
  return [...places].flatMap(([place, stops]) => [
    { value: place, label: place, place },
    ...[...stops].map((stop) => ({
      value: placeKey(place, stop),
      label: stop,
      place,
      stop,
    })),
  ]);
}

/** Điểm đi: mỗi điểm đi của tuyến đang bán, theo sau là các điểm đón của nó. */
export function originOptions(routes: readonly OpenRoute[]): PlaceOption[] {
  return build(
    routes,
    (r) => r.origin,
    (r) => r.pickupStops,
  );
}

/** Điểm đến: chỉ tuyến khớp điểm đi (và điểm đón nếu đã chọn), mỗi điểm đến theo sau là các điểm trả. */
export function destinationOptions(
  routes: readonly OpenRoute[],
  origin: string,
  pickup = "",
): PlaceOption[] {
  return build(
    routes.filter(
      (r) =>
        (!origin || r.origin === origin) &&
        (!pickup || !!r.pickupStops?.includes(pickup)),
    ),
    (r) => r.destination,
    (r) => r.dropoffStops,
  );
}

/** Tìm lựa chọn theo khóa; khóa điểm đón/trả không còn bán thì lùi về chính điểm đi/đến đó. */
export function resolvePlace(
  options: readonly PlaceOption[],
  place: string,
  stop = "",
): { place: string; stop: string } {
  if (stop && options.some((o) => o.value === placeKey(place, stop)))
    return { place, stop };
  return { place, stop: "" };
}
