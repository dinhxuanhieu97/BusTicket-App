import { useLocation, useNavigate } from "react-router-dom";
import { HomeIcon, OrderIcon } from "@/components/common/vectors";
import { copy } from "@/constants/copy";
import { cn } from "@/utils/cn";

const NAV_ITEMS = [
  { name: copy.nav.book, path: "/", icon: HomeIcon },
  { name: copy.nav.myBookings, path: "/my-bookings", icon: OrderIcon },
];

export default function Footer() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeKey =
    NAV_ITEMS.find((item) => (item.path === "/" ? pathname === "/" : pathname.startsWith(item.path)))?.path ?? "/";

  return (
    <div className="flex justify-around border-t border-divider01 bg-white px-8 pb-5 pt-4">
      {NAV_ITEMS.map((item) => (
        <button
          type="button"
          className="flex flex-col items-center gap-1"
          key={item.path}
          onClick={() => navigate(item.path)}
        >
          <item.icon active={activeKey === item.path} />
          <div
            className={cn(
              "text-xxxxsmall",
              activeKey === item.path ? "!text-text-primary" : "!text-text-disabled",
            )}
          >
            {item.name}
          </div>
        </button>
      ))}
    </div>
  );
}
