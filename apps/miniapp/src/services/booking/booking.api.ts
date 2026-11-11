import { config } from "@/config";
import { apiRequest } from "@/lib/api-client";
import type { BookingAttempt } from "@/utils/ids";
import type {
  BookingView,
  CreateHoldRequest,
  HoldResult,
  PaymentInstructions,
  PhoneVerificationStarted,
  PhoneVerified,
  ZaloPhone,
} from "@/types/api.types";

export const bookingService = {
  /** Retry a lost response using the credentials from the original attempt. */
  createHold: (request: CreateHoldRequest, attempt: BookingAttempt, phoneToken?: string) =>
    apiRequest<HoldResult>("/bookings", {
      method: "POST",
      body: request,
      headers: {
        "Idempotency-Key": attempt.idempotencyKey,
        "X-Booking-Retry-Token": attempt.retryToken,
        "X-Phone-Token": phoneToken,
      },
    }),

  /** Token đi trong header, không đặt trên URL (PNTicketDocs mục 11). */
  get: (code: string, accessToken: string) =>
    apiRequest<BookingView>(`/bookings/${encodeURIComponent(code)}`, {
      headers: { "X-Booking-Token": accessToken },
    }),

  contact: (code: string, accessToken: string) =>
    apiRequest<{ name: string; phone: string }>(`/bookings/${encodeURIComponent(code)}/contact`, {
      headers: { "X-Booking-Token": accessToken },
    }),

  /** Xóa họ tên, SĐT trong đơn đã xong (409 nếu vé chưa đi hoặc còn tiền cần đối soát). */
  eraseContact: (code: string, accessToken: string) =>
    apiRequest<{ code: string; erasedAt: string }>(`/bookings/${encodeURIComponent(code)}/erase-contact`, {
      method: "POST",
      headers: { "X-Booking-Token": accessToken },
    }),

  payment: (code: string, accessToken: string) =>
    apiRequest<PaymentInstructions>(`/bookings/${encodeURIComponent(code)}/payment?purpose=deposit`, {
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

  /** Đổi token `getPhoneNumber` (+ access token Zalo) lấy SĐT thật; máy chủ giữ Secret Key của Mini App. */
  zaloPhone: (accessToken: string, code: string) =>
    apiRequest<ZaloPhone>("/zalo/phone", {
      method: "POST",
      body: { operatorCode: config.operatorCode, accessToken, code },
    }),
};
