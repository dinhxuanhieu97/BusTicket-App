import React from "react";
import { RouterProvider } from "react-router-dom";
import { SnackbarProvider } from "zmp-ui";
import { QueryClientProvider } from "@tanstack/react-query";
import router from "./router";
import { queryClient } from "./lib/query-client";

export default function MiniApp() {
  return (
    <React.StrictMode>
      <SnackbarProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </SnackbarProvider>
    </React.StrictMode>
  );
}
