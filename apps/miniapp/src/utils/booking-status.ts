import type { BookingView } from "@/types/api.types";

/** Mini App chỉ nhận tiền cọc trong lúc giữ chỗ. */
export function needsPayment(booking: BookingView): boolean {
  return booking.status === "HOLDING" && booking.amountDueNow > 0;
}

/** Khách tự hủy được khi đơn còn giữ chỗ và chưa nhận đồng nào (API kiểm tra lại). */
export function canCancel(booking: BookingView): boolean {
  return booking.status === "HOLDING" && booking.paidAmount === 0;
}

/** Bỏ khỏi danh sách trên máy khi đơn đã hết hạn, đã hủy, đã đi xong hoặc nhà xe không còn đơn này. */
export function canRemove(
  booking: BookingView | undefined,
  unavailable: boolean,
): boolean {
  return (
    unavailable ||
    (!!booking &&
      ["EXPIRED", "CANCELLED", "COMPLETED"].includes(booking.status))
  );
}
