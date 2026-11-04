/** Khóa chống gửi trùng cho `POST /bookings` (header Idempotency-Key). */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  // Máy rất cũ không có Web Crypto: vẫn đủ ngẫu nhiên cho mục đích chống gửi trùng (không phải bí mật).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
