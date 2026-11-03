import { Injectable } from '@nestjs/common';
import { AbuseConfig } from '../abuse/abuse-config';
import { clientKey } from '../abuse/client-ip';
import { RateLimiter } from '../abuse/rate-limiter';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { DomainError } from '../common/errors';
import { isUuid } from '../common/ids';
import { normalizeVnPhone } from '../common/phone';
import { Db } from '../db/db';
import { AccessClaims, signJwt, TokenScope, verifyJwt } from './jwt';
import { dummyHash, hashPassword, PASSWORD_RULE, verifyPassword } from './password';
import { MFA_REQUIRED_ROLES, Role } from './permissions';
import { newTotpSecret, otpauthUri, SecretBox, verifyTotp } from './totp';

export class AuthConfig {
  constructor(
    readonly tokenSecret: string,
    readonly accessTtlSeconds = 12 * 3600,
    readonly mfaSetupTtlSeconds = 15 * 60,
    readonly issuer = 'PNTicket',
    readonly maxFailedLogins = 5,
    readonly lockMinutes = 15,
  ) {
    if (tokenSecret.length < 32) throw new Error('AUTH_TOKEN_SECRET must be at least 32 characters');
  }
}

/** Người dùng đã xác thực, gắn vào request. */
export interface AuthUser {
  id: string;
  operatorId: string | null;
  role: Role;
  fullName: string;
  phone: string;
  mfaEnabled: boolean;
  scope: TokenScope;
}

export interface UserRow {
  id: string;
  operator_id: string | null;
  full_name: string;
  phone: string;
  password_hash: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  token_version: number;
  failed_login_count: number;
  locked_until: Date | null;
  mfa_secret_enc: string | null;
  mfa_pending_enc: string | null;
  mfa_enabled: boolean;
  mfa_last_step: string | null; // bigint → chuỗi
}

export interface IssuedToken {
  accessToken: string;
  scope: TokenScope;
  expiresAt: string;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  operatorId: string | null;
  fullName: string;
  phone: string;
  role: Role;
  mfaEnabled: boolean;
}

export const loginSchema = z
  .object({
    phone: z.string().min(1).max(30),
    password: z.string().min(1).max(PASSWORD_RULE.max),
    otp: z.string().max(10).optional(),
  })
  .strict();

export const passwordSchema = z.string().min(PASSWORD_RULE.min, `Mật khẩu tối thiểu ${PASSWORD_RULE.min} ký tự`).max(PASSWORD_RULE.max);

const invalidCredentials = () =>
  new DomainError(
    'INVALID_CREDENTIALS',
    'Số điện thoại, mật khẩu hoặc mã xác thực không đúng, hoặc tài khoản đang tạm khóa do đăng nhập sai nhiều lần.',
  );

export function toPublicUser(u: UserRow): PublicUser {
  return { id: u.id, operatorId: u.operator_id, fullName: u.full_name, phone: u.phone, role: u.role, mfaEnabled: u.mfa_enabled };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly config: AuthConfig,
    private readonly box: SecretBox,
    private readonly limiter: RateLimiter,
    private readonly abuse: AbuseConfig,
  ) {}

  private nowSeconds(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }

  /**
   * Đăng nhập bằng SĐT + mật khẩu (+ OTP nếu đã bật 2FA). Sai gì cũng trả cùng một lỗi chung;
   * sai quá số lần cho phép thì khóa tạm thời. Vai trò bắt buộc 2FA mà chưa bật → token chỉ để thiết lập 2FA.
   */
  async login(input: z.input<typeof loginSchema>, ip?: string): Promise<IssuedToken> {
    const data = loginSchema.parse(input);
    // Giới hạn theo IP (mọi tài khoản cộng lại): chặn dò hàng loạt SĐT/mật khẩu từ một nguồn.
    const source = clientKey(ip);
    if (source) {
      await this.limiter.consume(`login-ip:${source}`, this.abuse.loginsPerIpPer15Min, 900, 'Đăng nhập quá nhiều lần. Vui lòng thử lại sau.');
    }
    let phone: string;
    try {
      phone = normalizeVnPhone(data.phone);
    } catch {
      await verifyPassword(data.password, await dummyHash());
      throw invalidCredentials();
    }
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE phone = $1', [phone]);
    const user = rows[0];
    if (!user) {
      await verifyPassword(data.password, await dummyHash());
      throw invalidCredentials();
    }
    // Giữ chỗ một lượt thử TRƯỚC khi kiểm mật khẩu, nguyên tử trong DB: các yêu cầu song song không thể
    // cùng lọt qua kiểm tra khóa (tối đa `maxFailedLogins` lượt mỗi cửa sổ khóa).
    if (!(await this.reserveAttempt(user.id))) {
      // Tài khoản đang tạm khóa trả đúng lỗi chung như SĐT không tồn tại (cùng thời gian xử lý),
      // để không ai dò được SĐT nào là tài khoản thật.
      await verifyPassword(data.password, await dummyHash());
      throw invalidCredentials();
    }
    const passwordOk = await verifyPassword(data.password, user.password_hash);
    if (!passwordOk || user.status !== 'ACTIVE') throw invalidCredentials();
    if (user.mfa_enabled) {
      if (!data.otp) {
        // Mật khẩu đúng nhưng thiếu OTP: trả lại lượt vừa giữ, KHÔNG xóa bộ đếm (để không đoán OTP vô hạn).
        await this.refundAttempt(user.id);
        throw new DomainError('MFA_REQUIRED', 'Vui lòng nhập mã xác thực 6 số từ ứng dụng Authenticator.');
      }
      const ok = await this.consumeTotp(user, this.box.open(user.mfa_secret_enc!), data.otp);
      if (!ok) throw invalidCredentials();
    }
    await this.db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);
    const scope: TokenScope = MFA_REQUIRED_ROLES.has(user.role) && !user.mfa_enabled ? 'mfa_setup' : 'full';
    return this.issue(user, scope);
  }

  /** Xác thực Bearer token; tải lại tài khoản để thu hồi được ngay (khóa tài khoản, đổi mật khẩu, đổi vai trò). */
  async authenticate(token: string): Promise<AuthUser> {
    const claims = verifyJwt(token, this.config.tokenSecret, this.nowSeconds());
    if (!claims || !isUuid(claims.sub)) throw unauthenticated();
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [claims.sub]);
    const u = rows[0];
    if (!u || u.status !== 'ACTIVE' || u.token_version !== claims.ver) throw unauthenticated();
    return {
      id: u.id,
      operatorId: u.operator_id,
      role: u.role,
      fullName: u.full_name,
      phone: u.phone,
      mfaEnabled: u.mfa_enabled,
      scope: claims.scope,
    };
  }

  /** Tạo bí mật 2FA chờ xác nhận. Trả về bí mật và URI để quét QR trong ứng dụng Authenticator. */
  async startMfaSetup(user: AuthUser): Promise<{ secret: string; otpauthUri: string }> {
    if (user.mfaEnabled) throw new DomainError('CONFLICT', 'Tài khoản đã bật xác thực 2 lớp.');
    const secret = newTotpSecret();
    await this.db.query('UPDATE users SET mfa_pending_enc = $2, updated_at = $3 WHERE id = $1', [
      user.id, this.box.seal(secret), this.clock.now(),
    ]);
    return { secret, otpauthUri: otpauthUri(secret, user.phone, this.config.issuer) };
  }

  /** Xác nhận 2FA bằng mã đầu tiên; thu hồi token cũ và cấp token đầy đủ. */
  async confirmMfa(user: AuthUser, otp: string): Promise<IssuedToken> {
    const row = await this.load(user.id);
    if (row.mfa_enabled) throw new DomainError('CONFLICT', 'Tài khoản đã bật xác thực 2 lớp.');
    if (!row.mfa_pending_enc) throw new DomainError('VALIDATION_FAILED', 'Chưa bắt đầu thiết lập xác thực 2 lớp.');
    const step = verifyTotp(this.box.open(row.mfa_pending_enc), otp, this.nowSeconds(), null);
    if (step === null) throw new DomainError('VALIDATION_FAILED', 'Mã xác thực không đúng.');
    const { rows } = await this.db.query<UserRow>(
      `UPDATE users SET mfa_secret_enc = mfa_pending_enc, mfa_pending_enc = NULL, mfa_enabled = true,
              mfa_last_step = $2, token_version = token_version + 1, updated_at = $3
       WHERE id = $1 AND NOT mfa_enabled AND mfa_pending_enc IS NOT NULL RETURNING *`,
      [user.id, step, this.clock.now()],
    );
    if (!rows[0]) throw new DomainError('CONFLICT', 'Trạng thái xác thực 2 lớp vừa thay đổi, vui lòng thử lại.');
    return this.issue(rows[0], 'full');
  }

  /** Đổi mật khẩu: thu hồi mọi phiên cũ, cấp token mới cho phiên hiện tại. */
  async changePassword(user: AuthUser, current: string, next: string): Promise<IssuedToken> {
    const nextPw = passwordSchema.parse(next);
    const row = await this.load(user.id);
    if (!(await verifyPassword(current, row.password_hash))) throw invalidCredentials();
    const { rows } = await this.db.query<UserRow>(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = $3 WHERE id = $1 RETURNING *`,
      [user.id, await hashPassword(nextPw), this.clock.now()],
    );
    return this.issue(rows[0]!, user.scope);
  }

  private async load(userId: string): Promise<UserRow> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw unauthenticated();
    return rows[0];
  }

  /** Ghi nhận mã OTP đã dùng (chống dùng lại cùng một mã trong cửa sổ thời gian). */
  private async consumeTotp(user: UserRow, secret: string, otp: string): Promise<boolean> {
    const last = user.mfa_last_step === null ? null : Number(user.mfa_last_step);
    const step = verifyTotp(secret, otp, this.nowSeconds(), last);
    if (step === null) return false;
    const res = await this.db.query(
      'UPDATE users SET mfa_last_step = $2 WHERE id = $1 AND (mfa_last_step IS NULL OR mfa_last_step < $2)',
      [user.id, step],
    );
    return res.rowCount === 1;
  }

  /**
   * Tính trước một lượt thử. Trả false nếu tài khoản đang bị khóa. Lượt thứ `maxFailedLogins`
   * đặt khóa; khóa đã hết hạn thì bộ đếm bắt đầu lại từ 1.
   */
  private async reserveAttempt(userId: string): Promise<boolean> {
    const now = this.clock.now();
    const lockUntil = new Date(now.getTime() + this.config.lockMinutes * 60_000);
    const res = await this.db.query(
      `UPDATE users SET
         failed_login_count = CASE WHEN locked_until IS NOT NULL AND locked_until <= $2 THEN 1 ELSE failed_login_count + 1 END,
         locked_until = CASE
           WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= $2 THEN 1 ELSE failed_login_count + 1 END) >= $3 THEN $4
           WHEN locked_until IS NOT NULL AND locked_until <= $2 THEN NULL
           ELSE locked_until END
       WHERE id = $1 AND (locked_until IS NULL OR locked_until <= $2)`,
      [userId, now, this.config.maxFailedLogins, lockUntil],
    );
    return res.rowCount === 1;
  }

  /**
   * Trả lại lượt vừa giữ khi mật khẩu đúng nhưng chưa gửi OTP — kể cả gỡ khóa nếu chính lượt này
   * vừa đặt khóa. An toàn vì chỉ ai biết đúng mật khẩu mới tới được đây; bộ đếm không bị xóa về 0.
   */
  private async refundAttempt(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE users SET
         locked_until = CASE WHEN failed_login_count >= $2 THEN NULL ELSE locked_until END,
         failed_login_count = GREATEST(failed_login_count - 1, 0)
       WHERE id = $1`,
      [userId, this.config.maxFailedLogins],
    );
  }

  private issue(user: UserRow, scope: TokenScope): IssuedToken {
    const iat = this.nowSeconds();
    const ttl = scope === 'full' ? this.config.accessTtlSeconds : this.config.mfaSetupTtlSeconds;
    const claims: AccessClaims = { sub: user.id, ver: user.token_version, scope, iat, exp: iat + ttl };
    return {
      accessToken: signJwt(claims, this.config.tokenSecret),
      scope,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      user: toPublicUser(user),
    };
  }
}

function unauthenticated(): DomainError {
  return new DomainError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
}
