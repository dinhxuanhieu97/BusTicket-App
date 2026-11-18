import { describe, expect, it } from "vitest";
import {
  calendarYmd,
  earliestTravelDate,
  monthTitle,
  ymdToCalendarDate,
} from "./travel-date";

const trip = (departAt: string, origin = "Hoài Ân", destination = "Sài Gòn") => ({
  departAt,
  route: { origin, destination },
});

describe("earliestTravelDate", () => {
  // 18/11/2026 22:18 giờ VN = 15:18 UTC.
  const lateEvening = new Date("2026-11-18T15:18:00Z");

  it("locks today once every trip of today has departed", () => {
    expect(
      earliestTravelDate(lateEvening, [trip("2026-11-18T10:30:00Z")]),
    ).toBe("2026-11-19");
  });

  it("locks today when no trip runs today", () => {
    expect(earliestTravelDate(lateEvening, [])).toBe("2026-11-19");
  });

  it("keeps today while a trip has not departed yet", () => {
    const afternoon = new Date("2026-11-18T07:00:00Z"); // 14:00 VN
    expect(
      earliestTravelDate(afternoon, [trip("2026-11-18T10:30:00Z")]),
    ).toBe("2026-11-18");
  });

  it("only counts trips on the chosen route", () => {
    const afternoon = new Date("2026-11-18T07:00:00Z");
    const trips = [trip("2026-11-18T10:30:00Z", "Sài Gòn", "Hoài Ân")];
    expect(earliestTravelDate(afternoon, trips, "Hoài Ân", "Sài Gòn")).toBe(
      "2026-11-19",
    );
    expect(earliestTravelDate(afternoon, trips, "Sài Gòn")).toBe("2026-11-18");
  });

  it("uses the Vietnam calendar day, not the phone's time zone", () => {
    // 23:30 VN ngày 18 = 16:30 UTC; chuyến 23:45 VN vẫn còn.
    const now = new Date("2026-11-18T16:30:00Z");
    expect(earliestTravelDate(now, [trip("2026-11-18T16:45:00Z")])).toBe(
      "2026-11-18",
    );
  });

  it("allows today while trips are still loading", () => {
    expect(earliestTravelDate(lateEvening, undefined)).toBe("2026-11-18");
  });
});

describe("calendar helpers", () => {
  it("round-trips a calendar day", () => {
    expect(calendarYmd(ymdToCalendarDate("2026-02-05"))).toBe("2026-02-05");
  });

  it("titles the month in the Gregorian calendar", () => {
    expect(monthTitle(ymdToCalendarDate("2026-11-01"))).toBe("Tháng 11/2026");
  });
});
