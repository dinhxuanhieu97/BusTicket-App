import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { base32Decode, hotp } from '../src/auth/totp';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { AUTH_SECRET, buildServices, RELAXED_ABUSE, resetDatabase, Services, TEST_DB_URL, TOKEN_SECRET } from './helpers';

// 2FA tùy chọn (mặc định): OWNER đăng nhập bằng mật khẩu là có phiên đầy đủ; tự bật 2FA được, và tắt được khi có
// đúng mật khẩu + mã hiện tại. Chế độ bắt buộc (`authRequireMfa: true`) được kiểm ở auth-admin / auth-sessions.

let s: Services;
let app: INestApplication;
let strictApp: INestApplication;
let opId: string;
const OWNER = { phone: '0904000001', password: 'owner-password-1' };
const OWNER_2 = { phone: '0904000002', password: 'owner-password-2' };
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

function nextOtp(secret: string): string {
  s.clock.advanceMinutes(0.5);
  return hotp(base32Decode(secret), Math.floor(s.clock.now().getTime() / 1000 / 30));
}

async function makeApp(requireMfa: boolean) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.forRoot({
        databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET,
        abuse: RELAXED_ABUSE, clock: s.clock, ...(requireMfa ? { authRequireMfa: true } : {}),
      }),
    ],
  }).compile();
  const a = moduleRef.createNestApplication({ logger: false });
  a.useGlobalFilters(new HttpErrorFilter());
  await a.init();
  return a;
}

const http = (a: INestApplication = app) => request(a.getHttpServer());
const login = (cred: { phone: string; password: string }, otp?: string, a?: INestApplication) =>
  http(a).post('/api/v1/auth/login').send({ ...cred, ...(otp ? { otp } : {}) });

async function enableMfa(token: string) {
  const setup = await http().post('/api/v1/auth/mfa/setup').set(bearer(token)).expect(200);
  const confirmed = await http()
    .post('/api/v1/auth/mfa/confirm')
    .set(bearer(token))
    .send({ otp: nextOtp(setup.body.secret) })
    .expect(200);
  return { secret: setup.body.secret as string, token: confirmed.body.accessToken as string };
}

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  const users = new UsersService(s.db, s.clock);
  const op = await s.operators.create({ code: 'OM', name: 'Tùy chọn 2FA' });
  opId = op.id;
  await users.createStaff(op.id, { fullName: 'Chủ xe', role: 'OWNER', ...OWNER });
  await users.createStaff(op.id, { fullName: 'Chủ xe 2', role: 'OWNER', ...OWNER_2 });
  app = await makeApp(false);
  strictApp = await makeApp(true);
});
afterAll(async () => {
  await app.close();
  await strictApp.close();
  await s.db.close();
});

describe('optional 2FA', () => {
  it('an OWNER without 2FA gets a full session and permissions from the password alone', async () => {
    const res = await login(OWNER).expect(200);
    expect(res.body).toMatchObject({ scope: 'full', user: { role: 'OWNER', mfaEnabled: false } });
    expect(res.body.refreshToken).toEqual(expect.any(String));
    const me = await http().get('/api/v1/auth/me').set(bearer(res.body.accessToken)).expect(200);
    expect(me.body.permissions.length).toBeGreaterThan(0);
    await http()
      .get(`/api/v1/admin/operators/${opId}/trips?date=2026-11-20`)
      .set(bearer(res.body.accessToken))
      .expect(200);
  });

  it('the same OWNER under AUTH_REQUIRE_MFA=true is still limited to 2FA setup', async () => {
    const res = await login(OWNER_2, undefined, strictApp).expect(200);
    expect(res.body).toMatchObject({ scope: 'mfa_setup', refreshToken: null });
    const optional = await login(OWNER_2).expect(200);
    const previousToken = optional.body.accessToken;
    await http(strictApp)
      .get(`/api/v1/admin/operators/${opId}/trips?date=2026-11-20`)
      .set(bearer(previousToken))
      .expect(403);
  });

  it('2FA can still be enabled voluntarily, after which login needs the code', async () => {
    const first = await login(OWNER).expect(200);
    const { secret } = await enableMfa(first.body.accessToken);
    expect((await login(OWNER).expect(401)).body.error.code).toBe('MFA_REQUIRED');
    await login(OWNER, nextOtp(secret)).expect(200);
  });
});

describe('POST /auth/mfa/disable', () => {
  let secret: string;
  let token: string;
  beforeAll(async () => {
    const first = await login(OWNER_2).expect(200);
    ({ secret, token } = await enableMfa(first.body.accessToken));
  });

  const disable = (t: string, body: object, a?: INestApplication) =>
    http(a).post('/api/v1/auth/mfa/disable').set(bearer(t)).send(body);

  it('rejects a wrong password or a wrong code, and requires both fields', async () => {
    expect((await disable(token, { password: 'nope-nope-nope', otp: nextOtp(secret) }).expect(401)).body.error.code).toBe(
      'INVALID_CREDENTIALS',
    );
    expect((await disable(token, { password: OWNER_2.password, otp: '000000' }).expect(401)).body.error.code).toBe(
      'INVALID_CREDENTIALS',
    );
    await disable(token, { password: OWNER_2.password }).expect(400);
    const me = await http().get('/api/v1/auth/me').set(bearer(token)).expect(200);
    expect(me.body.user.mfaEnabled).toBe(true);
  });

  it('is refused while 2FA is mandatory for the role', async () => {
    const res = await disable(token, { password: OWNER_2.password, otp: nextOtp(secret) }, strictApp).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('turns 2FA off, revokes old sessions, issues a fresh one and is audited', async () => {
    const other = await login(OWNER_2, nextOtp(secret)).expect(200);
    const res = await disable(token, { password: OWNER_2.password, otp: nextOtp(secret) }).expect(200);
    expect(res.body).toMatchObject({ scope: 'full', user: { mfaEnabled: false } });
    expect(res.body.refreshToken).toEqual(expect.any(String));
    await http().get('/api/v1/auth/me').set(bearer(token)).expect(401);
    await http().post('/api/v1/auth/refresh').send({ refreshToken: other.body.refreshToken }).expect(401);
    await http().get('/api/v1/auth/me').set(bearer(res.body.accessToken)).expect(200);
    expect((await login(OWNER_2).expect(200)).body.scope).toBe('full');
    const { rows } = await s.db.query<{ mfa_secret_enc: string | null }>(
      'SELECT mfa_secret_enc FROM users WHERE phone = $1',
      ['+84904000002'],
    );
    expect(rows[0]?.mfa_secret_enc ?? null).toBeNull();
    const audit = await s.db.query("SELECT 1 FROM audit_logs WHERE action = 'user.mfa_disable'");
    expect(audit.rowCount).toBe(1);
  });

  it('answers 409 when 2FA is already off', async () => {
    const res = await login(OWNER_2).expect(200);
    expect((await disable(res.body.accessToken, { password: OWNER_2.password, otp: '123456' }).expect(409)).body.error.code).toBe(
      'CONFLICT',
    );
  });
});
