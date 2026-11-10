import { queryOptions, useQuery } from "@tanstack/react-query";
import type { BookingView } from "@/types/api.types";
import { bookingService } from "./booking.api";

export const bookingKeys = {
  detail: (code: string) => ["booking", code] as const,
  payment: (code: string) => ["booking-payment", code] as const,
};

/** Đang chờ tiền về: hỏi lại trạng thái đơn mỗi 5 giây cho đến khi đơn không còn ở trạng thái giữ chỗ. */
export const BOOKING_POLL_MS = 5_000;

export function bookingPollInterval(
  booking: BookingView | undefined,
): number | false {
  return booking?.status === "HOLDING" ? BOOKING_POLL_MS : false;
}

export function bookingQueryOptions(
  code: string,
  accessToken: string | undefined,
) {
  return queryOptions({
    queryKey: bookingKeys.detail(code),
    queryFn: () => bookingService.get(code, accessToken!),
    enabled: !!code && !!accessToken,
    refetchInterval: (q) => bookingPollInterval(q.state.data),
    meta: { silent: true },
  });
}

export function useBooking(code: string, accessToken: string | undefined) {
  return useQuery(bookingQueryOptions(code, accessToken));
}

export function usePaymentInstructions(
  code: string,
  accessToken: string | undefined,
  enabled: boolean,
  amountDue?: number,
) {
  return useQuery({
    queryKey: [...bookingKeys.payment(code), amountDue],
    queryFn: () => bookingService.payment(code, accessToken!),
    enabled: enabled && !!code && !!accessToken,
    staleTime: 60_000,
  });
}
