import type { BookingView } from "@/types/api.types";

/** Mini App chỉ nhận tiền cọc trong lúc giữ chỗ. */
export function needsPayment(booking: BookingView): boolean {
  return booking.status === "HOLDING" && booking.amountDueNow > 0;
}
