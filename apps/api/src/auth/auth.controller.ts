import { permissionsOf } from './permissions';
import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AllowScopes, AuthedRequest, AuthGuard, AuthOnly } from './auth.guard';
import { AuthService } from './auth.service';

const otpBody = z.object({ otp: z.string().min(1).max(10) }).strict();
const passwordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) }).strict();

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: Request) {
    return this.auth.login(body as never, req.ip);
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
    const { id, operatorId, fullName, phone, role, mfaEnabled, scope } = req.auth;
    // Phiên mới đăng nhập chưa bật 2FA (scope mfa_setup) chưa được dùng quyền nào.
    const permissions = scope === 'full' ? permissionsOf(role) : [];
    return { user: { id, operatorId, fullName, phone, role, mfaEnabled }, scope, permissions };
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
