/** Vai trò (PNTicketDocs mục 3, docs/NEN-TANG-DA-NHA-XE.md mục 1.2). */
export const ROLES = ['PLATFORM_ADMIN', 'OWNER', 'ACCOUNTANT', 'DISPATCHER', 'SELLER', 'ASSISTANT'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'operator.create', //       tạo nhà xe mới (chỉ nền tảng)
  'operator.list', //         xem danh sách nhà xe (chỉ nền tảng)
  'layout.library.write', //  sửa thư viện mẫu sơ đồ dùng chung (chỉ nền tảng)
  'user.manage', //           tạo/sửa tài khoản nhân viên của nhà xe
  'policy.read',
  'policy.write',
  'fleet.read', //            mẫu sơ đồ riêng, xe
  'fleet.write',
  'route.read',
  'route.write',
  'trip.read',
  'trip.write',
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Quyền dùng để setup nhà xe — quản trị nền tảng được làm thay chủ xe trước khi hoạt động (SETUP-NHA-XE.md mục 4). */
const SETUP: Permission[] = [
  'user.manage', 'policy.read', 'policy.write', 'fleet.read', 'fleet.write',
  'route.read', 'route.write', 'trip.read', 'trip.write', 'audit.read',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  PLATFORM_ADMIN: new Set<Permission>(['operator.create', 'operator.list', 'layout.library.write', ...SETUP]),
  OWNER: new Set<Permission>(SETUP),
  DISPATCHER: new Set<Permission>(['policy.read', 'fleet.read', 'fleet.write', 'route.read', 'route.write', 'trip.read', 'trip.write']),
  SELLER: new Set<Permission>(['policy.read', 'fleet.read', 'route.read', 'trip.read']),
  ACCOUNTANT: new Set<Permission>(['policy.read', 'fleet.read', 'route.read', 'trip.read', 'audit.read']),
  // Phụ xe chỉ xem chuyến được giao — làm ở T8 (danh sách khách theo chuyến).
  ASSISTANT: new Set<Permission>(),
};

/** Vai trò bắt buộc bật 2FA (chủ xe, kế toán, quản trị nền tảng). */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set<Role>(['PLATFORM_ADMIN', 'OWNER', 'ACCOUNTANT']);

/** Chủ xe được gán các vai trò này cho nhân viên (không được tạo quản trị nền tảng). */
export const OPERATOR_ASSIGNABLE_ROLES: ReadonlySet<Role> = new Set<Role>(['OWNER', 'ACCOUNTANT', 'DISPATCHER', 'SELLER', 'ASSISTANT']);

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(perm);
}
