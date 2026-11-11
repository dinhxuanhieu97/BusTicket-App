import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { base32Decode, hotp } from '../src/auth/totp';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { AUTH_SECRET, buildServices, RELAXED_ABUSE, resetDatabase, Services, TEST_DB_URL, TOKEN_SECRET } from './helpers';

/** Phiên đăng nhập quản trị: access token 15 phút + refresh token xoay vòng, ghi nhớ 30 ngày, đăng xuất thu hồi. */

let app: INestApplication;
let s: Services;
const http = () => request(app.getHttpServer());
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const SELLER = { phone: '0903000001', password: 'seller-password-1' };
const SELLER_B = { phone: '0903000002', password: 'seller-b-password' };
const OWNER = { phone: '0903000003', password: 'owner-password-1' };
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function login(cred: { phone: string; password: string }, extra: Record<string, unknown> = {}) {
  return http().post('/api/v1/auth/login').send({ ...cred, ...extra });
}
const refresh = (refreshToken: unknown) => http().post('/api/v1/auth/refresh').send({ refreshToken });
const me = (token: string) => http().get('/api/v1/auth/me').set(bearer(token));
const ms = (iso: string) => new Date(iso).getTime();

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  const users = new UsersService(s.db, s.clock);
  const op = await s.operators.create({ code: 'SS', name: 'Phiên' });
  await users.createStaff(op.id, { fullName: 'Bán vé', role: 'SELLER', ...SELLER });
  await users.createStaff(op.id, { fullName: 'Bán vé B', role: 'SELLER', ...SELLER_B });
  await users.createStaff(op.id, { fullName: 'Chủ xe', role: 'OWNER', ...OWNER });
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.forRoot({
        databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET,
        abuse: RELAXED_ABUSE, clock: s.clock, authAccessTtlSeconds: 15 * 60, authRequireMfa: true,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
});
afterAll(async () => {
  await app.close();
  await s.db.close();
});

describe('login issues a session', () => {
  it('without remember me: 15-minute access token, 12-hour session, refresh token only stored hashed', async () => {
    const now = s.clock.now().getTime();
    const res = await login(SELLER).expect(200);
    expect(res.body).toMatchObject({ scope: 'full', remember: false });
    expect(ms(res.body.expiresAt) - now).toBe(15 * MIN);
    expect(ms(res.body.sessionExpiresAt) - now).toBe(12 * 60 * MIN);
    expect(res.body.refreshToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    const [sid, secret] = (res.body.refreshToken as string).split('.');
    const { rows } = await s.db.query<{ refresh_hash: string }>('SELECT refresh_hash FROM auth_sessions WHERE id = $1', [sid]);
    expect(rows[0]!.refresh_hash).toHaveLength(64);
    expect(rows[0]!.refresh_hash).not.toContain(secret);
  });

  it('with remember me: 30-day session', async () => {
    const now = s.clock.now().getTime();
    const res = await login(SELLER, { rememberMe: true }).expect(200);
    expect(res.body.remember).toBe(true);
    expect(ms(res.body.sessionExpiresAt) - now).toBe(30 * DAY);
  });

  it('rejects a non-boolean rememberMe', async () => {
    await login(SELLER, { rememberMe: 'yes' }).expect(400);
  });
});

describe('refresh', () => {
  it('renews an expired access token and rotates the refresh token', async () => {
    const first = (await login(SELLER, { rememberMe: true }).expect(200)).body;
    s.clock.advanceMinutes(15);
    await me(first.accessToken).expect(401);
    const next = (await refresh(first.refreshToken).expect(200)).body;
    expect(next.refreshToken).toBeTruthy();
    expect(next.refreshToken).not.toBe(first.refreshToken);
    expect(next.remember).toBe(true);
    expect(next.sessionExpiresAt).toBe(first.sessionExpiresAt); // hạn tuyệt đối không kéo dài
    expect((await me(next.accessToken).expect(200)).body.user.phone).toBe('+84903000001');
    await refresh(next.refreshToken).expect(200);
  });

  it('tolerates the just-replaced token during the grace window without rotating again', async () => {
    const first = (await login(SELLER).expect(200)).body;
    const second = (await refresh(first.refreshToken).expect(200)).body;
    s.clock.advanceMinutes(0.25);
    const late = (await refresh(first.refreshToken).expect(200)).body;
    expect(late.refreshToken).toBeNull();
    await me(late.accessToken).expect(200);
    await refresh(second.refreshToken).expect(200); // token mới nhất vẫn dùng được
  });

  it('after the grace window the replaced token recovers a lost response, and the other branch is then caught as theft', async () => {
    const first = (await login(SELLER).expect(200)).body;
    const second = (await refresh(first.refreshToken).expect(200)).body; // phản hồi này "bị mất" hoặc rơi vào tay kẻ gian
    s.clock.advanceMinutes(1);
    const recovered = (await refresh(first.refreshToken).expect(200)).body;
    expect(recovered.refreshToken).toBeTruthy();
    await me(recovered.accessToken).expect(200);
    // Ai đó dùng token của nhánh bị loại → đánh cắp → cả phiên bị thu hồi.
    expect((await refresh(second.refreshToken).expect(401)).body.error.code).toBe('UNAUTHENTICATED');
    await refresh(recovered.refreshToken).expect(401);
    await me(recovered.accessToken).expect(401); // access token gắn phiên cũng chết ngay
    const sid = (first.refreshToken as string).split('.')[0];
    const { rows } = await s.db.query<{ revoke_reason: string }>('SELECT revoke_reason FROM auth_sessions WHERE id = $1', [sid]);
    expect(rows[0]!.revoke_reason).toBe('REUSE');
  });

  it('detects reuse of a token replaced two or more rotations ago (attacker refreshed twice)', async () => {
    const t1 = (await login(SELLER).expect(200)).body;
    const t2 = (await refresh(t1.refreshToken).expect(200)).body;
    const t3 = (await refresh(t2.refreshToken).expect(200)).body;
    const t4 = (await refresh(t3.refreshToken).expect(200)).body;
    s.clock.advanceMinutes(1);
    await refresh(t1.refreshToken).expect(401); // chủ thật quay lại với token cũ
    await refresh(t4.refreshToken).expect(401); // kẻ gian mất phiên
    await me(t4.accessToken).expect(401);
  });

  it('an unknown secret for a known session id does not revoke it (no denial of service from a leaked sid)', async () => {
    const a = (await login(SELLER).expect(200)).body;
    const [sid] = (a.refreshToken as string).split('.');
    await refresh(`${sid}.${'B'.repeat(43)}`).expect(401);
    await refresh(a.refreshToken).expect(200);
  });

  it('accepts the replaced token right up to the 30-second grace boundary', async () => {
    const t1 = (await login(SELLER).expect(200)).body;
    await refresh(t1.refreshToken).expect(200);
    s.clock.advanceMinutes(0.5);
    expect((await refresh(t1.refreshToken).expect(200)).body.refreshToken).toBeNull();
    s.clock.advanceMinutes(1 / 60);
    expect((await refresh(t1.refreshToken).expect(200)).body.refreshToken).toBeTruthy(); // hết ân hạn → cấp nhánh mới
  });

  it('parallel refreshes with the same token all succeed and rotate exactly once', async () => {
    const first = (await login(SELLER).expect(200)).body;
    const results = await Promise.all(Array.from({ length: 6 }, () => refresh(first.refreshToken)));
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
    const rotated = results.map((r) => r.body.refreshToken).filter(Boolean);
    expect(rotated).toHaveLength(1);
    await refresh(rotated[0]).expect(200);
  });

  it('never outlives the absolute session expiry', async () => {
    const first = (await login(SELLER).expect(200)).body; // 12 giờ
    s.clock.advanceMinutes(12 * 60 - 5);
    const near = (await refresh(first.refreshToken).expect(200)).body;
    expect(ms(near.expiresAt)).toBe(ms(first.sessionExpiresAt)); // access token bị cắt theo hạn phiên
    s.clock.advanceMinutes(5);
    await me(near.accessToken).expect(401);
    await refresh(near.refreshToken).expect(401);
  });

  it('a 30-day session ends after 30 days', async () => {
    const first = (await login(SELLER, { rememberMe: true }).expect(200)).body;
    s.clock.advanceMinutes(30 * 24 * 60 - 1);
    const last = (await refresh(first.refreshToken).expect(200)).body;
    s.clock.advanceMinutes(1);
    await refresh(last.refreshToken).expect(401);
  });

  it('rejects malformed, unknown and tampered tokens', async () => {
    const first = (await login(SELLER).expect(200)).body;
    const [sid] = (first.refreshToken as string).split('.');
    for (const bad of ['garbage', `${sid}.${'A'.repeat(43)}`, `00000000-0000-4000-8000-000000000000.${'A'.repeat(43)}`, first.accessToken]) {
      expect((await refresh(bad).expect(401)).body.error.code).toBe('UNAUTHENTICATED');
    }
    await refresh(123).expect(400);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken, extra: 1 }).expect(400);
    await refresh(first.refreshToken).expect(200); // token sai không làm hỏng phiên thật
  });

  it('stops working when the account is disabled or its tokens are revoked by an owner', async () => {
    const a = (await login(SELLER_B).expect(200)).body;
    await s.db.query('UPDATE users SET token_version = token_version + 1 WHERE phone = $1', ['+84903000002']);
    await refresh(a.refreshToken).expect(401);
    await s.db.query('UPDATE users SET token_version = token_version - 1 WHERE phone = $1', ['+84903000002']);
    const b = (await login(SELLER_B).expect(200)).body;
    await s.db.query(`UPDATE users SET status = 'DISABLED' WHERE phone = $1`, ['+84903000002']);
    await refresh(b.refreshToken).expect(401);
    await s.db.query(`UPDATE users SET status = 'ACTIVE' WHERE phone = $1`, ['+84903000002']);
  });
});

describe('logout', () => {
  it('revokes the session by refresh token: access and refresh tokens stop working immediately', async () => {
    const a = (await login(SELLER).expect(200)).body;
    const other = (await login(SELLER).expect(200)).body; // thiết bị khác không bị ảnh hưởng
    expect((await http().post('/api/v1/auth/logout').send({ refreshToken: a.refreshToken }).expect(200)).body).toEqual({ ok: true });
    await me(a.accessToken).expect(401);
    await refresh(a.refreshToken).expect(401);
    await me(other.accessToken).expect(200);
    await refresh(other.refreshToken).expect(200);
  });

  it('revokes the session by access token alone', async () => {
    const a = (await login(SELLER).expect(200)).body;
    await http().post('/api/v1/auth/logout').set(bearer(a.accessToken)).send({}).expect(200);
    await me(a.accessToken).expect(401);
    await refresh(a.refreshToken).expect(401);
  });

  it('accepts the just-replaced refresh token (logout racing a refresh)', async () => {
    const a = (await login(SELLER).expect(200)).body;
    const b = (await refresh(a.refreshToken).expect(200)).body;
    await http().post('/api/v1/auth/logout').send({ refreshToken: a.refreshToken }).expect(200);
    await refresh(b.refreshToken).expect(401);
  });

  it('always answers 200 for unknown or missing tokens', async () => {
    await http().post('/api/v1/auth/logout').send({ refreshToken: 'nope' }).expect(200);
    await http().post('/api/v1/auth/logout').send({}).expect(200);
    await http().post('/api/v1/auth/logout').set(bearer('x.y.z')).send({}).expect(200);
    await http().post('/api/v1/auth/logout').set('Content-Type', 'application/json').send('[1, 2]').expect(200);
  });
});

describe('credential changes', () => {
  it('changing the password ends every other session and keeps the current one with its original expiry', async () => {
    const deviceA = (await login(SELLER_B, { rememberMe: true }).expect(200)).body;
    const deviceB = (await login(SELLER_B).expect(200)).body;
    s.clock.advanceMinutes(10);
    const changed = await http()
      .post('/api/v1/auth/password')
      .set(bearer(deviceA.accessToken))
      .send({ currentPassword: SELLER_B.password, newPassword: 'seller-b-password-2' })
      .expect(200);
    expect(changed.body.refreshToken).toBeTruthy();
    expect(changed.body.remember).toBe(true);
    expect(changed.body.sessionExpiresAt).toBe(deviceA.sessionExpiresAt);
    await refresh(deviceA.refreshToken).expect(401);
    await refresh(deviceB.refreshToken).expect(401);
    await me(deviceB.accessToken).expect(401);
    await me(changed.body.accessToken).expect(200);
    await refresh(changed.body.refreshToken).expect(200);
  });

  it('enabling optional 2FA from a full session keeps the absolute session expiry', async () => {
    // Mật khẩu đã đổi ở test trước.
    const a = (await login({ phone: SELLER_B.phone, password: 'seller-b-password-2' }).expect(200)).body; // phiên 12 giờ, chưa bật 2FA
    s.clock.advanceMinutes(12 * 60 - 20);
    const fresh = (await refresh(a.refreshToken).expect(200)).body;
    const setup = await http().post('/api/v1/auth/mfa/setup').set(bearer(fresh.accessToken)).expect(200);
    s.clock.advanceMinutes(0.5);
    const otp = hotp(base32Decode(setup.body.secret), Math.floor(s.clock.now().getTime() / 1000 / 30));
    const confirmed = (await http().post('/api/v1/auth/mfa/confirm').set(bearer(fresh.accessToken)).send({ otp }).expect(200)).body;
    expect(confirmed.sessionExpiresAt).toBe(a.sessionExpiresAt);
  });

  it('carries remember me through first-time 2FA setup', async () => {
    const first = (await login(OWNER, { rememberMe: true }).expect(200)).body;
    expect(first).toMatchObject({ scope: 'mfa_setup', refreshToken: null, sessionExpiresAt: null, remember: true });
    const setup = await http().post('/api/v1/auth/mfa/setup').set(bearer(first.accessToken)).expect(200);
    s.clock.advanceMinutes(0.5);
    const otp = hotp(base32Decode(setup.body.secret), Math.floor(s.clock.now().getTime() / 1000 / 30));
    const now = s.clock.now().getTime();
    const confirmed = (await http().post('/api/v1/auth/mfa/confirm').set(bearer(first.accessToken)).send({ otp }).expect(200)).body;
    expect(confirmed).toMatchObject({ scope: 'full', remember: true });
    expect(ms(confirmed.sessionExpiresAt) - now).toBe(30 * DAY);
    await me(first.accessToken).expect(401);
    s.clock.advanceMinutes(20);
    await refresh(confirmed.refreshToken).expect(200);
  });
});
