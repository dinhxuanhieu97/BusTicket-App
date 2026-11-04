/** Cấu hình theo từng bản Mini App (mỗi nhà xe một bản, cùng mã nguồn). Đọc từ biến môi trường lúc build. */
export const config = {
  operatorCode: (import.meta.env.VITE_OPERATOR_CODE as string | undefined) || "PN",
  operatorName: (import.meta.env.VITE_OPERATOR_NAME as string | undefined) || "Nhà xe Phong Nhung",
  /** Rỗng = gọi `/api` cùng origin (dev qua proxy của Vite). */
  apiBaseUrl: ((import.meta.env.VITE_API_BASE_URL as string | undefined) || "").replace(/\/$/, ""),
};
