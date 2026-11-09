import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hotp, base32Decode } from '../src/auth/totp';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { AUTH_SECRET, RELAXED_ABUSE, buildServices, resetDatabase, Services, T0, TEST_DB_URL, TOKEN_SECRET } from './helpers';
import { UsersService } from '../src/auth/users.service';
import * as passwordModule from '../src/auth/password';

let app: INestApplication;
let s: Services;
const http = () => request(app.getHttpServer());

const ADMIN = { phone: '0901000001', password: 'admin-password-1' };
const OWNER = { phone: '0901000002', password: 'owner-password-1' };
const SELLER = { phone: '0901000003', password: 'seller-password-1' };
const DISPATCHER = { phone: '0901000004', password: 'dispatch-password-1' };
const OWNER_AB = { phone: '0901000005', password: 'owner-ab-password' };
const SELLER2 = { phone: '0901000006', password: 'seller2-password-1' };

/** Mã OTP hiện tại; tiến đồng hồ 30 giây trước để mỗi lần dùng là một bước mới (không bị coi là dùng lại). */
function nextOtp(secret: string): string {
  s.clock.advanceMinutes(0.5);
  return hotp(base32Decode(secret), Math.floor(s.clock.now().getTime() / 1000 / 30));
}

function login(cred: { phone: string; password: string }, otp?: string) {
  return http().post('/api/v1/auth/login').send({ ...cred, ...(otp ? { otp } : {}) });
}

/** Đăng nhập lần đầu (token mfa_setup) → bật 2FA → trả token đầy đủ và bí mật TOTP. */
async function loginWithNewMfa(cred: { phone: string; password: string }) {
  const first = await login(cred).expect(200);
  expect(first.body.scope).toBe('mfa_setup');
  const setup = await http().post('/api/v1/auth/mfa/setup').auth(first.body.accessToken, { type: 'bearer' }).expect(200);
  const confirm = await http()
    .post('/api/v1/auth/mfa/confirm')
    .auth(first.body.accessToken, { type: 'bearer' })
    .send({ otp: nextOtp(setup.body.secret) })
    .expect(200);
  expect(confirm.body.scope).toBe('full');
  return { token: confirm.body.accessToken as string, secret: setup.body.secret as string, oldToken: first.body.accessToken as string };
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let adminToken: string;
let adminSecret: string;
let ownerToken: string;
let sellerToken: string;
let dispatcherToken: string;
let pnId: string;
let abId: string;
let ownerAbToken: string;

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  await new UsersService(s.db, s.clock).createPlatformAdmin({ fullName: 'Quản trị', ...ADMIN });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, abuse: RELAXED_ABUSE, clock: s.clock })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
});
afterAll(async () => {
  await app.close();
  await s.db.close();
});

describe('login', () => {
  it('gives the same generic error for a wrong password, an unknown phone and a malformed phone', async () => {
    const results = await Promise.all([
      login({ phone: ADMIN.phone, password: 'wrong-password' }),
      login({ phone: '0999999999', password: 'whatever-123' }),
      login({ phone: 'abc', password: 'whatever-123' }),
    ]);
    for (const r of results) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    expect(new Set(results.map((r) => r.body.error.message)).size).toBe(1);
  });

  it('platform admin must enable 2FA before using the admin API', async () => {
    const first = await login(ADMIN).expect(200);
    expect(first.body).toMatchObject({ scope: 'mfa_setup', user: { role: 'PLATFORM_ADMIN', mfaEnabled: false } });
    const blocked = await http().get('/api/v1/admin/operators').set(bearer(first.body.accessToken)).expect(403);
    expect(blocked.body.error.code).toBe('MFA_SETUP_REQUIRED');
    const me = await http().get('/api/v1/auth/me').set(bearer(first.body.accessToken)).expect(200);
    expect(me.body).toMatchObject({ scope: 'mfa_setup', permissions: [] });
  });

  it('enabling 2FA revokes the setup token and returns a full token', async () => {
    const r = await loginWithNewMfa(ADMIN);
    adminToken = r.token;
    adminSecret = r.secret;
    await http().get('/api/v1/auth/me').set(bearer(r.oldToken)).expect(401);
    const me = await http().get('/api/v1/auth/me').set(bearer(adminToken)).expect(200);
    expect(me.body).toMatchObject({ scope: 'full', user: { mfaEnabled: true } });
    expect(me.body.permissions).toEqual(expect.arrayContaining(['operator.create', 'operator.list']));
    expect(me.body.permissions).not.toContain('payment.read');
    await http().post('/api/v1/auth/mfa/setup').set(bearer(adminToken)).expect(409);
  });

  it('after 2FA is on: no OTP → MFA_REQUIRED, wrong OTP → rejected, right OTP → token, reused OTP → rejected', async () => {
    expect((await login(ADMIN).expect(401)).body.error.code).toBe('MFA_REQUIRED');
    expect((await login(ADMIN, '000000').expect(401)).body.error.code).toBe('INVALID_CREDENTIALS');
    const otp = nextOtp(adminSecret);
    const ok = await login(ADMIN, otp).expect(200);
    expect(ok.body.scope).toBe('full');
    expect((await login(ADMIN, otp).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects missing, malformed and forged bearer tokens', async () => {
    expect((await http().get('/api/v1/auth/me').expect(401)).body.error.code).toBe('UNAUTHENTICATED');
    await http().get('/api/v1/auth/me').set({ Authorization: 'Bearer nope' }).expect(401);
    await http().get('/api/v1/auth/me').set({ Authorization: `Basic ${adminToken}` }).expect(401);
    const [h, p] = adminToken.split('.');
    await http().get('/api/v1/auth/me').set(bearer(`${h}.${p}.AAAA`)).expect(401);
  });
});

describe('platform admin sets up an operator', () => {
  it('creates an operator with two default vehicles and records it in the audit log', async () => {
    const res = await http().post('/api/v1/admin/operators').set(bearer(adminToken)).send({ code: 'PN', name: 'Phong Nhung' }).expect(201);
    pnId = res.body.id;
    const v = await http().get(`/api/v1/admin/operators/${pnId}/vehicles`).set(bearer(adminToken)).expect(200);
    expect(v.body.vehicles.map((x: { code: string }) => x.code)).toEqual(['PN01', 'PN02']);
    const log = await http().get(`/api/v1/admin/operators/${pnId}/audit-logs`).set(bearer(adminToken)).expect(200);
    expect(log.body.entries[0]).toMatchObject({ action: 'operator.create', actor_role: 'PLATFORM_ADMIN' });
  });

  it('creates the owner; the owner must enable 2FA', async () => {
    const created = await http()
      .post(`/api/v1/admin/operators/${pnId}/users`)
      .set(bearer(adminToken))
      .send({ fullName: 'Chủ xe PN', role: 'OWNER', ...OWNER })
      .expect(201);
    expect(created.body).toMatchObject({ role: 'OWNER', phone: '+84901000002', operatorId: pnId });
    expect(JSON.stringify(created.body)).not.toContain('password');
    ownerToken = (await loginWithNewMfa(OWNER)).token;
  });

  it('rejects a weak password and a duplicate phone', async () => {
    const weak = await http()
      .post(`/api/v1/admin/operators/${pnId}/users`)
      .set(bearer(ownerToken))
      .send({ fullName: 'Yếu', role: 'SELLER', phone: '0901000099', password: 'short' })
      .expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');
    await http()
      .post(`/api/v1/admin/operators/${pnId}/users`)
      .set(bearer(ownerToken))
      .send({ fullName: 'Trùng', role: 'SELLER', phone: OWNER.phone, password: 'long-enough-pass' })
      .expect(409);
  });
});

describe('owner manages staff and permissions are enforced', () => {
  it('owner creates a seller and a dispatcher; neither needs 2FA', async () => {
    for (const [cred, role] of [[SELLER, 'SELLER'], [DISPATCHER, 'DISPATCHER'], [SELLER2, 'SELLER']] as const) {
      await http().post(`/api/v1/admin/operators/${pnId}/users`).set(bearer(ownerToken)).send({ fullName: role, role, ...cred }).expect(201);
    }
    const seller = await login(SELLER).expect(200);
    expect(seller.body.scope).toBe('full');
    sellerToken = seller.body.accessToken;
    dispatcherToken = (await login(DISPATCHER).expect(200)).body.accessToken;
  });

  it('seller can read vehicles but cannot create one or manage users', async () => {
    await http().get(`/api/v1/admin/operators/${pnId}/vehicles`).set(bearer(sellerToken)).expect(200);
    const denied = await http()
      .post(`/api/v1/admin/operators/${pnId}/vehicles`)
      .set(bearer(sellerToken))
      .send({ code: 'PN03', name: 'Xe 03', type: 'SEATER', seatLayoutId: '00000000-0000-4000-8000-000000000000' })
      .expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    await http().get(`/api/v1/admin/operators/${pnId}/users`).set(bearer(sellerToken)).expect(403);
  });

  it('owner cannot create platform admins, list operators or edit the shared library', async () => {
    await http()
      .post(`/api/v1/admin/operators/${pnId}/users`)
      .set(bearer(ownerToken))
      .send({ fullName: 'X', role: 'PLATFORM_ADMIN', phone: '0901000098', password: 'long-enough-pass' })
      .expect(403);
    await http().get('/api/v1/admin/operators').set(bearer(ownerToken)).expect(403);
    await http().post('/api/v1/admin/seat-layouts/library').set(bearer(ownerToken)).send({}).expect(403);
  });

  it('dispatcher creates a route and a DRAFT trip, which stays private until opened', async () => {
    const route = await http()
      .post(`/api/v1/admin/operators/${pnId}/routes`)
      .set(bearer(dispatcherToken))
      .send({ code: 'HCM-HA', origin: 'TP.HCM', destination: 'Hoài Ân' })
      .expect(201);
    const vehicles = await http().get(`/api/v1/admin/operators/${pnId}/vehicles`).set(bearer(dispatcherToken)).expect(200);
    const trip = await http()
      .post(`/api/v1/admin/operators/${pnId}/trips`)
      .set(bearer(dispatcherToken))
      .send({
        routeId: route.body.id,
        vehicleId: vehicles.body.vehicles[1].id,
        name: 'TP.HCM → Hoài Ân 19:30',
        departAt: '2027-02-01T12:30:00Z',
        salesOpenAt: '2027-01-01T00:00:00Z',
        salesCloseAt: '2027-02-01T11:30:00Z',
        fares: [
          { floor: '1', occupancy: 1, price: 380000 },
          { floor: '2', occupancy: 1, price: 350000 },
        ],
        status: 'DRAFT',
      })
      .expect(201);
    await http().get(`/api/v1/trips/${trip.body.id}/seats`).expect(404);
    await http()
      .patch(`/api/v1/admin/operators/${pnId}/trips/${trip.body.id}/status`)
      .set(bearer(dispatcherToken))
      .send({ status: 'OPEN' })
      .expect(200);
    await http().get(`/api/v1/trips/${trip.body.id}/seats`).expect(200);
    const list = await http().get(`/api/v1/admin/operators/${pnId}/trips?date=2027-02-01`).set(bearer(sellerToken)).expect(200);
    expect(list.body.trips[0]).toMatchObject({ status: 'OPEN', available: 40, capacity: 40 });
    const bad = await http()
      .patch(`/api/v1/admin/operators/${pnId}/trips/${trip.body.id}/status`)
      .set(bearer(dispatcherToken))
      .send({ status: 'CANCELLED' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('normalizes plates and treats vehicle names case-insensitively', async () => {
    const vehicles = await http().get(`/api/v1/admin/operators/${pnId}/vehicles`).set(bearer(ownerToken)).expect(200);
    const id = vehicles.body.vehicles[0].id;
    const a = await http()
      .patch(`/api/v1/admin/operators/${pnId}/vehicles/${id}`)
      .set(bearer(ownerToken))
      .send({ plateNumber: '  77b  123.45 ' })
      .expect(200);
    expect(a.body.plate_number).toBe('77B 123.45');
    const b = await http().patch(`/api/v1/admin/operators/${pnId}/vehicles/${id}`).set(bearer(ownerToken)).send({ plateNumber: '   ' }).expect(200);
    expect(b.body.plate_number).toBeNull();
    const dup = await http().patch(`/api/v1/admin/operators/${pnId}/vehicles/${id}`).set(bearer(ownerToken)).send({ name: 'xe 02' }).expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');
  });

  it('records writes in the audit log without secrets', async () => {
    const log = await http().get(`/api/v1/admin/operators/${pnId}/audit-logs`).set(bearer(ownerToken)).expect(200);
    const actions = log.body.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['user.create', 'route.create', 'trip.create', 'trip.status', 'vehicle.update', 'user.mfa_enable']));
    expect(JSON.stringify(log.body)).not.toMatch(/password|long-enough|seller-password/i);
  });
});

describe('tenant isolation', () => {
  it("another operator's owner gets 404 on every PN resource", async () => {
    abId = (await http().post('/api/v1/admin/operators').set(bearer(adminToken)).send({ code: 'AB', name: 'Nhà xe AB' }).expect(201)).body.id;
    await http()
      .post(`/api/v1/admin/operators/${abId}/users`)
      .set(bearer(adminToken))
      .send({ fullName: 'Chủ AB', role: 'OWNER', ...OWNER_AB })
      .expect(201);
    ownerAbToken = (await loginWithNewMfa(OWNER_AB)).token;

    for (const path of ['vehicles', 'users', 'routes', 'policy', 'seat-layouts', 'audit-logs', 'trips?date=2027-02-01']) {
      const r = await http().get(`/api/v1/admin/operators/${pnId}/${path}`).set(bearer(ownerAbToken));
      expect([path, r.status]).toEqual([path, 404]);
    }
    const pnVehicles = await http().get(`/api/v1/admin/operators/${pnId}/vehicles`).set(bearer(ownerToken)).expect(200);
    // Dùng đường dẫn của chính mình nhưng id xe của PN → vẫn 404.
    await http()
      .patch(`/api/v1/admin/operators/${abId}/vehicles/${pnVehicles.body.vehicles[0].id}`)
      .set(bearer(ownerAbToken))
      .send({ name: 'Cướp xe' })
      .expect(404);
    const users = await http().get(`/api/v1/admin/operators/${pnId}/users`).set(bearer(ownerToken)).expect(200);
    const sellerId = users.body.users.find((u: { role: string }) => u.role === 'SELLER').id;
    await http().patch(`/api/v1/admin/operators/${abId}/users/${sellerId}`).set(bearer(ownerAbToken)).send({ status: 'DISABLED' }).expect(404);
  });

  it('returns 404 for a malformed operator id', async () => {
    await http().get('/api/v1/admin/operators/not-a-uuid/vehicles').set(bearer(adminToken)).expect(404);
  });
});

describe('revocation and safety rails', () => {
  let sellerId: string;
  let ownerId: string;

  beforeAll(async () => {
    const users = await http().get(`/api/v1/admin/operators/${pnId}/users`).set(bearer(ownerToken)).expect(200);
    sellerId = users.body.users.find((u: { role: string }) => u.role === 'SELLER').id;
    ownerId = users.body.users.find((u: { role: string }) => u.role === 'OWNER').id;
  });

  it('changing your own password revokes old tokens', async () => {
    const res = await http()
      .post('/api/v1/auth/password')
      .set(bearer(sellerToken))
      .send({ currentPassword: SELLER.password, newPassword: 'seller-password-2' })
      .expect(200);
    await http().get('/api/v1/auth/me').set(bearer(sellerToken)).expect(401);
    sellerToken = res.body.accessToken;
    await http().get('/api/v1/auth/me').set(bearer(sellerToken)).expect(200);
    await http()
      .post('/api/v1/auth/password')
      .set(bearer(sellerToken))
      .send({ currentPassword: 'wrong-current-pw', newPassword: 'seller-password-3' })
      .expect(401);
  });

  it('disabling a user revokes their session immediately and blocks login', async () => {
    await http().patch(`/api/v1/admin/operators/${pnId}/users/${sellerId}`).set(bearer(ownerToken)).send({ status: 'DISABLED' }).expect(200);
    await http().get('/api/v1/auth/me').set(bearer(sellerToken)).expect(401);
    expect((await login({ phone: SELLER.phone, password: 'seller-password-2' }).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('users cannot change their own role or status, or reset their own password without the current one', async () => {
    await http().patch(`/api/v1/admin/operators/${pnId}/users/${ownerId}`).set(bearer(ownerToken)).send({ status: 'DISABLED' }).expect(403);
    await http().patch(`/api/v1/admin/operators/${pnId}/users/${ownerId}`).set(bearer(ownerToken)).send({ password: 'new-password-xyz' }).expect(403);
  });

  it('self-protection cannot be bypassed by writing your own id in upper case', async () => {
    const upper = ownerId.toUpperCase();
    expect(upper).not.toBe(ownerId);
    for (const body of [{ password: 'new-password-xyz' }, { role: 'SELLER' }, { status: 'DISABLED' }]) {
      const r = await http().patch(`/api/v1/admin/operators/${pnId}/users/${upper}`).set(bearer(ownerToken)).send(body);
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 403]);
    }
    await http().get('/api/v1/auth/me').set(bearer(ownerToken)).expect(200);
  });

  it('an operator must keep at least one active owner', async () => {
    const r = await http().patch(`/api/v1/admin/operators/${pnId}/users/${ownerId}`).set(bearer(adminToken)).send({ role: 'SELLER' }).expect(409);
    expect(r.body.error.code).toBe('CONFLICT');
  });

  it('parallel login bursts cannot test more than 5 passwords per lock window', async () => {
    // Đếm số lần mật khẩu được so với chuỗi băm THẬT của tài khoản (lần bị khóa chỉ so với chuỗi băm giả).
    const { rows } = await s.db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE phone = $1', [
      '+84' + SELLER2.phone.slice(1),
    ]);
    const realHash = rows[0]!.password_hash;
    const spy = jest.spyOn(passwordModule, 'verifyPassword');
    try {
      const burst = await Promise.all(
        Array.from({ length: 20 }, (_, i) => login({ phone: SELLER2.phone, password: `burst-wrong-${i}-pw` })),
      );
      const realChecks = spy.mock.calls.filter(([, hash]) => hash === realHash).length;
      expect(spy).toHaveBeenCalledTimes(20); // mỗi yêu cầu đúng một lần so (thật hoặc giả)
      expect(realChecks).toBeGreaterThanOrEqual(1);
      expect(realChecks).toBeLessThanOrEqual(5);
      // Mọi phản hồi đều giống hệt nhau (không lộ trạng thái khóa).
      expect(new Set(burst.map((r) => `${r.status}:${r.body.error?.code}`))).toEqual(new Set(['401:INVALID_CREDENTIALS']));
    } finally {
      spy.mockRestore();
    }
    // Đúng mật khẩu trong lúc đang khóa vẫn bị từ chối và không xóa khóa.
    expect((await login(SELLER2).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS');
    s.clock.advanceMinutes(15);
    await login(SELLER2).expect(200);
  });

  it('a correct password without the OTP does not reset the failure counter (no unlimited OTP guessing)', async () => {
    await login(ADMIN, nextOtp(adminSecret)).expect(200); // bộ đếm về 0
    for (let i = 0; i < 4; i++) await login(ADMIN, '000000').expect(401);
    // Xen kẽ mật khẩu đúng không kèm OTP không được làm mới bộ đếm.
    expect((await login(ADMIN).expect(401)).body.error.code).toBe('MFA_REQUIRED');
    expect((await login(ADMIN).expect(401)).body.error.code).toBe('MFA_REQUIRED');
    await login(ADMIN, '000000').expect(401); // lượt sai thứ 5 → khóa
    // Đang khóa: kể cả mật khẩu + OTP đúng cũng chỉ nhận lỗi chung.
    expect((await login(ADMIN).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await login(ADMIN, nextOtp(adminSecret)).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS');
    s.clock.advanceMinutes(15);
  });

  it('locks the account after 5 wrong passwords, even for the right password, until the lock expires', async () => {
    for (let i = 0; i < 5; i++) await login({ phone: DISPATCHER.phone, password: `wrong-${i}-password` }).expect(401);
    expect((await login(DISPATCHER).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS');
    s.clock.advanceMinutes(15);
    await login(DISPATCHER).expect(200);
  });
});

describe('audit log never stores password values', () => {
  it('an owner resetting a staff password logs which field changed but not the value', async () => {
    const users = await http().get(`/api/v1/admin/operators/${pnId}/users`).set(bearer(ownerToken)).expect(200);
    const dispatcherId = users.body.users.find((u: { role: string }) => u.role === 'DISPATCHER').id;
    await http()
      .patch(`/api/v1/admin/operators/${pnId}/users/${dispatcherId}`)
      .set(bearer(ownerToken))
      .send({ password: 'Reset-Value-9876' })
      .expect(200);
    const log = await http().get(`/api/v1/admin/operators/${pnId}/audit-logs`).set(bearer(ownerToken)).expect(200);
    const entry = log.body.entries.find((e: { action: string; entity_id: string }) => e.action === 'user.update' && e.entity_id === dispatcherId);
    expect(entry).toBeDefined();
    expect(JSON.stringify(log.body)).not.toContain('Reset-Value-9876');
    await login({ phone: DISPATCHER.phone, password: 'Reset-Value-9876' }).expect(200);
  });
});
