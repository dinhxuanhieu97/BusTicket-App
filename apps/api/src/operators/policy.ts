import { z } from 'zod';

/** Chính sách trẻ em nằm/ngồi chung (docs/SETUP-NHA-XE.md mục 3). */
export const childPolicySchema = z
  .object({
    freeUnderAge: z.number().int().min(0).max(16),
    price: z.number().int().min(0).max(20_000_000),
    maxPerUnit: z.number().int().min(0).max(2),
    countsTowardCapacity: z.boolean(),
  })
  .strict();
export type ChildPolicy = z.infer<typeof childPolicySchema>;

export const policyInputSchema = z
  .object({
    holdMinutes: z.number().int().min(1).max(120),
    maxUnitsPerBooking: z.number().int().min(1).max(20),
    childPolicy: childPolicySchema,
    /** Số đơn đang giữ chỗ tối đa cùng lúc cho một SĐT (chống giữ chỗ ảo). Bỏ trống = giữ nguyên. */
    maxActiveHoldsPerPhone: z.number().int().min(1).max(20).optional(),
    /** Chế độ cao điểm: bắt buộc xác thực SĐT bằng OTP trước khi giữ chỗ. Bỏ trống = giữ nguyên. */
    requirePhoneOtp: z.boolean().optional(),
    /** Phần trăm cọc để xác nhận vé (100 = trả đủ). Bỏ trống = giữ nguyên. */
    depositPercent: z.number().int().min(1).max(100).optional(),
    /** Phút ân hạn sau hạn thanh toán: chỗ vẫn khóa chờ tiền ngân hàng báo chậm. Bỏ trống = giữ nguyên. */
    paymentGraceMinutes: z.number().int().min(0).max(30).optional(),
    /** Tiền về sau khi đơn hết hạn: tự xác nhận lại nếu chỗ còn trống. Bỏ trống = giữ nguyên. */
    autoReinstateLatePayment: z.boolean().optional(),
  })
  .strict();
/** Chính sách đầy đủ (mọi trường bắt buộc) — dạng lưu trong DB. */
export type PolicyInput = Required<z.infer<typeof policyInputSchema>>;

export interface OperatorPolicy extends PolicyInput {
  operatorId: string;
  version: number;
}

export const DEFAULT_POLICY: PolicyInput = {
  holdMinutes: 10,
  maxUnitsPerBooking: 5,
  childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false },
  maxActiveHoldsPerPhone: 2,
  requirePhoneOtp: false,
  depositPercent: 100,
  paymentGraceMinutes: 3,
  autoReinstateLatePayment: true,
};
