import { describe, expect, it } from "vitest";
import {
  missingOperatorInfo,
  operatorInfoRows,
  type OperatorInfoInput,
} from "./operator-info";

const full: OperatorInfoInput = {
  brandName: "Nhà xe Phong Nhung",
  companyName: "Công ty TNHH Vận tải Phong Nhung",
  taxId: "0312345678",
  address: "12 Lê Lợi, Hoài Ân, Bình Định",
  phone: "0789 893 955",
  email: "hotro@example.vn",
  service: "Đặt vé xe khách liên tỉnh theo chuyến",
  appVersion: "5",
};

describe("operator legal info", () => {
  it("lists every required field with call and mail links", () => {
    const rows = operatorInfoRows(full);
    expect(rows.map((r) => r.key)).toEqual([
      "companyName",
      "taxId",
      "address",
      "phone",
      "email",
      "service",
      "appVersion",
    ]);
    expect(rows.find((r) => r.key === "phone")?.href).toBe("tel:0789893955");
    expect(rows.find((r) => r.key === "email")?.href).toBe(
      "mailto:hotro@example.vn",
    );
    expect(rows.every((r) => !r.href || !r.href.startsWith("http"))).toBe(true);
    expect(missingOperatorInfo(full)).toEqual([]);
  });

  it("hides blank fields and reports the required ones still missing", () => {
    const partial = {
      ...full,
      companyName: "  ",
      taxId: "",
      address: "",
      email: "",
      phone: "",
    };
    const rows = operatorInfoRows(partial);
    // Chưa có tên pháp lý thì dùng tên thương hiệu thay vì để trống.
    expect(rows[0]).toMatchObject({
      key: "companyName",
      value: "Nhà xe Phong Nhung",
    });
    expect(rows.map((r) => r.key)).not.toContain("email");
    expect(missingOperatorInfo(partial)).toEqual(["taxId", "address", "phone"]);
  });
});
