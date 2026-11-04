import { beforeEach, describe, expect, it } from "vitest";
import { useBookingDraft } from "./booking-draft.store";
import { MAX_SAVED_BOOKINGS, upsertBooking, type SavedBooking } from "./my-bookings.store";

const initial = useBookingDraft.getState();

beforeEach(() => useBookingDraft.setState(initial, true));

describe("booking draft idempotency key", () => {
  it("keeps the same key across retries of the same request", () => {
    const s = useBookingDraft.getState();
    s.openTrip("t1");
    s.setSelection({ A1: { occupancy: 1, infantCount: 0 } });
    const k1 = useBookingDraft.getState().ensureIdempotencyKey();
    const k2 = useBookingDraft.getState().ensureIdempotencyKey();
    expect(k1).toBe(k2);
  });

  it("uses a new key once the seats or contact change (server would answer IDEMPOTENCY_CONFLICT)", () => {
    const s = useBookingDraft.getState();
    s.openTrip("t1");
    const k1 = s.ensureIdempotencyKey();
    useBookingDraft.getState().setSelection({ A2: { occupancy: 1, infantCount: 0 } });
    const k2 = useBookingDraft.getState().ensureIdempotencyKey();
    useBookingDraft.getState().setContact({ contactName: "An" });
    const k3 = useBookingDraft.getState().ensureIdempotencyKey();
    expect(new Set([k1, k2, k3]).size).toBe(3);
  });

  it("drops the selection when switching to another trip but not when reopening the same one", () => {
    const s = useBookingDraft.getState();
    s.openTrip("t1");
    useBookingDraft.getState().setSelection({ A1: { occupancy: 1, infantCount: 0 } });
    useBookingDraft.getState().openTrip("t1");
    expect(useBookingDraft.getState().selection).toHaveProperty("A1");
    useBookingDraft.getState().openTrip("t2");
    expect(useBookingDraft.getState().selection).toEqual({});
  });

  it("forgets the verified phone token when the phone number changes", () => {
    const s = useBookingDraft.getState();
    s.setContact({ contactPhone: "0912345678" });
    useBookingDraft.getState().setPhoneToken({ phone: "0912345678", token: "tok", expiresAt: "2099-01-01T00:00:00Z" });
    useBookingDraft.getState().setContact({ contactName: "An" });
    expect(useBookingDraft.getState().phoneToken).not.toBeNull();
    useBookingDraft.getState().setContact({ contactPhone: "0987654321" });
    expect(useBookingDraft.getState().phoneToken).toBeNull();
  });
});

describe("saved bookings", () => {
  const b = (code: string): SavedBooking => ({
    code,
    accessToken: "t",
    tripId: "trip",
    tripName: "x",
    departAt: "2026-11-05T11:00:00Z",
    route: "",
    seatCodes: ["A1"],
    createdAt: "2026-11-04T00:00:00Z",
  });

  it("puts the newest first and replaces a booking with the same code", () => {
    const list = upsertBooking(upsertBooking([b("PN1"), b("PN2")], b("PN3")), { ...b("PN1"), accessToken: "new" });
    expect(list.map((x) => x.code)).toEqual(["PN1", "PN3", "PN2"]);
    expect(list[0].accessToken).toBe("new");
  });

  it("keeps at most the configured number of bookings", () => {
    let list: SavedBooking[] = [];
    for (let i = 0; i < MAX_SAVED_BOOKINGS + 5; i++) list = upsertBooking(list, b(`PN${i}`));
    expect(list).toHaveLength(MAX_SAVED_BOOKINGS);
    expect(list[0].code).toBe(`PN${MAX_SAVED_BOOKINGS + 4}`);
  });
});
