import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { AuthService, AuthUser } from './auth.service';
import type { TokenScope } from './jwt';
import { can, Permission } from './permissions';

const PERM_KEY = 'pnticket:perm';
const AUTH_ONLY_KEY = 'pnticket:auth-only';
const SCOPES_KEY = 'pnticket:scopes';

/** Route yêu cầu quyền này. Route có `:operatorId` còn bị giới hạn trong nhà xe của người dùng. */
export const Perm = (perm: Permission) => SetMetadata(PERM_KEY, perm);
/** Route chỉ cần đăng nhập (không cần quyền cụ thể), ví dụ /auth/me. */
export const AuthOnly = () => SetMetadata(AUTH_ONLY_KEY, true);
/** Phạm vi token được chấp nhận; mặc định chỉ `full`. */
export const AllowScopes = (...scopes: TokenScope[]) => SetMetadata(SCOPES_KEY, scopes);

export interface AuthedRequest extends Request {
  auth: AuthUser;
}

/**
 * Xác thực Bearer token và kiểm tra quyền. "Đóng mặc định": route thiếu @Perm/@AuthOnly bị từ chối.
 * Nhân viên nhà xe truy cập `:operatorId` của nhà xe khác nhận 404 (không lộ sự tồn tại).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const perm = this.reflector.getAllAndOverride<Permission | undefined>(PERM_KEY, targets);
    const authOnly = this.reflector.getAllAndOverride<boolean | undefined>(AUTH_ONLY_KEY, targets);
    if (!perm && !authOnly) throw new DomainError('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');

    const header = req.headers.authorization ?? '';
    const m = /^Bearer ([\w.-]+)$/.exec(header);
    if (!m) throw new DomainError('UNAUTHENTICATED', 'Vui lòng đăng nhập.');
    const user = await this.auth.authenticate(m[1]!);

    const scopes = this.reflector.getAllAndOverride<TokenScope[] | undefined>(SCOPES_KEY, targets) ?? ['full'];
    if (!scopes.includes(user.scope)) {
      throw new DomainError('MFA_SETUP_REQUIRED', 'Vui lòng bật xác thực 2 lớp trước khi sử dụng.');
    }
    if (perm) {
      if (!can(user.role, perm)) throw new DomainError('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
      const operatorId = req.params?.operatorId;
      if (operatorId !== undefined) {
        if (typeof operatorId !== 'string' || !isUuid(operatorId)) throw notFound('nhà xe');
        if (user.operatorId !== null && user.operatorId !== operatorId) throw notFound('nhà xe');
      }
    }
    req.auth = user;
    return true;
  }
}
