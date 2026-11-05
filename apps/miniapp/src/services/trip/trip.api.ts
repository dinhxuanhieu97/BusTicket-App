import { config } from "@/config";
import { apiRequest } from "@/lib/api-client";
import type { OpenRoute, SeatMap, TripSummary } from "@/types/api.types";

export const tripService = {
  /** Chuyến đang mở bán trong ngày (giờ VN) của nhà xe mà bản Mini App này phục vụ. */
  search: (date: string, routeCode?: string) => {
    const q = new URLSearchParams({ date });
    if (routeCode) q.set("route", routeCode);
    return apiRequest<{ trips: TripSummary[] }>(
      `/operators/${encodeURIComponent(config.operatorCode)}/trips?${q.toString()}`,
    ).then((r) => r.trips);
  },

  openRoutes: () =>
    apiRequest<{ routes: OpenRoute[] }>(
      `/operators/${encodeURIComponent(config.operatorCode)}/open-routes`,
    ).then((response) => response.routes),

  seatMap: (tripId: string) =>
    apiRequest<SeatMap>(`/trips/${encodeURIComponent(tripId)}/seats`),
};
