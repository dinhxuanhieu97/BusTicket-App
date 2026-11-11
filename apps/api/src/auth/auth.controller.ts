import { permissionsOf } from './permissions';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AllowScopes, AuthedRequest, AuthGuard, AuthOnly } from './auth.guard';
import { AuthService } from './auth.service';
import { DomainError } from '../common/errors';

const otpBody = z.object({ otp: z.string().min(1).max(10) }).strict();
const disableMfaBody = z.object({ password: z.string().min(1).max(128), otp: z.string().regex(/^\d{6}$/) }).strict();
const passwordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) }).strict();

/**
 * IP thật của người dùng. Dashboard gọi API từ máy chủ của nó nên gửi IP khách qua header kèm khóa proxy bí mật;
 * header không kèm khóa đúng bị từ chối (không cho giả IP để né giới hạn).
 */
function clientIp(req: Request): string | undefined {
  const key = process.env.PNTICKET_LOGIN_PROXY_KEY;
  const supplied = req.get('x-pnticket-login-proxy-key');
  const forwarded = req.get('x-pnticket-login-client-ip');
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (supplied === undefined && forwarded === undefined) return req.ip;
  if (!key || key.length < 32 || !supplied || !forwarded || !isIP(forwarded)
    || !timingSafeEqual(digest(key), digest(supplied))) {
    throw new DomainError('FORBIDDEN', 'Không xác minh được nguồn đăng nhập.');
  }
  return forwarded;
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: Request) {
    return this.auth.login(body as never, clientIp(req));
  }

  /** Quên mật khẩu: đặt lại bằng mã Authenticator (tài khoản đã bật 2FA). Không cấp phiên; đăng nhập lại sau đó. */
  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(@Body() body: unknown, @Req() req: Request) {
    const { userId, operatorId } = await this.auth.resetPasswordWithMfa(body, clientIp(req));
    await this.audit.record({ operatorId, actorUserId: userId, action: 'user.password_reset', entity: 'user', entityId: userId });
    return { ok: true };
  }

  /** Đổi refresh token (xoay vòng) lấy access token mới. */
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    return this.auth.refresh(body);
  }

  /** Thu hồi phiên theo refresh token trong body và/hoặc access token ở header. Luôn trả 200. */
  @Post('logout')
  @HttpCode(200)
  async logout(@Body() body: unknown, @Req() req: Request) {
    const m = /^Bearer ([\w.-]+)$/.exec(req.headers.authorization ?? '');
    await this.auth.logout(body, m?.[1]);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @AuthOnly()
  @AllowScopes('full', 'mfa_setup')
  me(@Req() req: AuthedRequest) {
    const { id, operatorId, fullName, phone, role, mfaEnabled, scope, mustChangePassword } = req.auth;
    // Phiên mới đăng nhập chưa bật 2FA (scope mfa_setup) chưa được dùng quyền nào.
    const permissions = scope === 'full' ? permissionsOf(role) : [];
    return { user: { id, operatorId, fullName, phone, role, mfaEnabled }, scope, permissions, mustChangePassword: mustChangePassword ?? false };
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AuthOnly()
  @AllowScopes('full', 'mfa_setup')
  mfaSetup(@Req() req: AuthedRequest) {
    return this.auth.startMfaSetup(req.auth);
  }

  @Post('mfa/confirm')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AuthOnly()
  @AllowScopes('full', 'mfa_setup')
  async mfaConfirm(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { otp } = otpBody.parse(body);
    const issued = await this.auth.confirmMfa(req.auth, otp);
    await this.audit.record({
      operatorId: req.auth.operatorId, actorUserId: req.auth.id, action: 'user.mfa_enable', entity: 'user', entityId: req.auth.id,
    });
    return issued;
  }

  @Post('mfa/disable')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AuthOnly()
  async mfaDisable(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { password, otp } = disableMfaBody.parse(body);
    const issued = await this.auth.disableMfa(req.auth, password, otp);
    await this.audit.record({
      operatorId: req.auth.operatorId, actorUserId: req.auth.id, action: 'user.mfa_disable', entity: 'user', entityId: req.auth.id,
    });
    return issued;
  }

  @Post('password')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AuthOnly()
  @AllowScopes('full', 'mfa_setup')
  async changePassword(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { currentPassword, newPassword } = passwordBody.parse(body);
    const issued = await this.auth.changePassword(req.auth, currentPassword, newPassword);
    await this.audit.record({
      operatorId: req.auth.operatorId, actorUserId: req.auth.id, action: 'user.password_change', entity: 'user', entityId: req.auth.id,
    });
    return issued;
  }
}
