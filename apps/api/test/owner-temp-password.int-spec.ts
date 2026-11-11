import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { base32Decode, hotp } from '../src/auth/totp';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { AUTH_SECRET, buildServices, RELAXED_ABUSE, resetDatabase, Services, TEST_DB_URL, TOKEN_SECRET } from './helpers';

// Chủ xe chưa bật 2FA quên mật khẩu: quản trị nền tảng đặt mật khẩu tạm (xác nhận lại bằng mật khẩu + 2FA của chính mình),
// chủ xe phải đổi ở lần đăng nhập sau.

let s: Services;
let app: INestApplication;
let opId: string;
let otherOpId: string;
let ownerId: string;
let otherOwnerId: string;
let sellerId: string;
let archivedOwnerId: string;
let adminToken: string;
let adminSecret: string;
let ownerToken: string;
const ADMIN = { phone: '0906000001', password: 'platform-password-1' };
const OWNER = { phone: '0906000002', password: 'owner-password-1' };
const OWNER2 = { phone: '0906000003', password: 'owner-password-2' };
const SELLER = { phone: '0906000004', password: 'seller-password-1' };
const TEMP = 'temporary-owner-pass';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const http = () => request(app.getHttpServer());
const login = (cred: { phone: string; password: string }, otp?: string) =>
  http().post('/api/v1/auth/login').send({ ...cred, ...(otp ? { otp } : {}) });
const owners = (op: string, token = adminToken) => http().get(`/api/v1/admin/operators/${op}/owners`).set(bearer(token));
const setTemp = (op: string, user: string, body: Record<string, unknown>, token = adminToken) =>
  http().post(`/api/v1/admin/operators/${op}/owners/${user}/temporary-password`).set(bearer(token)).send(body);

function nextOtp(): string {
  s.clock.advanceMinutes(0.5);
  return hotp(base32Decode(adminSecret), Math.floor(s.clock.now().getTime() / 1000 / 30));
}

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  const users = new UsersService(s.db, s.clock);
  opId = (await s.operators.create({ code: 'OT', name: 'Nhà xe A' })).id;
  otherOpId = (await s.operators.create({ code: 'OU', name: 'Nhà xe B' })).id;
  ownerId = (await users.createStaff(opId, { fullName: 'Chủ A', role: 'OWNER', ...OWNER })).id;
  otherOwnerId = (await users.createStaff(otherOpId, { fullName: 'Chủ B', role: 'OWNER', ...OWNER2 })).id;
  sellerId = (await users.createStaff(opId, { fullName: 'Bán vé A', role: 'SELLER', ...SELLER })).id;
  archivedOwnerId = (await users.createStaff(opId, { fullName: 'Chủ cũ', role: 'OWNER', phone: '0906000005', password: 'owner-password-9' })).id;
  await s.db.query(`UPDATE users SET status = 'DISABLED', archived_at = now() WHERE id = $1`, [archivedOwnerId]);
  await users.createPlatformAdmin({ fullName: 'Quản trị', ...ADMIN });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, abuse: RELAXED_ABUSE, clock: s.clock,
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  const first = (await login(ADMIN).expect(200)).body.accessToken;
  adminSecret = (await http().post('/api/v1/auth/mfa/setup').set(bearer(first)).expect(200)).body.secret;
  adminToken = (await http().post('/api/v1/auth/mfa/confirm').set(bearer(first)).send({ otp: nextOtp() }).expect(200)).body.accessToken;
  ownerToken = (await login(OWNER).expect(200)).body.accessToken;
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

describe('platform admin sets a temporary password for an OWNER', () => {
  it('lists only active owners of the operator; operator staff cannot use these routes', async () => {
    const res = await owners(opId).expect(200);
    expect(res.body.owners).toEqual([
      expect.objectContaining({ id: ownerId, role: 'OWNER', status: 'ACTIVE', mfaEnabled: false, mustChangePassword: false, lockedUntil: null }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
    await owners(ownerId).expect(404); // không phải nhà xe
    await owners(opId, ownerToken).expect(403);
    await setTemp(opId, ownerId, { password: TEMP, adminPassword: OWNER.password }, ownerToken).expect(403);
  });

  it('rejects bad input before checking credentials, and wrong admin credentials leave the owner untouched', async () => {
    await setTemp(opId, ownerId, { password: 'short', adminPassword: ADMIN.password }).expect(400);
    await setTemp(opId, ownerId, { password: TEMP, adminPassword: ADMIN.password, extra: 1 }).expect(400);
    const wrong = await setTemp(opId, ownerId, { password: TEMP, adminPassword: 'wrong-password', otp: nextOtp() }).expect(403);
    expect(wrong.body.error.code).toBe('FORBIDDEN');
    const noOtp = await setTemp(opId, ownerId, { password: TEMP, adminPassword: ADMIN.password }).expect(403);
    expect(noOtp.body.error.message).toContain('Authenticator');
    await setTemp(opId, ownerId, { password: TEMP, adminPassword: ADMIN.password, otp: '000000' }).expect(403);
    await http().get('/api/v1/auth/me').set(bearer(ownerToken)).expect(200);
    await login(OWNER).expect(200);
  });

  it('only targets active owners of that operator', async () => {
    for (const [op, user] of [[opId, sellerId], [opId, archivedOwnerId], [opId, otherOwnerId], [otherOpId, ownerId]] as const) {
      const res = await setTemp(op, user, { password: TEMP, adminPassword: ADMIN.password, otp: nextOtp() }).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    await login(SELLER).expect(200);
  });

  it('unlocks the owner, revokes sessions, forces a password change and writes an audit entry', async () => {
    for (let i = 0; i < 5; i++) await login({ ...OWNER, password: 'wrong-password' }).expect(401);
    await login(OWNER).expect(401); // đang khóa
    const locked = (await owners(opId).expect(200)).body.owners[0];
    expect(locked.lockedUntil).not.toBeNull();

    const res = await setTemp(opId, ownerId, { password: TEMP, adminPassword: ADMIN.password, otp: nextOtp() }).expect(200);
    expect(res.body.owner).toMatchObject({ id: ownerId, mustChangePassword: true, lockedUntil: null });
    await http().get('/api/v1/auth/me').set(bearer(ownerToken)).expect(401);
    await login(OWNER).expect(401);

    const temp = await login({ ...OWNER, password: TEMP }).expect(200);
    expect(temp.body.mustChangePassword).toBe(true);
    const t = temp.body.accessToken;
    const blocked = await http().get(`/api/v1/admin/operators/${opId}/users`).set(bearer(t)).expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await http().post('/api/v1/auth/password').set(bearer(t)).send({ currentPassword: TEMP, newPassword: 'owner-password-new' }).expect(200);
    expect((await owners(opId).expect(200)).body.owners[0].mustChangePassword).toBe(false);

    const { rows } = await s.db.query<{ operator_id: string; action: string; data: { twoFactor: boolean; wasLocked: boolean } }>(
      `SELECT operator_id, action, data FROM audit_logs WHERE action = 'owner.password_reset' AND entity_id = $1`,
      [ownerId],
    );
    expect(rows).toEqual([{ operator_id: opId, action: 'owner.password_reset', data: { twoFactor: false, wasLocked: true } }]);
    expect(JSON.stringify(rows)).not.toContain(TEMP);
  });

  it('locks the platform admin after repeated wrong confirmations', async () => {
    for (let i = 0; i < 5; i++) {
      await setTemp(otherOpId, otherOwnerId, { password: TEMP, adminPassword: 'wrong-password', otp: nextOtp() }).expect(403);
    }
    await setTemp(otherOpId, otherOwnerId, { password: TEMP, adminPassword: ADMIN.password, otp: nextOtp() }).expect(403);
    await login(OWNER2).expect(200); // chủ xe B không bị đổi
    s.clock.advanceMinutes(16);
    adminToken = (await login(ADMIN, nextOtp()).expect(200)).body.accessToken;
    await setTemp(otherOpId, otherOwnerId, { password: TEMP, adminPassword: ADMIN.password, otp: nextOtp() }).expect(200);
  });
});
