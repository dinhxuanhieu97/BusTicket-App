import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateHoldRequest } from "@/types/api.types";
import { tripKeys } from "../trip/trip.queries";
import { bookingService } from "./booking.api";
import { bookingKeys } from "./booking.queries";

export function useCreateHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { request: CreateHoldRequest; idempotencyKey: string; phoneToken?: string }) =>
      bookingService.createHold(v.request, v.idempotencyKey, v.phoneToken),
    onSuccess: (result) => {
      qc.setQueryData(bookingKeys.detail(result.booking.code), result.booking);
    },
    onSettled: (_r, _e, v) => {
      // Thành công hay hết chỗ đều làm sơ đồ thay đổi.
      void qc.invalidateQueries({ queryKey: tripKeys.seatMap(v.request.tripId) });
      void qc.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}

export function useStartPhoneVerification() {
  return useMutation({ mutationFn: (phone: string) => bookingService.startPhoneVerification(phone) });
}

export function useVerifyPhone() {
  return useMutation({
    mutationFn: (v: { verificationId: string; code: string }) => bookingService.verifyPhone(v.verificationId, v.code),
  });
}
