import { beforeEach, describe, expect, it } from "vitest";
import { useProfile } from "./profile.store";

beforeEach(() =>
  useProfile.setState({ name: "", phone: "", zaloShared: false }),
);
describe("local profile", () => {
  it("saves trimmed valid contact information", () => {
    expect(useProfile.getState().save("  Nguyễn An  ", " 0912345678 ")).toBe(
      true,
    );
    expect(useProfile.getState()).toMatchObject({
      name: "Nguyễn An",
      phone: "0912345678",
    });
  });
  it("retains the previous profile when edits are invalid", () => {
    useProfile.getState().save("An", "0912345678");
    expect(useProfile.getState().save(" ", "0912345678")).toBe(false);
    expect(useProfile.getState().save("Bình", "123")).toBe(false);
    expect(useProfile.getState()).toMatchObject({
      name: "An",
      phone: "0912345678",
    });
  });
  it("remembers that the customer already shared their Zalo phone", () => {
    expect(useProfile.getState().zaloShared).toBe(false);
    useProfile.getState().markZaloShared();
    expect(useProfile.getState().zaloShared).toBe(true);
  });
});
