import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeStorage } from "./my-bookings.store";
import { isValidVnMobile } from "@/utils/phone";

interface ProfileState {
  name: string;
  phone: string;
  /** Khách đã từng cho phép Zalo chia sẻ số điện thoại: lần sau bỏ qua màn giải thích. */
  zaloShared: boolean;
  /** false sau khi khách xóa thông tin: không tự điền lại từ đơn gần nhất. */
  bookingPrefill: boolean;
  save: (name: string, phone: string) => boolean;
  markZaloShared: () => void;
  clear: () => void;
}

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      name: "",
      phone: "",
      zaloShared: false,
      bookingPrefill: true,
      markZaloShared: () => set({ zaloShared: true }),
      clear: () =>
        set({ name: "", phone: "", zaloShared: false, bookingPrefill: false }),
      save: (name, phone) => {
        if (!name.trim() || !isValidVnMobile(phone)) return false;
        set({ name: name.trim(), phone: phone.trim() });
        return true;
      },
    }),
    {
      name: "pnticket.profile.v1",
      storage: createJSONStorage(() => safeStorage),
    },
  ),
);
