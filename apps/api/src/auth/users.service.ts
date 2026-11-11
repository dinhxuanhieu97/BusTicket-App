import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { normalizeVnPhone } from '../common/phone';
import { Db, isPgError, PG_UNIQUE_VIOLATION, Queryable } from '../db/db';
import { AuthUser, passwordSchema, PublicUser, toPublicUser, UserRow } from './auth.service';
import { hashPassword } from './password';
import { can, OPERATOR_ASSIGNABLE_ROLES, ROLES } from './permissions';

export const createUserSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    phone: z.string().min(1).max(30),
    password: passwordSchema,
    role: z.enum(ROLES),
  })
  .strict();

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    phone: z.string().min(1).max(30).optional(),
    role: z.enum(ROLES).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    password: passwordSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Không có thay đổi nào');

type StaffUser = PublicUser & { status: UserRow['status'] };
/** Chủ xe nhìn từ quản trị nền tảng (màn hình đặt mật khẩu tạm). */
export type OwnerAccount = StaffUser & { mustChangePassword: boolean; lockedUntil: string | null };
type StaffRow = UserRow & { archived_at: Date | null };

function toStaffUser(row: UserRow): StaffUser {
  return { ...toPublicUser(row), status: row.status };
}

function userWriteError(error: unknown): unknown {
  if (isPgError(error, PG_UNIQUE_VIOLATION) && error.constraint === 'users_phone_key') {
    return new DomainError('CONFLICT', 'Số điện thoại đã được dùng cho tài khoản khác.');
  }
  return error;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService = new AuditService(db),
  ) {}

  /** Tài khoản quản trị nền tảng đầu tiên — chỉ gọi từ script dòng lệnh, không qua HTTP. */
  async createPlatformAdmin(input: { fullName: string; phone: string; password: string }): Promise<PublicUser> {
    return toPublicUser(await this.insert(null, { ...input, role: 'PLATFORM_ADMIN' }));
  }

  /** Tạo nhân viên cho một nhà xe (người gọi đã được kiểm tra quyền `user.manage` với nhà xe này). */
  async createStaff(operatorId: string, input: z.input<typeof createUserSchema>, actor?: AuthUser): Promise<StaffUser> {
    const data = createUserSchema.parse(input);
    if (!OPERATOR_ASSIGNABLE_ROLES.has(data.role)) {
      throw new DomainError('FORBIDDEN', 'Không thể gán vai trò này cho nhân viên nhà xe.');
    }
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    if (actor) {
      return this.db.tx(async (c) => {
        await this.lockOperatorForStaffWrite(c, operatorId, actor);
        return toStaffUser(await this.insert(operatorId, data, c));
      });
    }
    const { rows } = await this.db.query('SELECT 1 FROM operators WHERE id = $1', [operatorId]);
    if (!rows[0]) throw notFound('nhà xe');
    return toStaffUser(await this.insert(operatorId, data));
  }

  async list(operatorId: string): Promise<StaffUser[]> {
    if (!isUuid(operatorId)) return [];
    const { rows } = await this.db.query<UserRow>(
      'SELECT * FROM users WHERE operator_id = $1 AND archived_at IS NULL ORDER BY created_at',
      [operatorId],
    );
    return rows.map(toStaffUser);
  }

  /** Chủ xe (chưa lưu trữ) của một nhà xe — cho quản trị nền tảng. */
  async listOwners(operatorId: string): Promise<OwnerAccount[]> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT * FROM users WHERE operator_id = $1 AND role = 'OWNER' AND archived_at IS NULL ORDER BY created_at`,
      [operatorId],
    );
    return rows.map((r) => this.toOwner(r));
  }

  /**
   * Quản trị nền tảng đặt mật khẩu tạm cho chủ xe quên mật khẩu (không tự đặt lại được vì chưa bật 2FA).
   * Mở khóa đăng nhập, thu hồi mọi phiên, bắt đổi mật khẩu ở lần đăng nhập sau; giữ nguyên 2FA.
   */
  async setOwnerTemporaryPassword(actor: AuthUser, operatorId: string, userId: string, password: string): Promise<OwnerAccount> {
    const nextPw = passwordSchema.parse(password);
    if (actor.role !== 'PLATFORM_ADMIN') throw new DomainError('FORBIDDEN', 'Chỉ quản trị nền tảng được đặt mật khẩu tạm cho chủ xe.');
    if (!isUuid(operatorId) || !isUuid(userId)) throw notFound('chủ xe');
    const passwordHash = await hashPassword(nextPw);
    return this.db.tx(async (c) => {
      await this.lockOperatorForStaffWrite(c, operatorId, actor);
      const target = await this.lockStaff(c, operatorId, userId);
      if (target.archived_at || target.role !== 'OWNER') throw notFound('chủ xe');
      const now = this.clock.now();
      const { rows } = await c.query<UserRow>(
        `UPDATE users SET password_hash = $3, must_change_password = true, token_version = token_version + 1,
                failed_login_count = 0, locked_until = NULL, updated_at = $4
         WHERE id = $1 AND operator_id = $2 RETURNING *`,
        [target.id, operatorId, passwordHash, now],
      );
      await this.revokeStaffSessions(c, target.id, now);
      await this.audit.record(
        {
          operatorId, actorUserId: actor.id, action: 'owner.password_reset', entity: 'user', entityId: target.id,
          data: { twoFactor: target.mfa_enabled, wasLocked: !!target.locked_until && target.locked_until > now },
        },
        c,
      );
      return this.toOwner(rows[0]!);
    });
  }

  private toOwner(row: UserRow): OwnerAccount {
    const now = this.clock.now();
    return {
      ...toStaffUser(row),
      mustChangePassword: row.must_change_password,
      lockedUntil: row.locked_until && row.locked_until > now ? row.locked_until.toISOString() : null,
    };
  }

  /**
   * Sửa nhân viên. Đổi số đăng nhập, vai trò, trạng thái hoặc mật khẩu thì thu hồi mọi phiên.
   * Không tự khóa/hạ quyền chính mình; nhà xe luôn phải còn ít nhất một chủ xe đang hoạt động.
   */
  async update(actor: AuthUser, operatorId: string, userId: string, input: z.input<typeof updateUserSchema>): Promise<StaffUser> {
    const data = updateUserSchema.parse(input);
    if (!isUuid(operatorId) || !isUuid(userId)) throw notFound('tài khoản');
    if (data.role && !OPERATOR_ASSIGNABLE_ROLES.has(data.role)) {
      throw new DomainError('FORBIDDEN', 'Không thể gán vai trò này cho nhân viên nhà xe.');
    }
    return this.db.tx(async (c) => {
      await this.lockOperatorForStaffWrite(c, operatorId, actor);
      const target = await this.lockStaff(c, operatorId, userId);
      if (target.archived_at) throw notFound('tài khoản');
      // So với id lấy từ DB (UUID viết hoa/thường đều trỏ cùng một hàng) — không so với chuỗi client gửi.
      if (target.id === actor.id) {
        if (data.role !== undefined || data.status !== undefined) {
          throw new DomainError('FORBIDDEN', 'Không thể tự đổi vai trò hoặc khóa tài khoản của chính mình.');
        }
        if (data.password !== undefined) {
          throw new DomainError('FORBIDDEN', 'Đổi mật khẩu của chính mình qua mục Đổi mật khẩu (cần mật khẩu hiện tại).');
        }
      }
      const nextRole = data.role ?? target.role;
      const nextStatus = data.status ?? target.status;
      if (nextRole !== 'OWNER' || nextStatus !== 'ACTIVE') {
        await this.requireOtherActiveOwner(c, operatorId, target);
      }
      const phone = data.phone === undefined ? target.phone : normalizeVnPhone(data.phone);
      const revoke = phone !== target.phone || nextRole !== target.role || nextStatus !== target.status || data.password !== undefined;
      const passwordHash = data.password === undefined ? null : await hashPassword(data.password);
      const now = this.clock.now();
      const { rows: updated } = await c.query<UserRow>(
        `UPDATE users SET full_name = $3, phone = $4, role = $5, status = $6,
                password_hash = COALESCE($7, password_hash),
                must_change_password = ($7::text IS NOT NULL) OR must_change_password,
                token_version = token_version + $8, updated_at = $9
         WHERE id = $1 AND operator_id = $2 RETURNING *`,
        [target.id, operatorId, data.fullName ?? target.full_name, phone, nextRole, nextStatus, passwordHash, revoke ? 1 : 0, now],
      );
      if (revoke) await this.revokeStaffSessions(c, target.id, now);
      return toStaffUser(updated[0]!);
    }).catch((error: unknown) => {
      throw userWriteError(error);
    });
  }

  async archive(actor: AuthUser, operatorId: string, userId: string): Promise<void> {
    if (!isUuid(operatorId) || !isUuid(userId)) throw notFound('tài khoản');
    await this.db.tx(async (c) => {
      await this.lockOperatorForStaffWrite(c, operatorId, actor);
      const target = await this.lockStaff(c, operatorId, userId);
      if (target.id === actor.id) throw new DomainError('FORBIDDEN', 'Không thể xóa tài khoản của chính mình.');
      if (target.archived_at) return;
      await this.requireOtherActiveOwner(c, operatorId, target);

      const now = this.clock.now();
      await c.query(
        `UPDATE users SET status = 'DISABLED', archived_at = $3, updated_at = $3, token_version = token_version + 1
         WHERE id = $1 AND operator_id = $2`,
        [target.id, operatorId, now],
      );
      await this.revokeStaffSessions(c, target.id, now);
      await this.audit.record({ operatorId, actorUserId: actor.id, action: 'user.archive', entity: 'user', entityId: target.id }, c);
    });
  }

  private async lockOperatorForStaffWrite(c: Queryable, operatorId: string, actor: AuthUser): Promise<void> {
    const { rowCount } = await c.query('SELECT id FROM operators WHERE id = $1 FOR NO KEY UPDATE', [operatorId]);
    if (!rowCount) throw notFound('nhà xe');
    // Recheck after waiting for the operator lock in case another staff write revoked this actor.
    const { rows } = await c.query<Pick<UserRow, 'role' | 'operator_id'>>(
      `SELECT u.role, u.operator_id FROM users u
       WHERE u.id = $1 AND u.status = 'ACTIVE'
         AND ($2::uuid IS NULL OR EXISTS (
           SELECT 1 FROM auth_sessions s WHERE s.id = $2 AND s.user_id = u.id
             AND s.token_version = u.token_version AND s.revoked_at IS NULL AND s.expires_at > $3
         ))`,
      [actor.id, actor.sessionId ?? null, this.clock.now()],
    );
    const current = rows[0];
    if (!current) throw new DomainError('UNAUTHENTICATED', 'Vui lòng đăng nhập.');
    if (current.operator_id !== null && current.operator_id !== operatorId.toLowerCase()) throw notFound('nhà xe');
    if (!can(current.role, 'user.manage')) throw new DomainError('FORBIDDEN', 'Bạn không có quyền quản lý nhân viên.');
  }

  private async lockStaff(c: Queryable, operatorId: string, userId: string): Promise<StaffRow> {
    const { rows } = await c.query<StaffRow>(
      'SELECT * FROM users WHERE id = $1 AND operator_id = $2 FOR UPDATE',
      [userId, operatorId],
    );
    if (!rows[0]) throw notFound('tài khoản');
    return rows[0];
  }

  private async requireOtherActiveOwner(c: Queryable, operatorId: string, target: StaffRow): Promise<void> {
    if (target.role !== 'OWNER' || target.status !== 'ACTIVE') return;
    const { rows } = await c.query(
      `SELECT 1 FROM users
       WHERE operator_id = $1 AND id <> $2 AND role = 'OWNER' AND status = 'ACTIVE' AND archived_at IS NULL
       LIMIT 1`,
      [operatorId, target.id],
    );
    if (!rows[0]) throw new DomainError('CONFLICT', 'Nhà xe phải còn ít nhất một chủ xe đang hoạt động.');
  }

  private async revokeStaffSessions(c: Queryable, userId: string, now: Date): Promise<void> {
    await c.query(
      `UPDATE auth_sessions SET revoked_at = $2, revoke_reason = 'CREDENTIALS_CHANGED'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, now],
    );
  }

  private async insert(
    operatorId: string | null,
    data: { fullName: string; phone: string; password: string; role: string },
    q: Queryable = this.db,
  ): Promise<UserRow> {
    const password = passwordSchema.parse(data.password);
    const phone = normalizeVnPhone(data.phone);
    try {
      const { rows } = await q.query<UserRow>(
        `INSERT INTO users (operator_id, full_name, phone, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [operatorId, data.fullName.trim(), phone, await hashPassword(password), data.role],
      );
      return rows[0]!;
    } catch (error) {
      throw userWriteError(error);
    }
  }
}
