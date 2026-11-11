import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { sniffImage } from '../src/operators/operators.service';
import { AUTH_SECRET, buildServices, RELAXED_ABUSE, resetDatabase, Services, TEST_DB_URL, TOKEN_SECRET } from './helpers';

// Logo nhà xe: OWNER tải ảnh trong Cài đặt; dashboard hiển thị tên + logo ở trang đăng nhập qua API công khai.

let s: Services;
let app: INestApplication;
let opId: string;
let otherOpId: string;
let ownerToken: string;
let sellerToken: string;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32, 3)]);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const http = () => request(app.getHttpServer());
const upload = (data: Buffer, type: string, token = ownerToken, op = opId) =>
  http().put(`/api/v1/admin/operators/${op}/logo`).set(bearer(token)).set('Content-Type', type).send(data);

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  const users = new UsersService(s.db, s.clock);
  opId = (await s.operators.create({ code: 'LG', name: 'Nhà xe Logo' })).id;
  otherOpId = (await s.operators.create({ code: 'LH', name: 'Nhà xe khác' })).id;
  await users.createStaff(opId, { fullName: 'Chủ', role: 'OWNER', phone: '0907000001', password: 'owner-password-1' });
  await users.createStaff(opId, { fullName: 'Bán vé', role: 'SELLER', phone: '0907000002', password: 'seller-password-1' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, abuse: RELAXED_ABUSE, clock: s.clock,
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  const login = (phone: string, password: string) => http().post('/api/v1/auth/login').send({ phone, password }).expect(200);
  ownerToken = (await login('0907000001', 'owner-password-1')).body.accessToken;
  sellerToken = (await login('0907000002', 'seller-password-1')).body.accessToken;
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

it('recognises PNG, JPEG and WebP by their signature only', () => {
  expect(sniffImage(PNG)).toBe('image/png');
  expect(sniffImage(JPEG)).toBe('image/jpeg');
  expect(sniffImage(WEBP)).toBe('image/webp');
  expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  expect(sniffImage(Buffer.alloc(0))).toBeNull();
});

it('public brand has no logo until one is uploaded; unknown codes are 404', async () => {
  expect((await http().get('/api/v1/operators/LG/brand').expect(200)).body).toEqual({ code: 'LG', name: 'Nhà xe Logo', logoVersion: null });
  await http().get('/api/v1/operators/LG/logo').expect(404);
  await http().get('/api/v1/operators/ZZ/brand').expect(404);
  await http().get('/api/v1/operators/lg/brand').expect(404);
});

it('OWNER uploads a logo; the public endpoint serves it with safe headers', async () => {
  const res = await upload(PNG, 'image/png').expect(200);
  expect(res.body).toMatchObject({ id: opId, code: 'LG', logoVersion: expect.stringMatching(/^\d+$/) });
  const brand = (await http().get('/api/v1/operators/LG/brand').expect(200)).body;
  expect(brand.logoVersion).toBe(res.body.logoVersion);
  const img = await http().get('/api/v1/operators/LG/logo').buffer(true).parse((r, cb) => {
    const parts: Buffer[] = [];
    r.on('data', (c: Buffer) => parts.push(c));
    r.on('end', () => cb(null, Buffer.concat(parts)));
  }).expect(200);
  expect(img.headers['content-type']).toBe('image/png');
  expect(img.headers['x-content-type-options']).toBe('nosniff');
  expect(img.headers['content-security-policy']).toContain('sandbox');
  expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);
  await http().get('/api/v1/operators/LH/logo').expect(404); // nhà xe khác không bị ảnh hưởng

  s.clock.advanceMinutes(1);
  const next = await upload(WEBP, 'image/webp').expect(200);
  expect(next.body.logoVersion).not.toBe(res.body.logoVersion);
  const { rows } = await s.db.query<{ action: string; data: { mime: string; bytes: number } }>(
    `SELECT action, data FROM audit_logs WHERE operator_id = $1 AND action LIKE 'operator.logo.%' ORDER BY at`,
    [opId],
  );
  expect(rows).toEqual([
    { action: 'operator.logo.update', data: { mime: 'image/png', bytes: PNG.length } },
    { action: 'operator.logo.update', data: { mime: 'image/webp', bytes: WEBP.length } },
  ]);
});

it('rejects SVG, mismatched types, empty and oversized files without changing the logo', async () => {
  const before = (await http().get('/api/v1/operators/LG/brand').expect(200)).body.logoVersion;
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  for (const [data, type] of [
    [svg, 'image/svg+xml'],
    [svg, 'image/png'],
    [JPEG, 'image/png'],
    [Buffer.alloc(0), 'image/png'],
    [Buffer.concat([PNG, Buffer.alloc(200 * 1024)]), 'image/png'],
  ] as const) {
    const res = await upload(data, type).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  }
  await http().put(`/api/v1/admin/operators/${opId}/logo`).set(bearer(ownerToken)).send({ logo: 'x' }).expect(400);
  expect((await http().get('/api/v1/operators/LG/brand').expect(200)).body.logoVersion).toBe(before);
});

it('only staff with policy.write of that operator can change the logo', async () => {
  await upload(PNG, 'image/png', sellerToken).expect(403);
  await http().delete(`/api/v1/admin/operators/${opId}/logo`).set(bearer(sellerToken)).expect(403);
  await upload(PNG, 'image/png', ownerToken, otherOpId).expect(404);
  await http().put(`/api/v1/admin/operators/${opId}/logo`).set('Content-Type', 'image/png').send(PNG).expect(401);
});

it('OWNER removes the logo; profile and brand report none', async () => {
  const res = await http().delete(`/api/v1/admin/operators/${opId}/logo`).set(bearer(ownerToken)).expect(200);
  expect(res.body.logoVersion).toBeNull();
  expect((await http().get('/api/v1/operators/LG/brand').expect(200)).body.logoVersion).toBeNull();
  await http().get('/api/v1/operators/LG/logo').expect(404);
  const profile = await http().get(`/api/v1/admin/operators/${opId}/profile`).set(bearer(ownerToken)).expect(200);
  expect(profile.body).toMatchObject({ name: 'Nhà xe Logo', logoVersion: null });
});
