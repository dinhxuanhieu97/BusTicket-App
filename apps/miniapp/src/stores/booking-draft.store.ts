import { create } from "zustand";
import type { TripSummary } from "@/types/api.types";
import type { Selection } from "@/utils/seat-selection";
import { newIdempotencyKey } from "@/utils/ids";

/**
 * Đơn đang soạn (thay cho giỏ hàng của template): chuyến, chỗ đã chọn, thông tin liên hệ.
 *
 * `idempotencyKey` được sinh ở lần bấm "Giữ chỗ" đầu tiên và **giữ nguyên khi gửi lại** (mạng chập chờn) để máy chủ
 * trả lại đúng đơn cũ. Mọi thay đổi chỗ/thông tin liên hệ xóa khóa, vì cùng khóa với nội dung khác bị máy chủ từ chối
 * (`IDEMPOTENCY_CONFLICT`).
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
  idempotencyKey: string | null;

  /** Mở một chuyến; đổi sang chuyến khác thì bỏ các chỗ đã chọn của chuyến cũ. */
  openTrip: (tripId: string, trip?: TripSummary) => void;
  setSelection: (selection: Selection) => void;
  setContact: (contact: {
    contactName?: string;
    contactPhone?: string;
  }) => void;
  setPhoneToken: (phoneToken: BookingDraftState["phoneToken"]) => void;
  /** Khóa của lần giữ chỗ hiện tại (tạo nếu chưa có). */
  ensureIdempotencyKey: () => string;
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
      idempotencyKey: null,
      note: "",
    }),
  tripId: null,
  trip: null,
  selection: {},
  note: "",
  setNote: (note) => set({ note, idempotencyKey: null }),
  contactName: "",
  contactPhone: "",
  phoneToken: null,
  idempotencyKey: null,

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
      idempotencyKey: null,
    });
  },
  setSelection: (selection) =>
    set((s) => ({
      selection,
      selections:
        s.pair && s.tripId ? { ...s.selections, [s.tripId]: selection } : {},
      idempotencyKey: null,
    })),
  setContact: (contact) =>
    set((s) => {
      const phoneChanged =
        contact.contactPhone !== undefined &&
        contact.contactPhone !== s.contactPhone;
      return {
        ...contact,
        idempotencyKey: null,
        phoneToken: phoneChanged ? null : s.phoneToken,
      };
    }),
  setPhoneToken: (phoneToken) => set({ phoneToken, idempotencyKey: null }),
  ensureIdempotencyKey: () => {
    const existing = get().idempotencyKey;
    if (existing) return existing;
    const key = newIdempotencyKey();
    set({ idempotencyKey: key });
    return key;
  },
  completed: () =>
    set({
      pair: null,
      selections: {},
      selection: {},
      note: "",
      idempotencyKey: null,
    }),
}));
