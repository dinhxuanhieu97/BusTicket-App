import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
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
  login(@Body() body: unknown) {
    return this.auth.login(body as never);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @AuthOnly()
  @AllowScopes('full', 'mfa_setup')
  me(@Req() req: AuthedRequest) {
    const { id, operatorId, fullName, phone, role, mfaEnabled, scope } = req.auth;
    return { user: { id, operatorId, fullName, phone, role, mfaEnabled }, scope };
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
