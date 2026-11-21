import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { AUTH_SECRET, buildServices, RELAXED_ABUSE, resetDatabase, Services, TEST_DB_URL, TOKEN_SECRET } from './helpers';

const ADMIN = { phone: '0906000001', password: 'admin-password-1' };
const OWNER = { phone: '0906000002', password: 'owner-password-1' };
const OTHER_OWNER = { phone: '0906000003', password: 'other-owner-password-1' };

let app: INestApplication;
let s: Services;
let operatorId: string;
let otherOperatorId: string;
let ownerId: string;
let adminToken: string;
let ownerToken: string;
let otherOwnerToken: string;

const http = () => request(app.getHttpServer());
const usersPath = (op: string) => `/api/v1/admin/operators/${op}/users`;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (credentials: { phone: string; password: string }) => http().post('/api/v1/auth/login').send(credentials);
const me = (token: string) => http().get('/api/v1/auth/me').set(bearer(token));
const refresh = (refreshToken: string) => http().post('/api/v1/auth/refresh').send({ refreshToken });

async function createSeller(phone: string) {
  const credentials = { phone, password: 'seller-password-1' };
  const { body: user } = await http().post(usersPath(operatorId)).set(bearer(ownerToken))
    .send({ fullName: 'Nhân viên bán vé', role: 'SELLER', ...credentials }).expect(201);
  return { user, credentials, path: `${usersPath(operatorId)}/${user.id}` };
}

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  const users = new UsersService(s.db, s.clock);
  operatorId = (await s.operators.create({ code: 'SF', name: 'Nhà xe SF' })).id;
  otherOperatorId = (await s.operators.create({ code: 'OT', name: 'Nhà xe OT' })).id;
  await users.createPlatformAdmin({ fullName: 'Quản trị', ...ADMIN });
  ownerId = (await users.createStaff(operatorId, { fullName: 'Chủ xe SF', role: 'OWNER', ...OWNER })).id;
  await users.createStaff(otherOperatorId, { fullName: 'Chủ xe OT', role: 'OWNER', ...OTHER_OWNER });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET,
      abuse: RELAXED_ABUSE, clock: s.clock, authRequireMfa: false,
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  adminToken = (await login(ADMIN).expect(200)).body.accessToken;
  ownerToken = (await login(OWNER).expect(200)).body.accessToken;
  otherOwnerToken = (await login(OTHER_OWNER).expect(200)).body.accessToken;
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

it('returns the public fields and current status when creating, updating and listing staff', async () => {
  const { user, credentials, path } = await createSeller('0906000010');
  expect(user).toEqual({
    id: expect.any(String), operatorId, fullName: 'Nhân viên bán vé', phone: '+84906000010',
    role: 'SELLER', mfaEnabled: false, status: 'ACTIVE',
  });
  const active = await http().get(usersPath(operatorId)).set(bearer(ownerToken)).expect(200);
  expect(active.body.users).toContainEqual(user);

  const { body: session } = await login(credentials).expect(200);
  const disabledUser = { ...user, fullName: 'Đổi tên', status: 'DISABLED' };
  await http().patch(path).set(bearer(ownerToken)).send({ status: 'DISABLED', fullName: '  Đổi tên  ' }).expect(200, disabledUser);
  const disabled = await http().get(usersPath(operatorId)).set(bearer(ownerToken)).expect(200);
  expect(disabled.body.users).toContainEqual(disabledUser);
  const { rows: sessions } = await s.db.query('SELECT revoked_at FROM auth_sessions WHERE user_id = $1', [user.id]);
  expect(sessions).toEqual([{ revoked_at: s.clock.now() }]);
  await me(session.accessToken).expect(401);
  const denied = await login(credentials).expect(401);
  expect(denied.body.error.code).toBe('INVALID_CREDENTIALS');
  expect(denied.body.accessToken).toBeUndefined();
  await refresh(session.refreshToken).expect(401);

  await http().patch(path).set(bearer(ownerToken)).send({ status: 'ACTIVE' }).expect(200, { ...disabledUser, status: 'ACTIVE' });
  await refresh(session.refreshToken).expect(401);
  await login(credentials).expect(200);
});

it('normalizes phone changes, rejects invalid or globally reserved numbers, and revokes sessions on a real change', async () => {
  const { user, credentials, path } = await createSeller('0906000020');
  const { body: session } = await login(credentials).expect(200);
  await http().patch(path).set(bearer(ownerToken)).send({ phone: '+84 906 000 020' }).expect(200);
  await me(session.accessToken).expect(200);
  const invalid = await http().patch(path).set(bearer(ownerToken)).send({ phone: '123' }).expect(400);
  expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
  const duplicate = await http().patch(path).set(bearer(ownerToken))
    .send({ phone: '+84 906 000 003', fullName: 'Thay đổi không hợp lệ' }).expect(409);
  expect(duplicate.body.error.code).toBe('CONFLICT');
  await me(session.accessToken).expect(200);

  const changed = await http().patch(path).set(bearer(ownerToken)).send({ phone: '+84 (906) 000-021' }).expect(200);
  expect(changed.body).toEqual({ ...user, phone: '+84906000021' });
  await me(session.accessToken).expect(401);
  await refresh(session.refreshToken).expect(401);
  await login(credentials).expect(401);
  await login({ ...credentials, phone: '0906000021' }).expect(200);
});

it('archives staff, revokes every session, and preserves audit history and the phone reservation', async () => {
  const { user, credentials, path } = await createSeller('0906000030');
  const audit = app.get(AuditService);
  await audit.record({ operatorId, actorUserId: user.id, action: 'payment.record', entity: 'payment' });
  const first = (await login(credentials).expect(200)).body;
  const second = (await login(credentials).expect(200)).body;

  const archived = await http().delete(path).set(bearer(ownerToken)).expect(200);
  expect(archived.body).toEqual({ ok: true });
  await http().delete(path).set(bearer(ownerToken)).expect(200, { ok: true });
  for (const session of [first, second]) {
    await me(session.accessToken).expect(401);
    await refresh(session.refreshToken).expect(401);
  }
  await login(credentials).expect(401);
  await http().patch(path).set(bearer(ownerToken)).send({ status: 'ACTIVE' }).expect(404);
  await http().post(usersPath(operatorId)).set(bearer(ownerToken))
    .send({ fullName: 'Nhân viên mới', role: 'SELLER', ...credentials }).expect(409);
  const listed = await http().get(usersPath(operatorId)).set(bearer(ownerToken)).expect(200);
  expect(listed.body.users.map((staff: { id: string }) => staff.id)).not.toContain(user.id);

  const { rows: account } = await s.db.query('SELECT status, archived_at, token_version FROM users WHERE id = $1', [user.id]);
  expect(account).toEqual([{ status: 'DISABLED', archived_at: s.clock.now(), token_version: 2 }]);
  const { rows: sessions } = await s.db.query('SELECT revoked_at, revoke_reason FROM auth_sessions WHERE user_id = $1', [user.id]);
  expect(sessions).toEqual(Array.from({ length: 2 }, () => ({ revoked_at: s.clock.now(), revoke_reason: 'CREDENTIALS_CHANGED' })));
  const entries = await audit.list(operatorId);
  expect(entries).toContainEqual(expect.objectContaining({ action: 'payment.record', actor_name: user.fullName }));
  expect(entries.filter((entry) => entry.action === 'user.archive' && entry.entity_id === user.id)).toEqual([
    expect.objectContaining({ actor_role: 'OWNER', entity: 'user' }),
  ]);
});

it('requires user.manage and scopes both the operator and the staff ID', async () => {
  const { user, credentials, path } = await createSeller('0906000040');
  const { body: session } = await login(credentials).expect(200);
  await http().delete(path).expect(401);
  await http().delete(path).set(bearer(session.accessToken)).expect(403);
  await http().delete(path).set(bearer(otherOwnerToken)).expect(404);
  const wrongTenantPath = `${usersPath(otherOperatorId)}/${user.id}`;
  await http().patch(wrongTenantPath).set(bearer(otherOwnerToken)).send({ phone: '0906000041' }).expect(404);
  await http().delete(wrongTenantPath).set(bearer(otherOwnerToken)).expect(404);
  await http().delete(wrongTenantPath).set(bearer(adminToken)).expect(404);
  await me(session.accessToken).expect(200);
});

it('rejects self-archive and keeps one active owner across concurrent archive and demotion requests', async () => {
  const self = await http().delete(`${usersPath(operatorId)}/${ownerId.toUpperCase()}`).set(bearer(ownerToken)).expect(403);
  expect(self.body.error.code).toBe('FORBIDDEN');

  const op = await s.operators.create({ code: 'OW', name: 'Nhà xe OW' });
  const users = new UsersService(s.db, s.clock);
  const first = await users.createStaff(op.id, { fullName: 'Chủ xe A', role: 'OWNER', phone: '0906000050', password: OWNER.password });
  const firstPath = `${usersPath(op.id)}/${first.id}`;
  await http().delete(firstPath).set(bearer(adminToken)).expect(409);
  const second = await users.createStaff(op.id, { fullName: 'Chủ xe B', role: 'OWNER', phone: '0906000051', password: OWNER.password });

  const results = await Promise.all([
    http().delete(firstPath).set(bearer(adminToken)),
    http().patch(`${usersPath(op.id)}/${second.id}`).set(bearer(adminToken)).send({ role: 'SELLER' }),
  ]);
  expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
  const listed = await http().get(usersPath(op.id)).set(bearer(adminToken)).expect(200);
  expect(listed.body.users.filter((user: { role: string; status: string }) => user.role === 'OWNER' && user.status === 'ACTIVE'))
    .toHaveLength(1);
});

it('rejects already authenticated staff writes after the acting owner has been archived', async () => {
  const op = await s.operators.create({ code: 'QR', name: 'Nhà xe QR' });
  const users = app.get(UsersService);
  const firstCredentials = { phone: '0906000060', password: OWNER.password };
  const secondCredentials = { phone: '0906000061', password: OWNER.password };
  const first = await users.createStaff(op.id, { fullName: 'Chủ xe A', role: 'OWNER', ...firstCredentials });
  const second = await users.createStaff(op.id, { fullName: 'Chủ xe B', role: 'OWNER', ...secondCredentials });
  await users.createStaff(op.id, { fullName: 'Chủ xe C', role: 'OWNER', phone: '0906000062', password: OWNER.password });
  const firstToken = (await login(firstCredentials).expect(200)).body.accessToken;
  const secondToken = (await login(secondCredentials).expect(200)).body.accessToken;
  const secondActor = await app.get(AuthService).authenticate(secondToken);

  // The guard has already accepted B. Let A commit first before B enters the service.
  await http().delete(`${usersPath(op.id)}/${second.id}`).set(bearer(firstToken)).expect(200);
  await expect(users.archive(secondActor, op.id, first.id)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(users.update(secondActor, op.id, first.id, { status: 'DISABLED' }))
    .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(users.createStaff(op.id, { fullName: 'New staff', role: 'SELLER', phone: '0906000063', password: OWNER.password }, secondActor))
    .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  const { body } = await http().get(usersPath(op.id)).set(bearer(firstToken)).expect(200);
  expect(body.users).toContainEqual(first);
  expect(body.users).toHaveLength(2);
});

describe('staff and policy audits run inside the write transaction (GE3)', () => {
  const failingAudit = async () => {
    throw new Error('audit insert failed');
  };
  const POLICY = { holdMinutes: 10, maxUnitsPerBooking: 5, childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false } };

  it('a failing audit leaves no new staff account behind', async () => {
    const users = app.get(UsersService);
    const actor = await app.get(AuthService).authenticate(ownerToken);
    const input = { fullName: 'Nhân viên không ghi được nhật ký', role: 'SELLER' as const, phone: '0906000070', password: OWNER.password };
    await expect(users.createStaff(operatorId, input, actor, failingAudit)).rejects.toThrow('audit insert failed');
    const { rowCount } = await s.db.query(`SELECT 1 FROM users WHERE phone = '+84906000070'`);
    expect(rowCount).toBe(0);
    // Hook thấy tài khoản mới trong cùng transaction.
    const seen: number[] = [];
    await users.createStaff(operatorId, input, actor, async (q, u) => {
      seen.push((await q.query('SELECT 1 FROM users WHERE id = $1', [u.id])).rowCount ?? 0);
    });
    expect(seen).toEqual([1]);
  });

  it('a failing audit keeps the old role and does not sign the user out', async () => {
    const users = app.get(UsersService);
    const actor = await app.get(AuthService).authenticate(ownerToken);
    const { user, credentials } = await createSeller('0906000071');
    const sellerToken = (await login(credentials).expect(200)).body.accessToken;
    await expect(users.update(actor, operatorId, user.id, { role: 'ACCOUNTANT' }, failingAudit)).rejects.toThrow('audit insert failed');
    const { rows: [row] } = await s.db.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [user.id]);
    expect(row!.role).toBe('SELLER');
    await me(sellerToken).expect(200);
  });

  it('a role change over HTTP is logged exactly once with the new role', async () => {
    const { user, path } = await createSeller('0906000072');
    const { rows: [mark] } = await s.db.query<{ id: string }>('SELECT COALESCE(MAX(id), 0)::text AS id FROM audit_logs');
    await http().patch(path).set(bearer(ownerToken)).send({ role: 'ACCOUNTANT' }).expect(200);
    const { rows } = await s.db.query<{ action: string; data: { role: string; changed: string[] } }>(
      `SELECT action, data FROM audit_logs WHERE entity_id = $1 AND id > $2::bigint ORDER BY id`, [user.id, mark!.id],
    );
    expect(rows).toEqual([{ action: 'user.update', data: { role: 'ACCOUNTANT', changed: ['role'] } }]);
  });

  it('a failing audit keeps the previous policy version', async () => {
    const before = await s.operators.currentPolicy(operatorId);
    await expect(s.operators.updatePolicy(operatorId, { ...POLICY, holdMinutes: 25 }, failingAudit)).rejects.toThrow('audit insert failed');
    const after = await s.operators.currentPolicy(operatorId);
    expect(after.version).toBe(before.version);
    expect(after.holdMinutes).toBe(before.holdMinutes);
    const hook = jest.fn(async () => undefined);
    const saved = await s.operators.updatePolicy(operatorId, { ...POLICY, holdMinutes: 25 }, hook);
    expect(saved.version).toBe(before.version + 1);
    expect(hook).toHaveBeenCalledWith(expect.anything(), saved);
  });
});
