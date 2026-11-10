import { config } from "@/config";
import { apiRequest } from "@/lib/api-client";
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

  contact: (code: string, accessToken: string) =>
    apiRequest<{ name: string; phone: string }>(`/bookings/${encodeURIComponent(code)}/contact`, {
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
