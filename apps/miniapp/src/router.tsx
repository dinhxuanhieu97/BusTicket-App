import { createBrowserRouter } from "react-router-dom";
import Layout, { type RouteHandle } from "./components/layout/layout";
import { getBasePath } from "./utils/zma";
import { copy } from "@/constants/copy";
import AdminStops from "./pages/admin-stops";
import SearchPage from "./pages/search";
import TripResultsPage from "./pages/trip-results";
import SeatMapPage from "./pages/seat-map";
import CheckoutPage from "./pages/checkout";
import BookingDetailPage from "./pages/booking-detail";
import MyBookingsPage from "./pages/my-bookings";

import OffersPage from "./pages/offers";
import SupportPage from "./pages/support";
import PassengersPage from "./pages/passengers";
import ProfilePage from "./pages/profile";

const handle = (h: RouteHandle) => h;

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <Layout />,
      children: [
        { path: "/", element: <SearchPage /> },
        { path: "/admin", element: <AdminStops />, handle: handle({title: "Quản trị nhà xe", hideFooter: true}) },
        {
          path: "/trips",
          element: <TripResultsPage />,
          handle: handle({
            title: "Danh sách chuyến xe",
            back: true,
            hideFooter: true,
          }),
        },
        {
          path: "/offers",
          element: <OffersPage />,
          handle: handle({ title: copy.offers.title }),
        },
        {
          path: "/offers/:slug",
          element: <OffersPage />,
          handle: handle({ title: copy.offers.title, back: true }),
        },
        {
          path: "/passengers",
          element: <PassengersPage />,
          handle: handle({ title: copy.passengers.title, back: true }),
        },
        {
          path: "/support",
          element: <SupportPage />,
          handle: handle({ title: copy.support.title, back: true }),
        },
        {
          path: "/profile",
          element: <ProfilePage />,
          handle: handle({ title: copy.profile.title }),
        },
        {
          path: "/trip/:tripId",
          element: <SeatMapPage />,
          handle: handle({
            title: copy.seats.title,
            back: true,
            hideFooter: true,
            whiteBackground: true,
          }),
        },
        {
          path: "/checkout",
          element: <CheckoutPage />,
          handle: handle({
            title: copy.checkout.title,
            back: true,
            hideFooter: true,
            whiteBackground: true,
          }),
        },
        {
          path: "/booking/:code",
          element: <BookingDetailPage />,
          handle: handle({
            title: copy.booking.title,
            back: true,
            hideFooter: true,
            whiteBackground: true,
          }),
        },
        {
          path: "/my-bookings",
          element: <MyBookingsPage />,
          handle: handle({
            title: copy.myBookings.title,
            whiteBackground: true,
          }),
        },
      ],
    },
  ],
  { basename: getBasePath() },
);

export default router;
