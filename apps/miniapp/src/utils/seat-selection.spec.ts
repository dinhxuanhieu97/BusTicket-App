import { describe, expect, it } from "vitest";
import type { Fare, SeatMap } from "@/types/api.types";
import {
  MAX_INFANTS_PER_UNIT,
  estimateTotal,
  reconcileSelection,
  setInfants,
  setOccupancy,
  toHoldItems,
  toggleSeat,
} from "./seat-selection";

const seats: SeatMap["seats"] = [
  { code: "A1", floor: "1", maxOccupancy: 2, status: "AVAILABLE" },
  { code: "A2", floor: "1", maxOccupancy: 2, status: "AVAILABLE" },
  { code: "B1", floor: "2", maxOccupancy: 1, status: "AVAILABLE" },
  { code: "B2", floor: "2", maxOccupancy: 1, status: "HELD" },
];
const fares: Fare[] = [
  { floor: "1", occupancy: 1, price: 450_000 },
  { floor: "1", occupancy: 2, price: 700_000 },
  { floor: "2", occupancy: 1, price: 420_000 },
];

describe("toggleSeat", () => {
  it("selects an available seat with one person and no infant", () => {
    expect(toggleSeat({}, seats[0], 4).selection).toEqual({ A1: { occupancy: 1, infantCount: 0 } });
  });

  it("deselects a selected seat", () => {
    const { selection } = toggleSeat({ A1: { occupancy: 2, infantCount: 1 } }, seats[0], 4);
    expect(selection).toEqual({});
  });

  it("refuses a seat that is not available", () => {
    const before = {};
    const r = toggleSeat(before, seats[3], 4);
    expect(r.error).toBe("NOT_AVAILABLE");
    expect(r.selection).toBe(before);
  });

  it("refuses more seats than the operator allows per booking", () => {
    const sel = { A1: { occupancy: 1, infantCount: 0 } };
    const r = toggleSeat(sel, seats[1], 1);
    expect(r.error).toBe("MAX_UNITS");
    expect(r.selection).toBe(sel);
  });

  it("still lets the customer deselect when at the limit", () => {
    const r = toggleSeat({ A1: { occupancy: 1, infantCount: 0 } }, seats[0], 1);
    expect(r.error).toBeUndefined();
    expect(r.selection).toEqual({});
  });
});

describe("occupancy and infants", () => {
  const sel = { A1: { occupancy: 1, infantCount: 0 } };

  it("clamps occupancy to the room capacity", () => {
    expect(setOccupancy(sel, "A1", 2, 2).A1.occupancy).toBe(2);
    expect(setOccupancy(sel, "A1", 3, 2).A1.occupancy).toBe(2);
    expect(setOccupancy(sel, "A1", 2, 1).A1.occupancy).toBe(1);
    expect(setOccupancy(sel, "A1", 0, 2).A1.occupancy).toBe(1);
  });

  it("clamps infants between 0 and the server maximum", () => {
    expect(setInfants(sel, "A1", 5).A1.infantCount).toBe(MAX_INFANTS_PER_UNIT);
    expect(setInfants(sel, "A1", -1).A1.infantCount).toBe(0);
  });

  it("infants only go with a single room: switching to a double room drops them", () => {
    const withInfant = setInfants(sel, "A1", 1);
    expect(withInfant.A1.infantCount).toBe(1);
    expect(setOccupancy(withInfant, "A1", 2, 2).A1).toEqual({ occupancy: 2, infantCount: 0 });
  });

  it("does not add infants to a double room", () => {
    expect(setInfants({ A1: { occupancy: 2, infantCount: 0 } }, "A1", 1).A1.infantCount).toBe(0);
  });

  it("caps infants at the operator's maxPerUnit when given", () => {
    expect(setInfants(sel, "A1", 2, 1).A1.infantCount).toBe(1);
    expect(setInfants(sel, "A1", 2, 0).A1.infantCount).toBe(0);
  });

  it("ignores seats that are not selected", () => {
    expect(setOccupancy(sel, "B1", 2, 2)).toBe(sel);
    expect(setInfants(sel, "B1", 1)).toBe(sel);
  });
});

describe("reconcileSelection", () => {
  it("clears infants above a lowered policy cap so the user is not stuck with a hidden control", () => {
    const sel = { A1: { occupancy: 1, infantCount: 1 } };
    expect(reconcileSelection(sel, seats, 0).selection.A1.infantCount).toBe(0);
    expect(reconcileSelection(sel, seats, 1).selection).toBe(sel);
  });

  it("drops seats somebody else just held and reports them", () => {
    const sel = { A1: { occupancy: 1, infantCount: 0 }, B2: { occupancy: 1, infantCount: 0 } };
    const r = reconcileSelection(sel, seats);
    expect(r.removed).toEqual(["B2"]);
    expect(r.selection).toEqual({ A1: { occupancy: 1, infantCount: 0 } });
  });

  it("drops seats that no longer exist on the trip", () => {
    const r = reconcileSelection({ Z9: { occupancy: 1, infantCount: 0 } }, seats);
    expect(r.removed).toEqual(["Z9"]);
    expect(r.selection).toEqual({});
  });

  it("returns the same object when nothing changed (no re-render loop)", () => {
    const sel = { A1: { occupancy: 2, infantCount: 0 } };
    const r = reconcileSelection(sel, seats);
    expect(r.selection).toBe(sel);
    expect(r.removed).toEqual([]);
  });

  it("lowers occupancy when the room capacity went down", () => {
    const r = reconcileSelection({ B1: { occupancy: 2, infantCount: 0 } }, seats);
    expect(r.selection).toEqual({ B1: { occupancy: 1, infantCount: 0 } });
  });
});

describe("estimateTotal", () => {
  it("sums the fare of each seat by floor and occupancy", () => {
    const sel = { A1: { occupancy: 2, infantCount: 0 }, B1: { occupancy: 1, infantCount: 1 } };
    expect(estimateTotal(sel, seats, fares)).toBe(700_000 + 420_000);
  });

  it("returns null when a fare is missing instead of guessing", () => {
    expect(estimateTotal({ B1: { occupancy: 2, infantCount: 0 } }, seats, fares)).toBeNull();
  });

  it("is zero for an empty selection", () => {
    expect(estimateTotal({}, seats, fares)).toBe(0);
  });

  it("adds the infant price from the operator's child policy", () => {
    const sel = { B1: { occupancy: 1, infantCount: 1 } };
    expect(estimateTotal(sel, seats, fares, { price: 50_000 })).toBe(420_000 + 50_000);
    expect(estimateTotal(sel, seats, fares, { price: 0 })).toBe(420_000);
  });
});

describe("toHoldItems", () => {
  it("orders seats naturally so the same choice always gives the same request", () => {
    const items = toHoldItems({
      A10: { occupancy: 1, infantCount: 0 },
      A2: { occupancy: 2, infantCount: 0 },
      A1: { occupancy: 1, infantCount: 0 },
    });
    expect(items.map((i) => i.seatCode)).toEqual(["A1", "A2", "A10"]);
    expect(items[1]).toEqual({ seatCode: "A2", occupancy: 2, infantCount: 0 });
  });
});
