import { describe, expect, it } from "vitest";
import type { SavedBooking } from "@/stores/my-bookings.store";
import type { BookingView } from "@/types/api.types";
import { receiptLines, receiptPaymentLabel } from "./booking-receipt";

describe("booking receipt", () => {
  it.each([
    ["UNPAID", "Chưa thanh toán"],
    ["PARTIAL", "Đã thanh toán một phần"],
    ["DEPOSIT_PAID", "Đã thanh toán cọc"],
    ["PAID", "Đã thanh toán"],
  ] as const)(
    "labels %s without conflating full payment with a deposit",
    (status, label) => {
      expect(receiptPaymentLabel(status)).toBe(label);
    },
  );

  it("includes both legs and the deposit but leaves private booking data out of the share text", () => {
    const saved: SavedBooking = {
      code: "PN123456",
      accessToken: "booking-access-secret",
      tripId: "out",
      route: "Hoài Ân → An Sương",
      tripName: "Chuyến Hoài Ân",
      departAt: "2026-11-11T10:30:00.000Z",
      seatCodes: ["A2"],
      inbound: {
        tripId: "back",
        route: "An Sương → Hoài Ân",
        departAt: "2026-11-13T10:30:00.000Z",
        seatCodes: ["B4"],
      },
      createdAt: "2026-11-11T01:00:00.000Z",
    };
    const booking: BookingView = {
      code: saved.code,
      tripId: saved.tripId,
      status: "CONFIRMED",
      paymentStatus: "DEPOSIT_PAID",
      holdExpiresAt: null,
      totalAmount: 1_400_000,
      depositAmount: 600_000,
      paidAmount: 600_000,
      amountDueNow: 800_000,
      items: [],
      note: "private note",
    };
    const text = receiptLines(saved, booking).join("\n");
    expect(text).toContain("Chỗ A2");
    expect(text).toContain("Chỗ B4");
    expect(text).toContain("17:30");
    expect(text).toContain("Đã thanh toán cọc");
    expect(text).toContain("600.000đ");
    expect(text).not.toMatch(
      /booking-access-secret|private note|800\.000|1\.400\.000/,
    );
  });
});
