import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { normalizeVnPhone } from '../common/phone';
import { Db, isPgError, PG_UNIQUE_VIOLATION, Queryable } from '../db/db';
import { AuthUser, passwordSchema, PublicUser, toPublicUser, UserRow } from './auth.service';
import { hashPassword } from './password';
import { OPERATOR_ASSIGNABLE_ROLES, ROLES } from './permissions';

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
    role: z.enum(ROLES).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    password: passwordSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Không có thay đổi nào');

@Injectable()
export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** Tài khoản quản trị nền tảng đầu tiên — chỉ gọi từ script dòng lệnh, không qua HTTP. */
  async createPlatformAdmin(input: { fullName: string; phone: string; password: string }): Promise<PublicUser> {
    return this.insert(null, { ...input, role: 'PLATFORM_ADMIN' });
  }

  /** Tạo nhân viên cho một nhà xe (người gọi đã được kiểm tra quyền `user.manage` với nhà xe này). */
  async createStaff(operatorId: string, input: z.input<typeof createUserSchema>): Promise<PublicUser> {
    const data = createUserSchema.parse(input);
    if (!OPERATOR_ASSIGNABLE_ROLES.has(data.role)) {
      throw new DomainError('FORBIDDEN', 'Không thể gán vai trò này cho nhân viên nhà xe.');
    }
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    const { rows } = await this.db.query('SELECT 1 FROM operators WHERE id = $1', [operatorId]);
    if (!rows[0]) throw notFound('nhà xe');
    return this.insert(operatorId, data);
  }

  async list(operatorId: string): Promise<PublicUser[]> {
    if (!isUuid(operatorId)) return [];
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE operator_id = $1 ORDER BY created_at', [operatorId]);
    return rows.map(toPublicUser);
  }

  /**
   * Sửa nhân viên. Đổi vai trò/trạng thái/mật khẩu thì thu hồi mọi phiên của người đó.
   * Không tự khóa/hạ quyền chính mình; nhà xe luôn phải còn ít nhất một chủ xe đang hoạt động.
   */
  async update(actor: AuthUser, operatorId: string, userId: string, input: z.input<typeof updateUserSchema>): Promise<PublicUser> {
    const data = updateUserSchema.parse(input);
    if (!isUuid(operatorId) || !isUuid(userId)) throw notFound('tài khoản');
    if (data.role && !OPERATOR_ASSIGNABLE_ROLES.has(data.role)) {
      throw new DomainError('FORBIDDEN', 'Không thể gán vai trò này cho nhân viên nhà xe.');
    }
    if (actor.id === userId && (data.role !== undefined || data.status !== undefined)) {
      throw new DomainError('FORBIDDEN', 'Không thể tự đổi vai trò hoặc khóa tài khoản của chính mình.');
    }
    if (actor.id === userId && data.password !== undefined) {
      throw new DomainError('FORBIDDEN', 'Đổi mật khẩu của chính mình qua mục Đổi mật khẩu (cần mật khẩu hiện tại).');
    }
    return this.db.tx(async (c) => {
      // Khóa tất cả chủ xe của nhà xe để kiểm tra "còn ít nhất một chủ xe" không bị chạy đua.
      await c.query(`SELECT id FROM users WHERE operator_id = $1 AND role = 'OWNER' FOR UPDATE`, [operatorId]);
      const { rows } = await c.query<UserRow>('SELECT * FROM users WHERE id = $1 AND operator_id = $2 FOR UPDATE', [
        userId, operatorId,
      ]);
      const target = rows[0];
      if (!target) throw notFound('tài khoản');
      const nextRole = data.role ?? target.role;
      const nextStatus = data.status ?? target.status;
      if (target.role === 'OWNER' && target.status === 'ACTIVE' && (nextRole !== 'OWNER' || nextStatus !== 'ACTIVE')) {
        const { rows: owners } = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM users WHERE operator_id = $1 AND role = 'OWNER' AND status = 'ACTIVE' AND id <> $2`,
          [operatorId, userId],
        );
        if (owners[0]!.n === 0) throw new DomainError('CONFLICT', 'Nhà xe phải còn ít nhất một chủ xe đang hoạt động.');
      }
      const revoke = nextRole !== target.role || nextStatus !== target.status || data.password !== undefined;
      const { rows: updated } = await c.query<UserRow>(
        `UPDATE users SET full_name = $3, role = $4, status = $5,
                password_hash = COALESCE($6, password_hash),
                token_version = token_version + $7, updated_at = $8
         WHERE id = $1 AND operator_id = $2 RETURNING *`,
        [userId, operatorId, data.fullName ?? target.full_name, nextRole, nextStatus,
          data.password ? await hashPassword(data.password) : null, revoke ? 1 : 0, this.clock.now()],
      );
      return toPublicUser(updated[0]!);
    });
  }

  private async insert(
    operatorId: string | null,
    data: { fullName: string; phone: string; password: string; role: string },
    q: Queryable = this.db,
  ): Promise<PublicUser> {
    const password = passwordSchema.parse(data.password);
    const phone = normalizeVnPhone(data.phone);
    try {
      const { rows } = await q.query<UserRow>(
        `INSERT INTO users (operator_id, full_name, phone, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [operatorId, data.fullName.trim(), phone, await hashPassword(password), data.role],
      );
      return toPublicUser(rows[0]!);
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new DomainError('CONFLICT', 'Số điện thoại đã được dùng cho tài khoản khác.');
      throw e;
    }
  }
}
