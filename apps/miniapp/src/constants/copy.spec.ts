import { describe, expect, it } from "vitest";
import { APIError } from "@/lib/api-error";
import { copy, errorMessage } from "./copy";

describe("customer-facing errors", () => {
  it("preserves useful business errors and translates known codes", () => {
    expect(
      errorMessage(new APIError(409, "raw message", "SEAT_UNAVAILABLE")),
    ).toBe(copy.errors.SEAT_UNAVAILABLE);
    expect(
      errorMessage(new APIError(400, "Mã xác thực đã hết hạn.", "OTP_EXPIRED")),
    ).toBe("Mã xác thực đã hết hạn.");
  });

  it("shows recovery guidance without exposing internal exception text", () => {
    expect(errorMessage(new APIError(0, "Failed to fetch"))).toBe(
      copy.common.networkError,
    );
    expect(errorMessage(new APIError(503, "upstream timeout"))).toBe(
      copy.common.error,
    );
    expect(errorMessage(new Error("SDK not available"))).toBe(
      copy.common.error,
    );
  });
});
