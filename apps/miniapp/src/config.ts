function env(name: string): string {
  return ((import.meta.env[name] as string | undefined) ?? "").trim();
}

/** Cấu hình theo từng bản Mini App (mỗi nhà xe một bản, cùng mã nguồn). Đọc từ biến môi trường lúc build. */
export const config = {
  supportPhone:
    (import.meta.env.VITE_SUPPORT_PHONE as string | undefined) ||
    ((import.meta.env.VITE_OPERATOR_CODE || "PN") === "PN" ? "0789893955" : ""),
  operatorCode:
    (import.meta.env.VITE_OPERATOR_CODE as string | undefined) || "PN",
  operatorName:
    (import.meta.env.VITE_OPERATOR_NAME as string | undefined) ||
    "Đặt vé xe Hoài Ân",
  /**
   * Thông tin pháp lý bắt buộc hiển thị theo Thỏa thuận Zalo Mini App mục 5.5.
   * Mỗi nhà xe một bản build nên đọc từ biến môi trường; để trống thì trang Thông tin nhà xe không hiện dòng đó.
   */
  legal: {
    companyName: env("VITE_OPERATOR_LEGAL_NAME"),
    taxId: env("VITE_OPERATOR_TAX_ID"),
    address: env("VITE_OPERATOR_ADDRESS"),
    email: env("VITE_OPERATOR_EMAIL"),
    service:
      env("VITE_OPERATOR_SERVICE") || "Đặt vé xe khách liên tỉnh theo chuyến",
  },
  /** Số phiên bản Mini App hiển thị cho khách; đặt `VITE_APP_VERSION` khớp phiên bản gửi duyệt trên Zalo. */
  appVersion: env("VITE_APP_VERSION") || __APP_VERSION__,
  /** Rỗng = gọi `/api` cùng origin (dev qua proxy của Vite). */
  apiBaseUrl: (
    (import.meta.env.VITE_API_BASE_URL as string | undefined) || ""
  ).replace(/\/$/, ""),
};
