import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { base32Decode, hotp } from '../src/auth/totp';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { AUTH_SECRET, buildServices, RELAXED_ABUSE, resetDatabase, Services, TEST_DB_URL, TOKEN_SECRET } from './helpers';

// Quên/đổi mật khẩu khi chưa có SMS/email: nhân viên nhờ OWNER đặt mật khẩu tạm (bắt buộc đổi ở lần đăng nhập sau);
// tài khoản đã bật 2FA tự đặt lại bằng mã Authenticator; mọi vai trò tự đổi mật khẩu khi biết mật khẩu hiện tại.

let s: Services;
let app: INestApplication;
let opId: string;
const OWNER = { phone: '0905000001', password: 'owner-password-1' };
const MFA_OWNER = { phone: '0905000002', password: 'owner-password-2' };
const SELLER = { phone: '0905000003', password: 'seller-password-1' };
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const http = () => request(app.getHttpServer());
const login = (cred: { phone: string; password: string }, otp?: string) =>
  http().post('/api/v1/auth/login').send({ ...cred, ...(otp ? { otp } : {}) });
const reset = (body: Record<string, unknown>) => http().post('/api/v1/auth/password/reset').send(body);

function nextOtp(secret: string): string {
  s.clock.advanceMinutes(0.5);
  return hotp(base32Decode(secret), Math.floor(s.clock.now().getTime() / 1000 / 30));
}

let ownerToken: string;
let sellerId: string;
let mfaSecret: string;

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  const users = new UsersService(s.db, s.clock);
  opId = (await s.operators.create({ code: 'PW', name: 'Khôi phục mật khẩu' })).id;
  await users.createStaff(opId, { fullName: 'Chủ', role: 'OWNER', ...OWNER });
  await users.createStaff(opId, { fullName: 'Chủ có 2FA', role: 'OWNER', ...MFA_OWNER });
  sellerId = (await users.createStaff(opId, { fullName: 'Bán vé', role: 'SELLER', ...SELLER })).id;
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, abuse: RELAXED_ABUSE, clock: s.clock,
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  ownerToken = (await login(OWNER).expect(200)).body.accessToken;
  const mfaToken = (await login(MFA_OWNER).expect(200)).body.accessToken;
  const setup = await http().post('/api/v1/auth/mfa/setup').set(bearer(mfaToken)).expect(200);
  mfaSecret = setup.body.secret;
  await http().post('/api/v1/auth/mfa/confirm').set(bearer(mfaToken)).send({ otp: nextOtp(mfaSecret) }).expect(200);
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

describe('temporary password set by OWNER', () => {
  it('forces the staff member to change it before any other API, then clears the flag', async () => {
    const before = await login(SELLER).expect(200);
    expect(before.body.mustChangePassword).toBe(false);
    const temp = 'temporary-pass-1';
    await http().patch(`/api/v1/admin/operators/${opId}/users/${sellerId}`).set(bearer(ownerToken)).send({ password: temp }).expect(200);
    await http().get('/api/v1/auth/me').set(bearer(before.body.accessToken)).expect(401); // phiên cũ bị thu hồi

    const tempLogin = await login({ ...SELLER, password: temp }).expect(200);
    expect(tempLogin.body.mustChangePassword).toBe(true);
    const t = tempLogin.body.accessToken;
    expect((await http().get('/api/v1/auth/me').set(bearer(t)).expect(200)).body.mustChangePassword).toBe(true);
    const blocked = await http().get(`/api/v1/admin/operators/${opId}/trips?date=2027-01-20`).set(bearer(t)).expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const same = await http().post('/api/v1/auth/password').set(bearer(t)).send({ currentPassword: temp, newPassword: temp }).expect(400);
    expect(same.body.error.code).toBe('VALIDATION_FAILED');
    const changed = await http().post('/api/v1/auth/password').set(bearer(t))
      .send({ currentPassword: temp, newPassword: 'seller-password-2' }).expect(200);
    expect(changed.body.mustChangePassword).toBe(false);
    await http().get(`/api/v1/admin/operators/${opId}/trips?date=2027-01-20`).set(bearer(changed.body.accessToken)).expect(200);
    await login({ ...SELLER, password: temp }).expect(401);
    expect((await login({ ...SELLER, password: 'seller-password-2' }).expect(200)).body.mustChangePassword).toBe(false);

    const { rows } = await s.db.query(`SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'user.password_change'`, [sellerId]);
    expect(rows).toHaveLength(1);
  });

  it('lets any role change its own password with the current one; a wrong current password is rejected', async () => {
    const t = (await login(OWNER).expect(200)).body.accessToken;
    const wrong = await http().post('/api/v1/auth/password').set(bearer(t)).send({ currentPassword: 'nope-nope-1', newPassword: 'owner-password-9' }).expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    const short = await http().post('/api/v1/auth/password').set(bearer(t)).send({ currentPassword: OWNER.password, newPassword: 'x' }).expect(400);
    expect(short.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('forgot password with the Authenticator code', () => {
  it('resets the password, revokes every session and keeps 2FA on', async () => {
    const otp = nextOtp(mfaSecret);
    const session = await login(MFA_OWNER, otp).expect(200);
    const r = await reset({ phone: '+84 905 000 002', otp: nextOtp(mfaSecret), newPassword: 'owner-new-pass-2' }).expect(200);
    expect(r.body).toEqual({ ok: true });
    await http().get('/api/v1/auth/me').set(bearer(session.body.accessToken)).expect(401);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: session.body.refreshToken }).expect(401);
    await login(MFA_OWNER, nextOtp(mfaSecret)).expect(401);
    const fresh = await login({ ...MFA_OWNER, password: 'owner-new-pass-2' }).expect(401);
    expect(fresh.body.error.code).toBe('MFA_REQUIRED');
    await login({ ...MFA_OWNER, password: 'owner-new-pass-2' }, nextOtp(mfaSecret)).expect(200);
    const { rows } = await s.db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'user.password_reset'`);
    expect(rows[0]?.n).toBe(1);
    MFA_OWNER.password = 'owner-new-pass-2';
  });

  it('answers the same generic error for unknown phones, accounts without 2FA, wrong or replayed codes', async () => {
    const generic = async (body: Record<string, unknown>) => {
      const res = await reset(body).expect(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      return res.body.error.message as string;
    };
    const msgs = [
      await generic({ phone: '0905999999', otp: '123456', newPassword: 'whatever-pass-1' }),
      await generic({ phone: OWNER.phone, otp: '123456', newPassword: 'whatever-pass-1' }),
      await generic({ phone: MFA_OWNER.phone, otp: '000000', newPassword: 'whatever-pass-1' }),
    ];
    expect(new Set(msgs).size).toBe(1);
    const otp = nextOtp(mfaSecret);
    await reset({ phone: MFA_OWNER.phone, otp, newPassword: 'owner-new-pass-3' }).expect(200);
    await generic({ phone: MFA_OWNER.phone, otp, newPassword: 'owner-new-pass-4' }); // không dùng lại cùng mã
    MFA_OWNER.password = 'owner-new-pass-3';
    await login(OWNER).expect(200); // tài khoản không 2FA không bị đổi mật khẩu
    await s.db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL');
  });

  it('counts wrong codes toward the login lock so the code cannot be brute-forced', async () => {
    for (let i = 0; i < 5; i++) await reset({ phone: MFA_OWNER.phone, otp: '111111', newPassword: 'owner-new-pass-5' }).expect(401);
    await reset({ phone: MFA_OWNER.phone, otp: nextOtp(mfaSecret), newPassword: 'owner-new-pass-5' }).expect(401);
    await login(MFA_OWNER, nextOtp(mfaSecret)).expect(401);
    s.clock.advanceMinutes(16);
    await reset({ phone: MFA_OWNER.phone, otp: nextOtp(mfaSecret), newPassword: 'owner-new-pass-5' }).expect(200);
  });

  it('rejects malformed input before touching any account', async () => {
    for (const body of [
      { phone: MFA_OWNER.phone, otp: '12345', newPassword: 'owner-new-pass-6' },
      { phone: MFA_OWNER.phone, otp: '123456', newPassword: 'short' },
      { phone: MFA_OWNER.phone, otp: '123456', newPassword: 'owner-new-pass-6', extra: 1 },
    ])
      expect((await reset(body).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
  });
});
