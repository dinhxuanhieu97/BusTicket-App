import { createBrowserRouter } from "react-router-dom";
import Layout, { type RouteHandle } from "./components/layout/layout";
import { getBasePath } from "./utils/zma";
import { copy } from "@/constants/copy";
import SearchPage from "./pages/search";
import SeatMapPage from "./pages/seat-map";
import CheckoutPage from "./pages/checkout";
import BookingDetailPage from "./pages/booking-detail";
import MyBookingsPage from "./pages/my-bookings";

const handle = (h: RouteHandle) => h;

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <Layout />,
      children: [
        { path: "/", element: <SearchPage /> },
        {
          path: "/trip/:tripId",
          element: <SeatMapPage />,
          handle: handle({ title: copy.seats.title, back: true, hideFooter: true, whiteBackground: true }),
        },
        {
          path: "/checkout",
          element: <CheckoutPage />,
          handle: handle({ title: copy.checkout.title, back: true, hideFooter: true, whiteBackground: true }),
        },
        {
          path: "/booking/:code",
          element: <BookingDetailPage />,
          handle: handle({ title: copy.booking.title, back: true, hideFooter: true, whiteBackground: true }),
        },
        {
          path: "/my-bookings",
          element: <MyBookingsPage />,
          handle: handle({ title: copy.myBookings.title, whiteBackground: true }),
        },
      ],
    },
  ],
  { basename: getBasePath() },
);

export default router;
