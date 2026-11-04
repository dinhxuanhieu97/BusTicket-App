import { describe, expect, it } from "vitest";
import { formatCountdown, formatVnDate, formatVnTime, secondsLeft, upcomingDays, vnDate } from "./time";

describe("Vietnam time helpers", () => {
  it("uses the Vietnam calendar day, not the device's", () => {
    // 17:30 UTC ngày 4/11 = 00:30 ngày 5/11 giờ VN.
    expect(vnDate(new Date("2026-11-04T17:30:00Z"))).toBe("2026-11-05");
    expect(vnDate(new Date("2026-11-04T16:59:59Z"))).toBe("2026-11-04");
  });

  it("lists upcoming days starting today in Vietnam", () => {
    const days = upcomingDays(new Date("2026-11-04T17:30:00Z"), 3);
    expect(days.map((d) => d.date)).toEqual(["2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(days[0].label).toBe("Hôm nay");
    expect(days[1].label).toBe("Ngày mai");
    expect(days[2]).toMatchObject({ label: "T7", sub: "07/11" });
  });

  it("formats departure time and date in Vietnam time", () => {
    expect(formatVnTime("2026-11-05T11:00:00.000Z")).toBe("18:00");
    expect(formatVnDate("2026-11-05T11:00:00.000Z")).toBe("T5, 05/11/2026");
  });

  it("counts down to the server hold expiry and never goes negative", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    expect(secondsLeft("2026-11-05T10:09:05Z", now)).toBe(545);
    expect(secondsLeft("2026-11-05T09:59:00Z", now)).toBe(0);
    expect(secondsLeft(null, now)).toBe(0);
    expect(formatCountdown(545)).toBe("09:05");
    expect(formatCountdown(-3)).toBe("00:00");
  });
});
