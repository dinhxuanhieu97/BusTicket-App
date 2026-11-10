import { copy } from "@/constants/copy";
import type { SavedBooking } from "@/stores/my-bookings.store";
import type { BookingView } from "@/types/api.types";
import { formatCurrency } from "./format";
import { formatVnDate, formatVnTime } from "./time";

const paymentLabels: Record<BookingView["paymentStatus"], string> = {
  UNPAID: "Chưa thanh toán",
  PARTIAL: "Đã thanh toán một phần",
  DEPOSIT_PAID: "Đã thanh toán cọc",
  PAID: "Đã thanh toán",
};

export function receiptPaymentLabel(status: BookingView["paymentStatus"]) {
  return paymentLabels[status];
}

export function receiptLines(saved: SavedBooking, booking: BookingView) {
  const journeyLines = (leg: {
    route: string;
    departAt: string;
    seatCodes: string[];
  }) => [
    leg.route,
    `Khởi hành ${formatVnTime(leg.departAt)} · ${formatVnDate(leg.departAt)}`,
    `Chỗ ${leg.seatCodes.join(", ")}`,
  ];

  return [
    `Mã đơn ${booking.code}`,
    `Trạng thái đơn · ${copy.booking.status[booking.status]}`,
    `Thanh toán · ${receiptPaymentLabel(booking.paymentStatus)}`,
    `Tổng tiền cọc · ${formatCurrency(booking.depositAmount)}`,
    "",
    ...journeyLines({ ...saved, route: saved.route || saved.tripName }),
    ...(saved.inbound ? ["", "Lượt về", ...journeyLines(saved.inbound)] : []),
  ];
}
