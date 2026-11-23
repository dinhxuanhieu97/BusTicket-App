import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { AUTH_SECRET, buildServices, RELAXED_ABUSE, resetDatabase, Services, TEST_DB_URL, TOKEN_SECRET } from './helpers';

// Màu giao diện Dashboard: OWNER chọn hai màu dải chuyển trong Cài đặt; dashboard đọc qua API brand công khai.

let s: Services;
let app: INestApplication;
let opId: string;
let ownerToken: string;
let sellerToken: string;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const http = () => request(app.getHttpServer());
const put = (body: unknown, token = ownerToken, op = opId) =>
  http().put(`/api/v1/admin/operators/${op}/brand-colors`).set(bearer(token)).send(body as object);
const brand = async () => (await http().get('/api/v1/operators/BC/brand').expect(200)).body;

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  const users = new UsersService(s.db, s.clock);
  opId = (await s.operators.create({ code: 'BC', name: 'Nhà xe Màu' })).id;
  await users.createStaff(opId, { fullName: 'Chủ', role: 'OWNER', phone: '0907100001', password: 'owner-password-1' });
  await users.createStaff(opId, { fullName: 'Bán vé', role: 'SELLER', phone: '0907100002', password: 'seller-password-1' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, abuse: RELAXED_ABUSE, clock: s.clock,
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  const login = (phone: string, password: string) => http().post('/api/v1/auth/login').send({ phone, password }).expect(200);
  ownerToken = (await login('0907100001', 'owner-password-1')).body.accessToken;
  sellerToken = (await login('0907100002', 'seller-password-1')).body.accessToken;
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

it('defaults to null (dashboard uses its built-in palette)', async () => {
  expect((await brand()).brandColors).toBeNull();
  const profile = await http().get(`/api/v1/admin/operators/${opId}/profile`).set(bearer(ownerToken)).expect(200);
  expect(profile.body.brandColors).toBeNull();
});

it('OWNER saves colours (normalised to lower case), audited, visible on the public brand', async () => {
  const res = await put({ colors: { from: '#6366F1', to: '#06b6d4' } }).expect(200);
  expect(res.body.brandColors).toEqual({ from: '#6366f1', to: '#06b6d4' });
  expect((await brand()).brandColors).toEqual({ from: '#6366f1', to: '#06b6d4' });
  const { rows } = await s.db.query<{ data: unknown }>(
    "SELECT data FROM audit_logs WHERE action = 'operator.brand_colors' ORDER BY id DESC LIMIT 1",
  );
  expect(rows[0]?.data).toEqual({ colors: { from: '#6366f1', to: '#06b6d4' } });
});

it('null resets to the default palette', async () => {
  const res = await put({ colors: null }).expect(200);
  expect(res.body.brandColors).toBeNull();
  expect((await brand()).brandColors).toBeNull();
});

it('rejects malformed colours and extra fields', async () => {
  await put({ colors: { from: 'red', to: '#06b6d4' } }).expect(400);
  await put({ colors: { from: '#6366f1' } }).expect(400);
  await put({ colors: { from: '#6366f1', to: '#06b6d4', via: '#ffffff' } }).expect(400);
  await put({ colors: { from: '#6366f1;}', to: '#06b6d4' } }).expect(400);
  await put({}).expect(400);
  expect((await brand()).brandColors).toBeNull();
});

it('SELLER (no policy.write) cannot change colours', async () => {
  await put({ colors: { from: '#000000', to: '#ffffff' } }, sellerToken).expect(403);
  expect((await brand()).brandColors).toBeNull();
});
