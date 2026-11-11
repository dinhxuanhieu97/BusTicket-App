import { APIError } from "@/lib/api-error";
import { bookingService } from "@/services/booking/booking.api";
import { useBookingDraft } from "./booking-draft.store";
import { useMyBookings, type SavedBooking } from "./my-bookings.store";
import { usePassengers } from "./passengers.store";
import { useProfile } from "./profile.store";

export interface ClearOptions {
  /** Xóa họ tên, SĐT trong các đơn đã xong ở máy chủ. */
  eraseInBookings: boolean;
  /** Bỏ danh sách vé khỏi máy (vé chưa xóa được thông tin vẫn giữ lại). */
  removeBookings: boolean;
}

export interface ClearResult {
  erased: number;
  /** Vé sắp đi hoặc còn tiền cần đối soát: nhà xe vẫn cần thông tin liên hệ. */
  kept: SavedBooking[];
  /** Lỗi mạng hoặc máy chủ: thử lại sau. */
  failed: number;
}

type Eraser = (code: string, accessToken: string) => Promise<unknown>;

/** Gọi xóa thông tin cho từng đơn; đơn không còn truy cập được (404) coi như không còn dữ liệu để xóa. */
export async function eraseBookingContacts(
  bookings: SavedBooking[],
  erase: Eraser = bookingService.eraseContact,
): Promise<ClearResult> {
  const results = await Promise.allSettled(bookings.map((b) => erase(b.code, b.accessToken)));
  const result: ClearResult = { erased: 0, kept: [], failed: 0 };
  results.forEach((r, i) => {
    if (r.status === "fulfilled") result.erased += 1;
    else if (r.reason instanceof APIError && r.reason.status === 404) result.erased += 1;
    else if (r.reason instanceof APIError && r.reason.code === "CONFLICT") result.kept.push(bookings[i]!);
    else result.failed += 1;
  });
  return result;
}

/**
 * Xóa thông tin cá nhân khách đã lưu (Thỏa thuận Zalo Mini App 5.3.3(d): khách tự xóa dữ liệu đã chia sẻ).
 * Xóa ở máy chủ trước vì cần token của từng vé; vé chưa xóa được thông tin thì giữ trên máy để khách còn mở vé
 * và xóa lại sau chuyến đi.
 */
export async function clearSavedInfo(
  { eraseInBookings, removeBookings }: ClearOptions,
  erase?: Eraser,
): Promise<ClearResult> {
  const bookings = useMyBookings.getState().bookings;
  const result = eraseInBookings
    ? await eraseBookingContacts(bookings, erase)
    : { erased: 0, kept: [], failed: 0 };
  useProfile.getState().clear();
  usePassengers.setState({ passengers: [] });
  const draft = useBookingDraft.getState();
  draft.setContact({ contactName: "", contactPhone: "" });
  draft.setPhoneToken(null);
  if (removeBookings) {
    const keep = new Set(result.kept.map((b) => b.code));
    useMyBookings.setState({ bookings: bookings.filter((b) => keep.has(b.code)) });
  }
  return result;
}
