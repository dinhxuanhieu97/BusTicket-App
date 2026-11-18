import { create } from "zustand";
import { vnDate } from "@/utils/time";

export interface TripSearch {
  adults?: number;
  infants?: number;
  date: string;
  origin: string;
  destination: string;
  /** Điểm đón/trả khách chọn ngay ở form tìm (điền sẵn ở bước thanh toán nếu chuyến có điểm đó). */
  pickup?: string;
  dropoff?: string;
  roundTrip: boolean;
  returnDate: string;
}
/** Retain criteria while navigating between search, seats and orders in this session. */
export const useTripSearch = create<{
  search: TripSearch;
  submit: (search: TripSearch) => void;
}>((set) => ({
  search: {
    date: vnDate(new Date()),
    origin: "",
    destination: "",
    roundTrip: false,
    returnDate: "",
  },
  submit: (search) => set({ search }),
}));
