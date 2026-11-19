import { describe, expect, it } from "vitest";
import type { OpenRoute } from "@/types/api.types";
import {
  destinationOptions,
  originOptions,
  placeKey,
  resolvePlace,
} from "./search-places";

const route = (
  origin: string,
  destination: string,
  pickupStops: string[],
  dropoffStops: string[],
): OpenRoute => ({
  code: origin + destination,
  origin,
  destination,
  fromPrice: null,
  tripCount: 1,
  departAt: "2026-11-20T09:00:00.000Z",
  pickupStops,
  dropoffStops,
});
const routes = [
  route(
    "Hoài Ân",
    "TP.HCM",
    ["Bưu điện Ân Nghĩa", "Nhà xe Phong Nhung"],
    ["Suối Tiên", "Bx. An Sương"],
  ),
  route(
    "TP.HCM",
    "Hoài Ân",
    ["Bx. An Sương"],
    ["Hoài Ân", "Bưu điện Ân Nghĩa"],
  ),
  route("Hoài Ân", "Đà Lạt", ["Nhà xe Phong Nhung"], []),
];

describe("search place options", () => {
  it("lists each origin followed by its pickup stops, without duplicates", () => {
    expect(originOptions(routes).map((o) => o.label)).toEqual([
      "Hoài Ân",
      "Bưu điện Ân Nghĩa",
      "Nhà xe Phong Nhung",
      "TP.HCM",
      "Bx. An Sương",
    ]);
    expect(originOptions(routes)[1]).toEqual({
      value: placeKey("Hoài Ân", "Bưu điện Ân Nghĩa"),
      label: "Bưu điện Ân Nghĩa",
      place: "Hoài Ân",
      stop: "Bưu điện Ân Nghĩa",
    });
  });

  it("lists destinations of the chosen origin and pickup, with drop-off stops, skipping a stop named like its place", () => {
    expect(destinationOptions(routes, "Hoài Ân").map((o) => o.label)).toEqual([
      "TP.HCM",
      "Suối Tiên",
      "Bx. An Sương",
      "Đà Lạt",
    ]);
    expect(
      destinationOptions(routes, "Hoài Ân", "Bưu điện Ân Nghĩa").map(
        (o) => o.label,
      ),
    ).toEqual(["TP.HCM", "Suối Tiên", "Bx. An Sương"]);
    expect(destinationOptions(routes, "TP.HCM").map((o) => o.label)).toEqual([
      "Hoài Ân",
      "Bưu điện Ân Nghĩa",
    ]);
  });

  it("drops a stop that is no longer sold", () => {
    const options = originOptions(routes);
    expect(resolvePlace(options, "Hoài Ân", "Nhà xe Phong Nhung")).toEqual({
      place: "Hoài Ân",
      stop: "Nhà xe Phong Nhung",
    });
    expect(resolvePlace(options, "Hoài Ân", "Bến cũ")).toEqual({
      place: "Hoài Ân",
      stop: "",
    });
  });
});
