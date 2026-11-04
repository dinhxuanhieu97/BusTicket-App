import { describe, expect, it } from "vitest";
import { isValidVnMobile } from "./phone";

describe("isValidVnMobile", () => {
  it.each(["0912345678", "0912 345 678", "0912.345.678", "84912345678", "+84 912 345 678", "0389999999"])(
    "accepts %s",
    (v) => expect(isValidVnMobile(v)).toBe(true),
  );

  it.each(["", "091234567", "09123456789", "0212345678", "+1 912 345 678", "abc"])("rejects %s", (v) =>
    expect(isValidVnMobile(v)).toBe(false),
  );
});
