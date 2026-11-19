import { describe, expect, it } from "vitest";
import { canSendAsIs, fitWithin } from "./proof-image";

describe("fitWithin", () => {
  it("keeps small images unchanged", () => {
    expect(fitWithin(1080, 1500)).toEqual({ width: 1080, height: 1500 });
  });
  it("scales a tall phone screenshot so the long side is 1600 px", () => {
    expect(fitWithin(1290, 2796)).toEqual({ width: 738, height: 1600 });
  });
  it("scales landscape images by width", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
  });
});

describe("canSendAsIs", () => {
  it("sends small PNG/JPEG/WebP files untouched", () => {
    expect(canSendAsIs({ type: "image/png", size: 400_000 })).toBe(true);
    expect(canSendAsIs({ type: "image/webp", size: 1_000_000 })).toBe(true);
  });
  it("re-encodes large files and other formats (HEIC, GIF)", () => {
    expect(canSendAsIs({ type: "image/jpeg", size: 1_000_001 })).toBe(false);
    expect(canSendAsIs({ type: "image/heic", size: 300_000 })).toBe(false);
    expect(canSendAsIs({ type: "image/gif", size: 10_000 })).toBe(false);
    expect(canSendAsIs({ type: "image/png", size: 0 })).toBe(false);
  });
});
