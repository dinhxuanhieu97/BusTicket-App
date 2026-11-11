/** Vai trò (PNTicketDocs mục 3, docs/NEN-TANG-DA-NHA-XE.md mục 1.2). */
export const ROLES = ['PLATFORM_ADMIN', 'OWNER', 'ACCOUNTANT', 'DISPATCHER', 'SELLER', 'ASSISTANT'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'operator.create', //       tạo nhà xe mới (chỉ nền tảng)
  'operator.list', //         xem danh sách nhà xe (chỉ nền tảng)
  'layout.library.write', //  sửa thư viện mẫu sơ đồ dùng chung (chỉ nền tảng)
  'owner.password.reset', //  đặt mật khẩu tạm cho chủ xe quên mật khẩu (chỉ nền tảng)
  'user.manage', //           tạo/sửa tài khoản nhân viên của nhà xe
  'policy.read',
  'policy.write',
  'fleet.read', //            mẫu sơ đồ riêng, xe
  'fleet.write',
  'route.read',
  'route.write',
  'trip.read',
  'trip.write',
  'trip.assigned.read', //    chỉ chuyến mình được phân công + danh sách khách của chuyến đó (phụ xe)
  'audit.read',
  'payment.configure', //     tài khoản nhận tiền + khóa webhook SePay
  'payment.read', //          xem sổ thu, khoản cần kiểm tra
  'payment.record', //        ghi nhận tiền mặt / chuyển khoản thấy trong app ngân hàng
  'payment.manage', //        phân bổ tay, đánh dấu đã xử lý, chạy đối soát
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Quyền dùng để setup nhà xe — quản trị nền tảng được làm thay chủ xe trước khi hoạt động (SETUP-NHA-XE.md mục 4). */
const SETUP: Permission[] = [
  'user.manage', 'policy.read', 'policy.write', 'fleet.read', 'fleet.write',
  'route.read', 'route.write', 'trip.read', 'trip.write', 'audit.read', 'payment.configure',
];
/** Thao tác tiền: chỉ người của nhà xe (quản trị nền tảng không động vào tiền của nhà xe). */
const MONEY: Permission[] = ['payment.read', 'payment.record', 'payment.manage'];
/** Quyền chỉ của nền tảng — không thuộc phạm vi một nhà xe. */
const PLATFORM_ONLY: ReadonlySet<Permission> = new Set<Permission>(['operator.create', 'operator.list', 'layout.library.write', 'owner.password.reset']);
/**
 * Chủ xe có toàn quyền trong nhà xe của mình: mọi quyền trừ quyền chỉ của nền tảng.
 * Quyền mới thêm vào PERMISSIONS tự động thuộc về chủ xe (không phải nhớ cập nhật tay).
 */
export const ALL_OPERATOR_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter((p) => !PLATFORM_ONLY.has(p));

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  PLATFORM_ADMIN: new Set<Permission>(['operator.create', 'operator.list', 'layout.library.write', 'owner.password.reset', ...SETUP]),
  OWNER: new Set<Permission>(ALL_OPERATOR_PERMISSIONS),
  DISPATCHER: new Set<Permission>(['policy.read', 'fleet.read', 'fleet.write', 'route.read', 'route.write', 'trip.read', 'trip.write']),
  // Bán vé tại quầy được ghi nhận tiền mặt khách trả cho đơn; không phân bổ tay/xử lý ngoại lệ.
  SELLER: new Set<Permission>(['policy.read', 'fleet.read', 'route.read', 'trip.read', 'payment.read', 'payment.record']),
  ACCOUNTANT: new Set<Permission>(['policy.read', 'fleet.read', 'route.read', 'trip.read', 'audit.read', ...MONEY]),
  // Phụ xe chỉ xem chuyến được giao và danh sách khách của các chuyến đó (lọc theo phân công ở máy chủ).
  ASSISTANT: new Set<Permission>(['trip.assigned.read']),
};

/** Vai trò bắt buộc bật 2FA (chủ xe, kế toán, quản trị nền tảng). */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set<Role>(['PLATFORM_ADMIN', 'OWNER', 'ACCOUNTANT']);

/** Chủ xe được gán các vai trò này cho nhân viên (không được tạo quản trị nền tảng). */
export const OPERATOR_ASSIGNABLE_ROLES: ReadonlySet<Role> = new Set<Role>(['OWNER', 'ACCOUNTANT', 'DISPATCHER', 'SELLER', 'ASSISTANT']);

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(perm);
}

/** Danh sách quyền của vai trò (theo thứ tự khai báo) — để giao diện dựng menu; máy chủ vẫn kiểm tra từng API. */
export function permissionsOf(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => ROLE_PERMISSIONS[role].has(p));
}
