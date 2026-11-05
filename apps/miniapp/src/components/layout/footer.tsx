import { useLocation, useNavigate } from "react-router-dom";
import { copy } from "@/constants/copy";

export default function Footer() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <nav className="pn-footer" aria-label={copy.nav.book}>
      <div className="pn-footer-inner">
        {[
          {
            path: "/",
            label: copy.nav.book,
            d: "m3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7",
          },
          {
            path: "/offers",
            label: copy.nav.offers,
            d: "M3 8h18v5H3V8Zm2 5v8h14v-8M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z",
          },
          {
            path: "/my-bookings",
            label: copy.nav.myBookings,
            d: "M4 4h16v5a3 3 0 0 0 0 6v5H4v-5a3 3 0 0 0 0-6V4Zm8 3v2m0 2v2m0 2v2",
          },
          {
            path: "/profile",
            label: copy.nav.profile,
            d: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
          },
        ].map((item) => (
          <button
            key={item.path}
            type="button"
            aria-current={
              (
                item.path === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.path) ||
                    (item.path === "/profile" &&
                      ["/passengers", "/support"].includes(pathname))
              )
                ? "page"
                : undefined
            }
            onClick={() => navigate(item.path)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={item.d} />
            </svg>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
