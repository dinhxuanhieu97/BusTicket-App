import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, toApiError } from "./api-client";
import { APIError } from "./api-error";
import { isRetriable } from "./query-client";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(body === undefined ? "" : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  it("sends headers that have a value and JSON body", async () => {
    const fetchFn = mockFetch(201, { ok: true });
    await apiRequest("/bookings", {
      method: "POST",
      body: { a: 1 },
      headers: { "Idempotency-Key": "k1", "X-Phone-Token": undefined },
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/bookings");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("k1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect("X-Phone-Token" in headers).toBe(false);
  });

  it("turns the server error body into an APIError with the stable code", async () => {
    mockFetch(409, { error: { code: "SEAT_UNAVAILABLE", message: "Chỗ A1 đã có người giữ.", details: { seats: ["A1"] } } });
    await expect(apiRequest("/bookings", { method: "POST", body: {} })).rejects.toMatchObject({
      status: 409,
      code: "SEAT_UNAVAILABLE",
      message: "Chỗ A1 đã có người giữ.",
      details: { seats: ["A1"] },
    });
  });

  it("reports a network failure as NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(apiRequest("/x")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("handles a non-JSON error page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 502 })));
    await expect(apiRequest("/x")).rejects.toMatchObject({ status: 502, code: "HTTP_502" });
  });
});

describe("toApiError / isRetriable", () => {
  it("falls back to a generic message", () => {
    const e = toApiError(500, null);
    expect(e.code).toBe("HTTP_500");
    expect(e.message).toBeTruthy();
  });

  it("does not retry business errors or rate limits, retries network and server errors", () => {
    expect(isRetriable(new APIError(404, "x", "NOT_FOUND"))).toBe(false);
    expect(isRetriable(new APIError(409, "x", "SEAT_UNAVAILABLE"))).toBe(false);
    expect(isRetriable(new APIError(429, "x", "TOO_MANY_ATTEMPTS"))).toBe(false);
    expect(isRetriable(new APIError(0, "x", "NETWORK_ERROR"))).toBe(true);
    expect(isRetriable(new APIError(503, "x", "SERVICE_UNAVAILABLE"))).toBe(true);
  });
});
