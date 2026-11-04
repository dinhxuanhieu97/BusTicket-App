import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { tripService } from "./trip.api";

export const tripKeys = {
  search: (date: string) => ["trips", date] as const,
  seatMap: (tripId: string) => ["seat-map", tripId] as const,
};

/** Sơ đồ chỗ tự tải lại mỗi 5 giây; kết quả giữ chỗ của máy chủ mới là quyết định cuối cùng. */
export const SEAT_MAP_REFRESH_MS = 5_000;

export function useTrips(date: string) {
  return useQuery({
    queryKey: tripKeys.search(date),
    queryFn: () => tripService.search(date),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useSeatMap(tripId: string) {
  return useQuery({
    queryKey: tripKeys.seatMap(tripId),
    queryFn: () => tripService.seatMap(tripId),
    enabled: !!tripId,
    staleTime: 0,
    refetchInterval: SEAT_MAP_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}
