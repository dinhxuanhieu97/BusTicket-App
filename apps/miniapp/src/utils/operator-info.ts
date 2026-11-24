export interface OperatorInfoInput {
  brandName: string;
  companyName: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  service: string;
  appVersion: string;
}

export type OperatorInfoKey =
  | "companyName"
  | "taxId"
  | "address"
  | "phone"
  | "email"
  | "service"
  | "appVersion";

export interface OperatorInfoRow {
  key: OperatorInfoKey;
  label: string;
  value: string;
  /** Liên kết gọi/gửi mail (không mở trang ngoài Zalo). */
  href?: string;
}

const LABELS: Record<OperatorInfoKey, string> = {
  companyName: "Đơn vị",
  taxId: "Mã số doanh nghiệp",
  address: "Địa chỉ",
  phone: "Điện thoại",
  email: "Email",
  service: "Dịch vụ",
  appVersion: "Phiên bản ứng dụng",
};

/** Các mục Thỏa thuận Zalo Mini App 5.5(a) yêu cầu; thiếu mục nào thì hồ sơ duyệt dễ bị từ chối. */
export const REQUIRED_OPERATOR_INFO: OperatorInfoKey[] = [
  "companyName",
  "taxId",
  "address",
  "phone",
  "service",
  "appVersion",
];

/** Các dòng hiển thị trên trang Thông tin nhà xe, theo thứ tự cố định; bỏ dòng trống. */
export function operatorInfoRows(input: OperatorInfoInput): OperatorInfoRow[] {
  const phoneDigits = input.phone.replace(/[^\d+]/g, "");
  const values: Record<OperatorInfoKey, string> = {
    companyName: input.companyName.trim() || input.brandName.trim(),
    taxId: input.taxId.trim(),
    address: input.address.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    service: input.service.trim(),
    appVersion: input.appVersion.trim(),
  };
  const hrefs: Partial<Record<OperatorInfoKey, string>> = {
    phone: phoneDigits ? `tel:${phoneDigits}` : undefined,
    email: values.email ? `mailto:${values.email}` : undefined,
  };
  return (Object.keys(LABELS) as OperatorInfoKey[])
    .filter((key) => values[key])
    .map((key) => ({
      key,
      label: LABELS[key],
      value: values[key],
      ...(hrefs[key] ? { href: hrefs[key] } : {}),
    }));
}

/** Mục bắt buộc còn thiếu — dùng để cảnh báo trước khi gửi duyệt. */
export function missingOperatorInfo(input: OperatorInfoInput): OperatorInfoKey[] {
  const present = new Set(operatorInfoRows(input).map((row) => row.key));
  return REQUIRED_OPERATOR_INFO.filter((key) => !present.has(key));
}
