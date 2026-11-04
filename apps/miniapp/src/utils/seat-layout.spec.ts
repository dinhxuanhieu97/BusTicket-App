import { describe, expect, it } from "vitest";
import { buildFloorGrid } from "./seat-layout";

// Tầng dưới BED40 trong apps/api/src/seat-layouts/library.ts.
const BED40_LOWER = {
  code: "1",
  label: "Tầng dưới",
  rows: ["TX . _ . CUA", "A1 . B1 . C1", "D1 D2 D3 D4 D5"],
};

describe("buildFloorGrid", () => {
  it("maps markers and seats with their server status", () => {
    const grid = buildFloorGrid(BED40_LOWER, [
      { code: "A1", floor: "1", maxOccupancy: 1, status: "AVAILABLE" },
      { code: "B1", floor: "1", maxOccupancy: 1, status: "HELD" },
      { code: "C1", floor: "1", maxOccupancy: 1, status: "BOOKED" },
    ]);
    expect(grid.columns).toBe(5);
    expect(grid.rows[0].map((c) => (c.kind === "marker" ? c.label : c.code))).toEqual(["Tài xế", "", "", "", "Cửa"]);
    const row1 = grid.rows[1];
    expect(row1[0]).toMatchObject({ kind: "seat", code: "A1", status: "AVAILABLE" });
    expect(row1[2]).toMatchObject({ kind: "seat", code: "B1", status: "HELD" });
    expect(row1[4]).toMatchObject({ kind: "seat", code: "C1", status: "BOOKED" });
  });

  it("treats a seat missing from the server response as not for sale", () => {
    const grid = buildFloorGrid(BED40_LOWER, []);
    expect(grid.rows[2][0]).toMatchObject({ kind: "seat", code: "D1", status: "BLOCKED" });
  });

  it("pads short rows so every row has the same number of columns", () => {
    const grid = buildFloorGrid({ code: "1", label: "x", rows: ["A1 A2 A3", "A4"] }, []);
    expect(grid.columns).toBe(3);
    expect(grid.rows[1]).toHaveLength(3);
    expect(grid.rows[1][1]).toMatchObject({ kind: "marker" });
  });

  it("ignores extra whitespace between cells", () => {
    const grid = buildFloorGrid({ code: "1", label: "x", rows: ["  A1   .  A2 "] }, []);
    expect(grid.rows[0].map((c) => (c.kind === "seat" ? c.code : c.token))).toEqual(["A1", ".", "A2"]);
  });

  it("keeps room capacity from the server", () => {
    const grid = buildFloorGrid({ code: "1", label: "x", rows: ["A1 . A2"] }, [
      { code: "A1", floor: "1", maxOccupancy: 2, status: "AVAILABLE" },
    ]);
    expect(grid.rows[0][0]).toMatchObject({ maxOccupancy: 2 });
  });
});
