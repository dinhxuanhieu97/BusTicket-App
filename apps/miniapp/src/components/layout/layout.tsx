import { useLayoutEffect, useRef } from "react";
import { Outlet, useMatches, useLocation } from "react-router-dom";
import Header from "./header";
import Footer from "./footer";

/** Cấu hình layout theo từng route qua `handle` trong router.tsx. */
export interface RouteHandle {
  title?: string;
  back?: boolean;
  hideHeader?: boolean;
  hideFooter?: boolean;
  whiteBackground?: boolean;
  headerPosition?: "fixed" | "sticky" | "static" | "relative";
}

export default function Layout() {
  const matches = useMatches();
  const { pathname } = useLocation();
  const scrollArea = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scrollArea.current?.scrollTo(0, 0);
  }, [pathname]);
  const handle = (matches[matches.length - 1]?.handle ?? {}) as RouteHandle;

  return (
    <div className="pn-shell">
      {!handle.hideHeader && (
        <Header
          title={handle.title}
          back={handle.back}
          position={handle.headerPosition}
        />
      )}
      <div className="pn-main" ref={scrollArea}>
        <Outlet />
      </div>
      {!handle.hideFooter && (
        <div className="relative shrink-0">
          <Footer />
        </div>
      )}
    </div>
  );
}
