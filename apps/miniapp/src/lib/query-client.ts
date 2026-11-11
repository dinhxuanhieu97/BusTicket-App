import { QueryClient } from "@tanstack/react-query";
import { APIError } from "./api-error";

const DEFAULT_STALE_TIME = 1 * 60 * 1000;
const DEFAULT_GC_TIME = 5 * 60 * 1000;
const MAX_RETRIES = 3;

/** Lỗi 4xx là kết quả nghiệp vụ (không tìm thấy, hết chỗ...), thử lại không đổi được gì. */
export function isRetriable(error: unknown): boolean {
  if (error instanceof APIError)
    return error.status === 0 || error.status >= 500;
  return true;
}

// Query errors are shown by the screen that owns the data.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME,
      gcTime: DEFAULT_GC_TIME,
      refetchOnWindowFocus: false,
      maxPages: 6,
      retry: (count, error) => isRetriable(error) && count < MAX_RETRIES,
    },
  },
});
