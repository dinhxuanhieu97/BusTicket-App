import { describe, expect, it } from "vitest";
import type { BookingStatus, BookingView } from "@/types/api.types";
import { needsPayment } from "./booking-status";

describe("payment eligibility", () => {
  it.each<[BookingStatus, number, boolean]>([
    ["HOLDING", 100000, true],
    ["CONFIRMED", 100000, true],
    ["CONFIRMED", 0, false],
    ["HOLDING", 0, false],
    ["EXPIRED", 100000, false],
    ["CANCELLED", 100000, false],
    ["COMPLETED", 100000, false],
  ])("%s with %i due has payable=%s", (status, amountDueNow, expected) => {
    expect(needsPayment({ status, amountDueNow } as BookingView)).toBe(
      expected,
    );
  });
});
