import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeStorage } from "./my-bookings.store";
import { isValidVnMobile } from "@/utils/phone";

interface ProfileState {
  name: string;
  phone: string;
  save: (name: string, phone: string) => boolean;
}

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      name: "",
      phone: "",
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
