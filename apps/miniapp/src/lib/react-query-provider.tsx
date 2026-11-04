import { QueryClientProvider } from "@tanstack/react-query";
import React, { useCallback } from "react";
import { useSnackbar } from "zmp-ui";
import { queryClient } from "./query-client";
import { copy, errorMessage } from "@/constants/copy";

export function ReactQueryProvider({ children }: { children: React.ReactNode }) {
  const { openSnackbar } = useSnackbar();

  // Lỗi tải dữ liệu báo chung một chỗ. Lỗi thao tác (giữ chỗ, OTP) do từng màn tự báo kèm hướng xử lý.
  const handleQueryError = useCallback(
    (error: unknown) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        openSnackbar({ text: copy.common.networkError, type: "warning" });
        return;
      }
      openSnackbar({ text: errorMessage(error), type: "error" });
    },
    [openSnackbar],
  );

  return <QueryClientProvider client={queryClient(handleQueryError)}>{children}</QueryClientProvider>;
}
