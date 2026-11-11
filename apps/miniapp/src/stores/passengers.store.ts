import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeStorage } from "./my-bookings.store";
import { isValidVnMobile } from "@/utils/phone";
import { newLocalId } from "@/utils/ids";

export interface Passenger {
  id: string;
  name: string;
  phone: string;
}
export const usePassengers = create<{
  passengers: Passenger[];
  save: (name: string, phone: string, id?: string) => boolean;
  remove: (id: string) => void;
}>()(
  persist(
    (set, get) => ({
      passengers: [],
      save: (name, phone, id) => {
        if (!name.trim() || !isValidVnMobile(phone)) return false;
        if (id && !get().passengers.some((p) => p.id === id)) return false;
        const person = {
          id: id ?? newLocalId(),
          name: name.trim(),
          phone: phone.trim(),
        };
        set((s) => ({
          passengers: id
            ? s.passengers.map((p) => (p.id === id ? person : p))
            : [...s.passengers, person],
        }));
        return true;
      },
      remove: (id) =>
        set((s) => ({ passengers: s.passengers.filter((p) => p.id !== id) })),
    }),
    {
      name: "pnticket.passengers.v1",
      storage: createJSONStorage(() => safeStorage),
    },
  ),
);
