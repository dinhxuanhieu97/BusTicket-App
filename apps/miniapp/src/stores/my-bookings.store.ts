import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/**
 * Đơn đã đặt trên máy này. Chưa có đăng nhập Zalo (`/me/tickets`), nên máy phải tự giữ cặp mã đơn + `accessToken`
 * thì mới xem lại được đơn. Mất dữ liệu trình duyệt = mất danh sách (đơn vẫn còn ở nhà xe).
 */
export interface SavedBooking {
  code: string;
  accessToken: string;
  tripId: string;
  tripName: string;
  departAt: string;
  route: string;
  seatCodes: string[];
  createdAt: string;
}

interface MyBookingsState {
  bookings: SavedBooking[];
  save: (booking: SavedBooking) => void;
  find: (code: string) => SavedBooking | undefined;
}

/** localStorage có thể bị chặn hoặc ném lỗi (chế độ riêng tư, webview hạn chế): khi đó chỉ giữ trong bộ nhớ. */
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return globalThis.localStorage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      globalThis.localStorage?.setItem(k, v);
    } catch {
      /* bỏ qua */
    }
  },
  removeItem: (k) => {
    try {
      globalThis.localStorage?.removeItem(k);
    } catch {
      /* bỏ qua */
    }
  },
};

export const MAX_SAVED_BOOKINGS = 50;

export function upsertBooking(list: SavedBooking[], booking: SavedBooking): SavedBooking[] {
  const rest = list.filter((b) => b.code !== booking.code);
  return [booking, ...rest].slice(0, MAX_SAVED_BOOKINGS);
}

export const useMyBookings = create<MyBookingsState>()(
  persist(
    (set, get) => ({
      bookings: [],
      save: (booking) => set((s) => ({ bookings: upsertBooking(s.bookings, booking) })),
      find: (code) => get().bookings.find((b) => b.code === code),
    }),
    { name: "pnticket.my-bookings.v1", storage: createJSONStorage(() => safeStorage) },
  ),
);
