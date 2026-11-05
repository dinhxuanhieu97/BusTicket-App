import { config } from "@/config";
import { APIError } from "./api-error";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  headers?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

/** Đọc phần thân lỗi chuẩn của API `{ error: { code, message, details? } }`. */
export function toApiError(status: number, body: unknown): APIError {
  const err = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  const code = typeof err?.code === "string" ? err.code : `HTTP_${status}`;
  const message = typeof err?.message === "string" ? err.message : "Hệ thống đang gặp sự cố, vui lòng thử lại sau.";
  return new APIError(status, message, code, err?.details);
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  for (const [k, v] of Object.entries(options.headers ?? {})) if (v) headers[k] = v;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}/api/v1${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new APIError(0, "Không kết nối được máy chủ, vui lòng kiểm tra mạng.", "NETWORK_ERROR");
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) throw toApiError(res.status, body);
  return body as T;
}
