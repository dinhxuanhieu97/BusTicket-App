import { useOpenRoutes } from "@/services/trip/trip.queries";
import type { OpenRoute } from "@/types/api.types";
import { BusIcon } from "@/components/common/bus-icon";
import { Notice } from "@/components/common/notice";
import { copy } from "@/constants/copy";

export function DiscoverRoutes({
  onChoose,
}: {
  onChoose: (route: OpenRoute) => void;
}) {
  const routes = useOpenRoutes();
  return (
    <section className="pn-discover" aria-labelledby="discover-heading">
      <h2 id="discover-heading" className="pn-section-title">
        Khám phá
      </h2>
      <div className="pn-discover-panel">
        <h3>Tuyến xe đang mở bán</h3>
        {routes.isLoading ? (
          <p role="status">Đang tải tuyến xe…</p>
        ) : routes.isError ? (
          <Notice
            tone="error"
            action={{
              label: copy.common.retry,
              onClick: () => void routes.refetch(),
              disabled: routes.isFetching,
            }}
          >
            Chưa tải được tuyến xe.
          </Notice>
        ) : !routes.data?.length ? (
          <p className="pn-meta">Hiện chưa có tuyến còn chỗ mở bán.</p>
        ) : (
          <ul>
            {routes.data.map((route) => (
              <li key={route.code}>
                <button
                  type="button"
                  className="pn-discover-route"
                  onClick={() => onChoose(route)}
                >
                  <span className="pn-route-icon">
                    <BusIcon aria-hidden="true" />
                  </span>
                  <span>
                    <strong>
                      {route.origin} → {route.destination}
                    </strong>
                    <small>{route.tripCount} chuyến</small>
                  </span>
                  <span className="pn-route-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
