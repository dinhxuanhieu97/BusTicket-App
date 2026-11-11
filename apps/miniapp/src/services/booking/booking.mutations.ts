import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyBookings, type SavedBooking } from "@/stores/my-bookings.store";
import { useProfile } from "@/stores/profile.store";
import type { CreateHoldRequest } from "@/types/api.types";
import type { BookingAttempt } from "@/utils/ids";
import { tripKeys } from "../trip/trip.queries";
import { bookingService } from "./booking.api";
import { bookingKeys } from "./booking.queries";

interface HoldSubmission {
  request: CreateHoldRequest;
  attempt: BookingAttempt;
  phoneToken?: string;
  receipt: Omit<SavedBooking, "code" | "accessToken" | "createdAt">;
}

export function useCreateHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: HoldSubmission) =>
      bookingService.createHold(v.request, v.attempt, v.phoneToken),
    onSuccess: (result, { request, receipt }) => {
      useProfile.getState().save(request.contactName, request.contactPhone);
      useMyBookings.getState().save({
        ...receipt,
        code: result.booking.code,
        accessToken: result.accessToken,
        createdAt: new Date().toISOString(),
      });
      qc.setQueryData(bookingKeys.detail(result.booking.code), result.booking);
    },
    onSettled: (_r, _e, v) => {
      // Thành công hay hết chỗ đều làm sơ đồ thay đổi.
      void qc.invalidateQueries({ queryKey: tripKeys.seatMap(v.request.tripId) });
      if (v.request.returnLeg) void qc.invalidateQueries({queryKey: tripKeys.seatMap(v.request.returnLeg.tripId)});
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
