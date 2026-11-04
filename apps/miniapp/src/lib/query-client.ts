import {
  MutationCache,
  QueryCache,
  QueryClient,
  Query,
} from "@tanstack/react-query";
import { APIError } from "./api-error";

type QueryErrorHandler = (
  error: unknown,
  query: Query<unknown, unknown, unknown>
) => void;

type MutationErrorHandler = (error: unknown) => void;

const DEFAULT_STALE_TIME = 1 * 60 * 1000;
const DEFAULT_GC_TIME = 5 * 60 * 1000;
const MAX_RETRIES = 3;

/** Lỗi 4xx là kết quả nghiệp vụ (không tìm thấy, hết chỗ...), thử lại không đổi được gì. */
export function isRetriable(error: unknown): boolean {
  if (error instanceof APIError) return error.status === 0 || error.status >= 500;
  return true;
}

class QueryClientProvider {
  private static instance: QueryClientProvider;
  public readonly client: QueryClient;

  private constructor(
    onQueryError?: QueryErrorHandler,
    onMutationError?: MutationErrorHandler
  ) {
    this.client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: DEFAULT_STALE_TIME,
          gcTime: DEFAULT_GC_TIME,
          refetchOnWindowFocus: false,
          maxPages: 6,
          retry: (count, error) => isRetriable(error) && count < MAX_RETRIES,
        },
      },
      queryCache: new QueryCache({
        onError: (error, query) => {
          // Truy vấn đánh dấu `meta.silent` (vd. gọi định kỳ) tự hiển thị lỗi tại chỗ, không bật snackbar liên tục.
          if (query.meta?.silent) return;
          if (!isRetriable(error) || query.state.fetchFailureCount > MAX_RETRIES) {
            onQueryError?.(error, query);
          }
        },
      }),
      mutationCache: new MutationCache({
        onError: onMutationError,
      }),
    });
  }

  public static getInstance(
    onQueryError?: QueryErrorHandler,
    onMutationError?: MutationErrorHandler
  ): QueryClient {
    if (!QueryClientProvider.instance) {
      QueryClientProvider.instance = new QueryClientProvider(
        onQueryError,
        onMutationError
      );
    }
    return QueryClientProvider.instance.client;
  }
}

export const queryClient = (
  onQueryError?: QueryErrorHandler,
  onMutationError?: MutationErrorHandler
) => QueryClientProvider.getInstance(onQueryError, onMutationError);

export { QueryClientProvider };
