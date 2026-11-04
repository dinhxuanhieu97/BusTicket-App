import { config } from "@/config";
import { apiRequest } from "@/lib/api-client";
import type {
  BookingView,
  CreateHoldRequest,
  HoldResult,
  PaymentInstructions,
  PhoneVerificationStarted,
  PhoneVerified,
} from "@/types/api.types";

export const bookingService = {
  /** Giữ chỗ. Gửi lại cùng `idempotencyKey` (mạng chập chờn) trả lại đúng đơn đã tạo, không tạo đơn mới. */
  createHold: (request: CreateHoldRequest, idempotencyKey: string, phoneToken?: string) =>
    apiRequest<HoldResult>("/bookings", {
      method: "POST",
      body: request,
      headers: { "Idempotency-Key": idempotencyKey, "X-Phone-Token": phoneToken },
    }),

  /** Token đi trong header, không đặt trên URL (PNTicketDocs mục 11). */
  get: (code: string, accessToken: string) =>
    apiRequest<BookingView>(`/bookings/${encodeURIComponent(code)}`, {
      headers: { "X-Booking-Token": accessToken },
    }),

  payment: (code: string, accessToken: string) =>
    apiRequest<PaymentInstructions>(`/bookings/${encodeURIComponent(code)}/payment`, {
      headers: { "X-Booking-Token": accessToken },
    }),

  startPhoneVerification: (phone: string) =>
    apiRequest<PhoneVerificationStarted>("/phone-verifications", {
      method: "POST",
      body: { operatorCode: config.operatorCode, phone },
    }),

  verifyPhone: (verificationId: string, code: string) =>
    apiRequest<PhoneVerified>("/phone-verifications/verify", {
      method: "POST",
      body: { verificationId, code },
    }),
};
