import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "@/lib/api-error";
import { clearSavedInfo, eraseBookingContacts } from "./clear-saved-info";
import { useBookingDraft } from "./booking-draft.store";
import { useMyBookings, type SavedBooking } from "./my-bookings.store";
import { usePassengers } from "./passengers.store";
import { useProfile } from "./profile.store";

const booking: SavedBooking = {
  code: "PN-ABC123",
  accessToken: "test-only-token",
  tripId: "trip-1",
  tripName: "Chuyến 17:30",
  departAt: "2026-11-12T10:30:00.000Z",
  route: "Hoài Ân → An Sương",
  seatCodes: ["A1"],
  createdAt: "2026-11-11T10:00:00.000Z",
};

beforeEach(() => {
  useProfile.setState({ name: "", phone: "", zaloShared: false, bookingPrefill: true });
  usePassengers.setState({ passengers: [] });
  useMyBookings.setState({ bookings: [] });
  useProfile.getState().save("Nguyễn An", "0912345678");
  useProfile.getState().markZaloShared();
  usePassengers.getState().save("Trần Bình", "0987654321");
  useMyBookings.getState().save(booking);
  useBookingDraft.getState().setContact({ contactName: "Nguyễn An", contactPhone: "0912345678" });
  useBookingDraft.getState().setPhoneToken({ phone: "0912345678", token: "t", expiresAt: "2099-01-01T00:00:00Z" });
});

const second: SavedBooking = { ...booking, code: "PN-DEF456", accessToken: "test-only-token-2" };
const third: SavedBooking = { ...booking, code: "PN-GHI789", accessToken: "test-only-token-3" };

describe("clear saved info", () => {
  it("removes contact, passengers, Zalo choice and stops refilling from the last booking", async () => {
    const erase = vi.fn();
    await clearSavedInfo({ eraseInBookings: false, removeBookings: false }, erase);
    expect(erase).not.toHaveBeenCalled();
    expect(useProfile.getState()).toMatchObject({ name: "", phone: "", zaloShared: false, bookingPrefill: false });
    expect(usePassengers.getState().passengers).toEqual([]);
    expect(useBookingDraft.getState()).toMatchObject({ contactName: "", contactPhone: "", phoneToken: null });
    // Vé vẫn giữ để khách mở lại được.
    expect(useMyBookings.getState().bookings).toHaveLength(1);
  });

  it("removes saved tickets when asked, without calling the server", async () => {
    const erase = vi.fn();
    await clearSavedInfo({ eraseInBookings: false, removeBookings: true }, erase);
    expect(erase).not.toHaveBeenCalled();
    expect(useMyBookings.getState().bookings).toEqual([]);
  });

  it("erases contact in finished bookings and keeps upcoming tickets on the device", async () => {
    useMyBookings.getState().save(second);
    useMyBookings.getState().save(third);
    const erase = vi.fn(async (code: string) => {
      if (code === second.code) throw new APIError(409, "Vé chưa đi", "CONFLICT");
      if (code === third.code) throw new APIError(404, "Không tìm thấy", "NOT_FOUND");
      return {};
    });
    const result = await clearSavedInfo({ eraseInBookings: true, removeBookings: true }, erase);
    expect(erase).toHaveBeenCalledTimes(3);
    expect(erase).toHaveBeenCalledWith(booking.code, booking.accessToken);
    expect(result).toMatchObject({ erased: 2, failed: 0 });
    expect(result.kept.map((b) => b.code)).toEqual([second.code]);
    expect(useMyBookings.getState().bookings.map((b) => b.code)).toEqual([second.code]);
    expect(useProfile.getState().name).toBe("");
  });

  it("counts network failures separately so the customer can retry", async () => {
    const result = await eraseBookingContacts([booking], async () => {
      throw new APIError(0, "Failed to fetch");
    });
    expect(result).toEqual({ erased: 0, kept: [], failed: 1 });
  });
});
