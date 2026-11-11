import { create } from "zustand";
import type { TripSummary } from "@/types/api.types";
import type { Selection } from "@/utils/seat-selection";
import { newBookingAttempt, type BookingAttempt } from "@/utils/ids";
import { normalizeVnMobile } from "@/utils/phone";

/**
 * Đơn đang soạn (thay cho giỏ hàng của template): chuyến, chỗ đã chọn, thông tin liên hệ.
 *
 * Keep the same attempt credentials when retrying an unchanged request. A change to
 * the booking payload starts a new attempt. Refreshing phone verification does not.
 */
interface BookingDraftState {
  pair: [TripSummary, TripSummary] | null;
  selections: Record<string, Selection>;
  startJourney: (trip: TripSummary, inbound?: TripSummary) => void;
  tripId: string | null;
  /** Thông tin chuyến từ màn tìm chuyến (không có khi mở thẳng đường dẫn sơ đồ chỗ). */
  trip: TripSummary | null;
  selection: Selection;
  note: string;
  setNote: (note: string) => void;
  contactName: string;
  contactPhone: string;
  /** Token "đã xác thực SĐT" (chế độ cao điểm), gắn với đúng số đã xác thực. */
  phoneToken: { phone: string; token: string; expiresAt: string } | null;
  holdAttempt: BookingAttempt | null;

  /** Mở một chuyến; đổi sang chuyến khác thì bỏ các chỗ đã chọn của chuyến cũ. */
  openTrip: (tripId: string, trip?: TripSummary) => void;
  setSelection: (selection: Selection) => void;
  setContact: (contact: {
    contactName?: string;
    contactPhone?: string;
  }) => void;
  setPhoneToken: (phoneToken: BookingDraftState["phoneToken"]) => void;
  ensureHoldAttempt: () => BookingAttempt;
  /** Sau khi giữ chỗ thành công: bỏ lựa chọn, giữ lại tên/SĐT cho lần đặt sau. */
  completed: () => void;
}

export const useBookingDraft = create<BookingDraftState>((set, get) => ({
  pair: null,
  selections: {},
  startJourney: (trip, inbound) =>
    set({
      pair: inbound ? [trip, inbound] : null,
      trip,
      tripId: trip.id,
      selection: {},
      selections: {},
      holdAttempt: null,
      note: "",
    }),
  tripId: null,
  trip: null,
  selection: {},
  note: "",
  setNote: (note) => set((s) => ({ note, holdAttempt: note.trim() === s.note.trim() ? s.holdAttempt : null })),
  contactName: "",
  contactPhone: "",
  phoneToken: null,
  holdAttempt: null,

  openTrip: (tripId, trip) => {
    const s = get();
    if (s.tripId === tripId) {
      if (trip) set({ trip });
      return;
    }
    set({
      tripId,
      trip: trip ?? s.pair?.find((t) => t.id === tripId) ?? null,
      pair: s.pair?.some((t) => t.id === tripId) ? s.pair : null,
      selection: s.pair?.some((t) => t.id === tripId)
        ? (s.selections[tripId] ?? {})
        : {},
      note: "",
      holdAttempt: null,
    });
  },
  setSelection: (selection) =>
    set((s) => ({
      selection,
      selections:
        s.pair && s.tripId ? { ...s.selections, [s.tripId]: selection } : {},
      holdAttempt: null,
    })),
  setContact: (contact) =>
    set((s) => {
      const currentPhone = normalizeVnMobile(s.contactPhone) ?? s.contactPhone.trim();
      const phoneChanged = contact.contactPhone !== undefined &&
        (normalizeVnMobile(contact.contactPhone) ?? contact.contactPhone.trim()) !== currentPhone;
      const nameChanged = contact.contactName !== undefined && contact.contactName.trim() !== s.contactName.trim();
      return {
        ...contact,
        holdAttempt: phoneChanged || nameChanged ? null : s.holdAttempt,
        phoneToken: phoneChanged ? null : s.phoneToken,
      };
    }),
  setPhoneToken: (phoneToken) => set({ phoneToken }),
  ensureHoldAttempt: () => {
    const existing = get().holdAttempt;
    if (existing) return existing;
    const attempt = newBookingAttempt();
    set({ holdAttempt: attempt });
    return attempt;
  },
  completed: () =>
    set({
      pair: null,
      selections: {},
      selection: {},
      note: "",
      holdAttempt: null,
    }),
}));
