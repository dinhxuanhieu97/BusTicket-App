import { Outlet, useMatches } from "react-router-dom";
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
  const handle = (matches[matches.length - 1]?.handle ?? {}) as RouteHandle;

  return (
    <div className="relative flex h-screen w-screen flex-col bg-background">
      {!handle.whiteBackground && <div className="absolute left-0 top-0 h-66 w-full bg-peach-fade" />}
      {!handle.hideHeader && <Header title={handle.title} back={handle.back} position={handle.headerPosition} />}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
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
