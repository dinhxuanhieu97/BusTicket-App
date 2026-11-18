import { describe, expect, it } from "vitest";
import type { TripSummary } from "@/types/api.types";
import type { TripSearch } from "@/stores/trip-search.store";
import {
  matchingTrips,
  readTripSearch,
  tripResultsUrl,
  validRoundTrip,
} from "./trip-search";
const search: TripSearch = {
  date: "2026-11-06",
  returnDate: "2026-11-08",
  origin: "TP.HCM",
  destination: "Hoài Ân",
  roundTrip: true,
};
const trips = [
  { id: "out", route: { origin: "TP.HCM", destination: "Hoài Ân" } },
  { id: "back", route: { origin: "Hoài Ân", destination: "TP.HCM" } },
  { id: "other", route: { origin: "Đà Nẵng", destination: "TP.HCM" } },
] as TripSummary[];
describe("round trip search", () => {
  it("finds only the reversed route for the return leg", () => {
    expect(matchingTrips(trips, search).map((t) => t.id)).toEqual(["out"]);
    expect(matchingTrips(trips, search, true).map((t) => t.id)).toEqual([
      "back",
    ]);
  });
  it("requires both endpoints and a return date on or after departure", () => {
    expect(validRoundTrip(search)).toBe(true);
    expect(validRoundTrip({ ...search, returnDate: search.date })).toBe(true);
    expect(validRoundTrip({ ...search, returnDate: "2026-11-05" })).toBe(false);
    expect(validRoundTrip({ ...search, returnDate: "" })).toBe(false);
    expect(validRoundTrip({ ...search, destination: "" })).toBe(false);
    expect(validRoundTrip({ ...search, origin: "" })).toBe(false);
    expect(
      validRoundTrip({ ...search, roundTrip: false, returnDate: "" }),
    ).toBe(true);
  });
});

describe("pickup and drop-off in the results URL", () => {
  it("round-trips stops chosen in the search form and ignores a stop without its place", () => {
    const search = {
      date: "2026-11-20",
      origin: "Hoài Ân",
      destination: "TP.HCM",
      pickup: "Bưu điện Ân Nghĩa",
      dropoff: "Suối Tiên",
      roundTrip: false,
      returnDate: "",
      adults: 1,
      infants: 0,
    };
    const url = tripResultsUrl(search);
    expect(readTripSearch(new URLSearchParams(url.split("?")[1]))).toEqual(
      search,
    );
    expect(
      tripResultsUrl({ ...search, origin: "", destination: "" }),
    ).not.toMatch(/pickup|dropoff/);
  });
});
