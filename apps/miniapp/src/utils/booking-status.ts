import type { BookingView } from "@/types/api.types";

/** Confirmed bookings can still have a balance; expired/cancelled orders cannot be paid. */
export function needsPayment(booking: BookingView): boolean {
  return (
    (booking.status === "HOLDING" || booking.status === "CONFIRMED") &&
    booking.amountDueNow > 0
  );
}
