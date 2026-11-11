export interface BookingAttempt {
  idempotencyKey: string;
  retryToken: string;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newBookingAttempt(): BookingAttempt {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) throw new Error("Web Crypto is unavailable");
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return {
    idempotencyKey: hex(bytes.subarray(0, 16)),
    retryToken: hex(bytes.subarray(16)),
  };
}

/** Local identifier for a saved passenger. */
export function newLocalId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    return hex(c.getRandomValues(new Uint8Array(16)));
  }
  // This value only identifies a record on the current device.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
