import { beforeEach, describe, expect, it } from "vitest";
import { usePassengers } from "./passengers.store";
beforeEach(() => usePassengers.setState({ passengers: [] }));
describe("saved passengers", () => {
  it("adds, edits and removes the selected passenger without affecting others", () => {
    const store = usePassengers.getState();
    expect(store.save("An", "0912345678")).toBe(true);
    expect(store.save("Bình", "0987654321")).toBe(true);
    const [first, second] = usePassengers.getState().passengers;
    expect(store.save(" An mới ", "0912345678", first.id)).toBe(true);
    expect(usePassengers.getState().passengers[0].name).toBe("An mới");
    store.remove(first.id);
    expect(usePassengers.getState().passengers).toEqual([second]);
  });
  it("rejects invalid contact details and stale edit IDs", () => {
    const store = usePassengers.getState();
    expect(store.save(" ", "0912345678")).toBe(false);
    expect(store.save("An", "123")).toBe(false);
    expect(store.save("An", "0912345678", "missing")).toBe(false);
    expect(usePassengers.getState().passengers).toEqual([]);
  });
});
