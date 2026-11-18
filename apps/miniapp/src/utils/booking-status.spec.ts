import { describe, expect, it } from "vitest";
import type { BookingStatus, BookingView } from "@/types/api.types";
import { canCancel, canRemove, needsPayment } from "./booking-status";

describe("payment eligibility", () => {
  it.each<[BookingStatus, number, boolean]>([
    ["HOLDING", 100000, true],
    ["CONFIRMED", 100000, false],
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

describe("cancel and remove from my bookings", () => {
  const view = (status: BookingView["status"], paidAmount = 0) =>
    ({ status, paidAmount, amountDueNow: 100 }) as BookingView;
  it("lets the customer cancel only an unpaid hold", () => {
    expect(canCancel(view("HOLDING"))).toBe(true);
    expect(canCancel(view("HOLDING", 50))).toBe(false);
    expect(canCancel(view("CONFIRMED"))).toBe(false);
  });
  it("lets the customer remove expired, cancelled, finished or missing bookings", () => {
    for (const s of ["EXPIRED", "CANCELLED", "COMPLETED"] as const)
      expect(canRemove(view(s), false)).toBe(true);
    expect(canRemove(view("HOLDING"), false)).toBe(false);
    expect(canRemove(view("CONFIRMED"), false)).toBe(false);
    expect(canRemove(undefined, true)).toBe(true);
    expect(canRemove(undefined, false)).toBe(false);
  });
});
