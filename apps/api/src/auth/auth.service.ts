import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AbuseConfig } from '../abuse/abuse-config';
import { clientKey } from '../abuse/client-ip';
import { RateLimiter } from '../abuse/rate-limiter';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { DomainError } from '../common/errors';
import { isUuid } from '../common/ids';
import { normalizeVnPhone } from '../common/phone';
import { Db, Queryable } from '../db/db';
import { AccessClaims, signJwt, TokenScope, verifyJwt } from './jwt';
import { dummyHash, hashPassword, PASSWORD_RULE, verifyPassword } from './password';
import { MFA_REQUIRED_ROLES, Role } from './permissions';
import { newTotpSecret, otpauthUri, SecretBox, verifyTotp } from './totp';

export interface AuthConfigOptions {
  /** Hạn access token. Production đặt ngắn (15 phút) vì dashboard tự refresh; xem `main.ts`. */
  accessTtlSeconds: number;
  mfaSetupTtlSeconds: number;
  /** Hạn tuyệt đối của phiên khi KHÔNG chọn "Ghi nhớ đăng nhập". */
  sessionTtlSeconds: number;
  /** Hạn tuyệt đối của phiên khi chọn "Ghi nhớ đăng nhập". */
  rememberTtlSeconds: number;
  /** Refresh token vừa bị thay vẫn được chấp nhận trong khoảng này (các request song song của cùng trình duyệt). */
  refreshGraceSeconds: number;
  issuer: string;
  maxFailedLogins: number;
  lockMinutes: number;
}

export class AuthConfig implements AuthConfigOptions {
  readonly accessTtlSeconds: number;
  readonly mfaSetupTtlSeconds: number;
  readonly sessionTtlSeconds: number;
  readonly rememberTtlSeconds: number;
  readonly refreshGraceSeconds: number;
  readonly issuer: string;
  readonly maxFailedLogins: number;
  readonly lockMinutes: number;

  constructor(
    readonly tokenSecret: string,
    opts: Partial<AuthConfigOptions> = {},
  ) {
    if (tokenSecret.length < 32) throw new Error('AUTH_TOKEN_SECRET must be at least 32 characters');
    this.accessTtlSeconds = opts.accessTtlSeconds ?? 12 * 3600;
    this.mfaSetupTtlSeconds = opts.mfaSetupTtlSeconds ?? 15 * 60;
    this.sessionTtlSeconds = opts.sessionTtlSeconds ?? 12 * 3600;
    this.rememberTtlSeconds = opts.rememberTtlSeconds ?? 30 * 24 * 3600;
    this.refreshGraceSeconds = opts.refreshGraceSeconds ?? 30;
    this.issuer = opts.issuer ?? 'PNTicket';
    this.maxFailedLogins = opts.maxFailedLogins ?? 5;
    this.lockMinutes = opts.lockMinutes ?? 15;
    for (const [k, v] of Object.entries({
      accessTtlSeconds: this.accessTtlSeconds, sessionTtlSeconds: this.sessionTtlSeconds, rememberTtlSeconds: this.rememberTtlSeconds,
    })) {
      if (!Number.isInteger(v) || v < 60) throw new Error(`${k} must be an integer of at least 60 seconds`);
    }
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
  /** Phiên đăng nhập của token (null với token thiết lập 2FA). */
  sessionId?: string | null;
  /** Người dùng chọn "Ghi nhớ đăng nhập" lúc đăng nhập. */
  remember?: boolean;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_version: number;
  remember: boolean;
  refresh_hash: string;
  prev_refresh_hash: string | null;
  rotated_at: Date | null;
  expires_at: Date;
  revoked_at: Date | null;
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
  /**
   * Refresh token mới (chỉ phiên `full`). `null` khi không có phiên, hoặc khi refresh trong ân hạn bằng token vừa bị thay
   * — client giữ nguyên refresh token mới nhất đang có.
   */
  refreshToken: string | null;
  /** Hạn tuyệt đối của phiên. */
  sessionExpiresAt: string | null;
  remember: boolean;
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
    rememberMe: z.boolean().optional(),
  })
  .strict();

/** Refresh token: `<session id>.<32 byte ngẫu nhiên base64url>`. */
const REFRESH_TOKEN = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;
export const refreshSchema = z.object({ refreshToken: z.string().min(1).max(1000) }).strict();
export const logoutSchema = z.object({ refreshToken: z.string().min(1).max(1000).optional() }).strict();

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

function sameHash(a: string | null, b: string): boolean {
  if (a === null || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function parseRefreshToken(token: string): { sid: string; secret: string } | null {
  const m = REFRESH_TOKEN.exec(token);
  if (!m || !isUuid(m[1]!)) return null;
  return { sid: m[1]!.toLowerCase(), secret: m[2]! };
}

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
    const remember = data.rememberMe ?? false;
    if (scopeOf(user) === 'mfa_setup') return this.issue(user, 'mfa_setup', null, remember);
    return this.db.tx(async (c) => this.startSession(c, user, remember));
  }

  /**
   * Đổi refresh token lấy access token mới. Token xoay vòng mỗi lần dùng; dùng lại token đã bị thay (sau ân hạn)
   * bị coi là token bị đánh cắp → thu hồi cả phiên.
   */
  async refresh(input: unknown): Promise<IssuedToken> {
    const { refreshToken } = refreshSchema.parse(input);
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) throw unauthenticated();
    const hash = sha256(parsed.secret);
    // Thu hồi do dùng lại phải được commit, nên transaction trả kết quả rồi mới ném lỗi ở ngoài.
    const result = await this.db.tx(async (c): Promise<IssuedToken | null> => {
      const { rows } = await c.query<SessionRow>('SELECT * FROM auth_sessions WHERE id = $1 FOR UPDATE', [parsed.sid]);
      const sess = rows[0];
      const now = this.clock.now();
      if (!sess || sess.revoked_at || sess.expires_at <= now) return null;
      const user = await this.load(sess.user_id, c);
      if (user.status !== 'ACTIVE' || user.token_version !== sess.token_version || scopeOf(user) !== 'full') return null;

      if (sameHash(sess.refresh_hash, hash)) {
        const secret = randomBytes(32).toString('base64url');
        if (sess.prev_refresh_hash) {
          await c.query(
            `INSERT INTO auth_session_retired_tokens (session_id, refresh_hash, retired_at) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [sess.id, sess.prev_refresh_hash, now],
          );
        }
        await c.query(
          `UPDATE auth_sessions SET prev_refresh_hash = refresh_hash, refresh_hash = $2, rotated_at = $3, last_used_at = $3 WHERE id = $1`,
          [sess.id, sha256(secret), now],
        );
        return this.issue(user, 'full', { ...sess, secret });
      }
      if (sameHash(sess.prev_refresh_hash, hash)) {
        const graceEnd = (sess.rotated_at?.getTime() ?? 0) + this.config.refreshGraceSeconds * 1000;
        if (now.getTime() <= graceEnd) {
          await c.query('UPDATE auth_sessions SET last_used_at = $2 WHERE id = $1', [sess.id, now]);
          return this.issue(user, 'full', { ...sess, secret: null });
        }
        // Quá ân hạn: coi như phản hồi lần refresh trước bị mất (request bị hủy giữa chừng) — cấp nhánh mới và
        // loại token kế tiếp chưa ai dùng. Nếu thực ra có kẻ gian giữ token kế tiếp, lần hắn dùng nó sẽ khớp bảng
        // token đã loại → thu hồi cả phiên. Phát hiện đánh cắp vẫn còn mà người dùng thật không bị đá ra oan.
        const secret = randomBytes(32).toString('base64url');
        await c.query(
          `INSERT INTO auth_session_retired_tokens (session_id, refresh_hash, retired_at) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [sess.id, sess.refresh_hash, now],
        );
        await c.query(
          'UPDATE auth_sessions SET refresh_hash = $2, rotated_at = $3, last_used_at = $3 WHERE id = $1',
          [sess.id, sha256(secret), now],
        );
        return this.issue(user, 'full', { ...sess, secret });
      }
      // Token cũ hơn nữa của chính phiên này (đã bị thay ít nhất hai lần) cũng là dùng lại.
      const { rowCount } = await c.query(
        'SELECT 1 FROM auth_session_retired_tokens WHERE session_id = $1 AND refresh_hash = $2',
        [sess.id, hash],
      );
      if (rowCount) await this.revokeWhere(c, 'id = $1', [sess.id], 'REUSE');
      return null;
    });
    if (!result) throw unauthenticated();
    return result;
  }

  /**
   * Đăng xuất: thu hồi phiên của refresh token và/hoặc của access token. Luôn thành công (không tiết lộ token có hợp lệ không).
   */
  async logout(input: unknown, accessToken?: string): Promise<void> {
    const parsedBody = logoutSchema.safeParse(input ?? {});
    const refreshToken = parsedBody.success ? parsedBody.data.refreshToken : undefined;
    const parsed = refreshToken ? parseRefreshToken(refreshToken) : null;
    if (parsed) {
      const hash = sha256(parsed.secret);
      await this.revokeWhere(this.db, 'id = $1 AND (refresh_hash = $2 OR prev_refresh_hash = $2)', [parsed.sid, hash], 'LOGOUT');
    }
    const claims = accessToken ? verifyJwt(accessToken, this.config.tokenSecret, this.nowSeconds()) : null;
    if (claims?.sid && isUuid(claims.sid) && isUuid(claims.sub)) {
      await this.revokeWhere(this.db, 'id = $1 AND user_id = $2', [claims.sid, claims.sub], 'LOGOUT');
    }
  }

  /** Xác thực Bearer token; tải lại tài khoản để thu hồi được ngay (khóa tài khoản, đổi mật khẩu, đổi vai trò). */
  async authenticate(token: string): Promise<AuthUser> {
    const claims = verifyJwt(token, this.config.tokenSecret, this.nowSeconds());
    if (!claims || !isUuid(claims.sub) || (claims.sid !== undefined && !isUuid(claims.sid))) throw unauthenticated();
    const { rows } = await this.db.query<UserRow & { session_ok: boolean | null }>(
      `SELECT u.*, (s.id IS NOT NULL AND s.revoked_at IS NULL AND s.expires_at > $3) AS session_ok
       FROM users u LEFT JOIN auth_sessions s ON s.id = $2 AND s.user_id = u.id
       WHERE u.id = $1`,
      [claims.sub, claims.sid ?? null, this.clock.now()],
    );
    const u = rows[0];
    if (!u || u.status !== 'ACTIVE' || u.token_version !== claims.ver) throw unauthenticated();
    // Token gắn phiên: phiên đã đăng xuất/thu hồi thì access token chết ngay, không chờ hết 15 phút.
    if (claims.sid !== undefined && !u.session_ok) throw unauthenticated();
    return {
      id: u.id,
      operatorId: u.operator_id,
      role: u.role,
      fullName: u.full_name,
      phone: u.phone,
      mfaEnabled: u.mfa_enabled,
      scope: claims.scope,
      sessionId: claims.sid ?? null,
      remember: claims.rem ?? false,
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
    return this.db.tx(async (c) => {
      const { rows } = await c.query<UserRow>(
        `UPDATE users SET mfa_secret_enc = mfa_pending_enc, mfa_pending_enc = NULL, mfa_enabled = true,
                mfa_last_step = $2, token_version = token_version + 1, updated_at = $3
         WHERE id = $1 AND NOT mfa_enabled AND mfa_pending_enc IS NOT NULL RETURNING *`,
        [user.id, step, this.clock.now()],
      );
      if (!rows[0]) throw new DomainError('CONFLICT', 'Trạng thái xác thực 2 lớp vừa thay đổi, vui lòng thử lại.');
      const cap = await this.sessionCap(c, user);
      await this.revokeWhere(c, 'user_id = $1', [user.id], 'CREDENTIALS_CHANGED');
      return this.startSession(c, rows[0], user.remember ?? false, cap);
    });
  }

  /** Đổi mật khẩu: thu hồi mọi phiên cũ, cấp token mới cho phiên hiện tại. */
  async changePassword(user: AuthUser, current: string, next: string): Promise<IssuedToken> {
    const nextPw = passwordSchema.parse(next);
    const row = await this.load(user.id);
    if (!(await verifyPassword(current, row.password_hash))) throw invalidCredentials();
    const newHash = await hashPassword(nextPw);
    return this.db.tx(async (c) => {
      const { rows } = await c.query<UserRow>(
        `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = $3 WHERE id = $1 RETURNING *`,
        [user.id, newHash, this.clock.now()],
      );
      const updated = rows[0]!;
      // Giữ hạn tuyệt đối của phiên hiện tại: đổi mật khẩu không kéo dài phiên.
      const cap = await this.sessionCap(c, user);
      await this.revokeWhere(c, 'user_id = $1', [user.id], 'CREDENTIALS_CHANGED');
      if (user.scope !== 'full') return this.issue(updated, user.scope, null, user.remember ?? false);
      return this.startSession(c, updated, user.remember ?? false, cap);
    });
  }

  private async load(userId: string, q: Queryable = this.db): Promise<UserRow> {
    const { rows } = await q.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw unauthenticated();
    return rows[0];
  }

  /** Hạn tuyệt đối của phiên hiện tại (null = token không gắn phiên). */
  private async sessionCap(c: Queryable, user: AuthUser): Promise<Date | null> {
    if (!user.sessionId) return null;
    const { rows } = await c.query<{ expires_at: Date }>('SELECT expires_at FROM auth_sessions WHERE id = $1', [user.sessionId]);
    return rows[0]?.expires_at ?? null;
  }

  /** Tạo phiên mới + refresh token. Dọn luôn các phiên đã hết hạn lâu của người dùng. */
  private async startSession(c: Queryable, user: UserRow, remember: boolean, cap: Date | null = null): Promise<IssuedToken> {
    const now = this.clock.now();
    const ttl = remember ? this.config.rememberTtlSeconds : this.config.sessionTtlSeconds;
    let expiresAt = new Date(now.getTime() + ttl * 1000);
    if (cap && cap < expiresAt) expiresAt = cap;
    if (expiresAt.getTime() - now.getTime() < 60_000) throw unauthenticated(); // phiên cũ sắp hết: đăng nhập lại
    await c.query(`DELETE FROM auth_sessions WHERE user_id = $1 AND expires_at < $2`, [
      user.id, new Date(now.getTime() - 30 * 24 * 3600 * 1000),
    ]);
    const secret = randomBytes(32).toString('base64url');
    const { rows } = await c.query<SessionRow>(
      `INSERT INTO auth_sessions (user_id, token_version, remember, refresh_hash, created_at, last_used_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6) RETURNING *`,
      [user.id, user.token_version, remember, sha256(secret), now, expiresAt],
    );
    return this.issue(user, 'full', { ...rows[0]!, secret });
  }

  private async revokeWhere(q: Queryable, where: string, params: unknown[], reason: 'LOGOUT' | 'REUSE' | 'CREDENTIALS_CHANGED') {
    const n = params.length;
    await q.query(
      `UPDATE auth_sessions SET revoked_at = $${n + 1}, revoke_reason = $${n + 2} WHERE ${where} AND revoked_at IS NULL`,
      [...params, this.clock.now(), reason],
    );
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

  /**
   * Ký access token. `session` có → token gắn phiên (`sid`), không sống quá hạn phiên; `secret` là refresh token mới
   * (null = giữ refresh token hiện có). Không có phiên → token thiết lập 2FA, mang cờ ghi nhớ sang bước xác nhận.
   */
  private issue(
    user: UserRow,
    scope: TokenScope,
    session: (Pick<SessionRow, 'id' | 'remember' | 'expires_at'> & { secret: string | null }) | null,
    remember = false,
  ): IssuedToken {
    const iat = this.nowSeconds();
    const ttl = scope === 'full' ? this.config.accessTtlSeconds : this.config.mfaSetupTtlSeconds;
    let exp = iat + ttl;
    const claims: AccessClaims = { sub: user.id, ver: user.token_version, scope, iat, exp };
    if (session) {
      exp = Math.min(exp, Math.floor(session.expires_at.getTime() / 1000));
      claims.exp = exp;
      claims.sid = session.id;
      claims.rem = session.remember;
    } else if (remember) {
      claims.rem = true;
    }
    return {
      accessToken: signJwt(claims, this.config.tokenSecret),
      scope,
      expiresAt: new Date(exp * 1000).toISOString(),
      refreshToken: session?.secret ? `${session.id}.${session.secret}` : null,
      sessionExpiresAt: session ? session.expires_at.toISOString() : null,
      remember: session ? session.remember : remember,
      user: toPublicUser(user),
    };
  }
}

function scopeOf(user: UserRow): TokenScope {
  return MFA_REQUIRED_ROLES.has(user.role) && !user.mfa_enabled ? 'mfa_setup' : 'full';
}

function unauthenticated(): DomainError {
  return new DomainError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
}
