import React from "react";
import { RouterProvider } from "react-router-dom";
import { SnackbarProvider } from "zmp-ui";
import router from "./router";
import { ReactQueryProvider } from "./lib/react-query-provider";

export default function MiniApp() {
  return (
    <React.StrictMode>
      <SnackbarProvider>
        <ReactQueryProvider>
          <RouterProvider router={router} />
        </ReactQueryProvider>
      </SnackbarProvider>
    </React.StrictMode>
  );
}
