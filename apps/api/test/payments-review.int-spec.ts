/**
 * Test tái hiện các phát hiện của vòng rà soát subagent T6 (thanh toán). Xem bảng trong task.md.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import type { AuthUser } from '../src/auth/auth.service';
import { UsersService } from '../src/auth/users.service';
import { signJwt } from '../src/auth/jwt';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import { extractBookingCodes } from '../src/payments/sepay';
import {
  AUTH_SECRET, buildServices, errorCode, newKey, RELAXED_ABUSE, resetDatabase, seedOperatorWithTrips, Services, T0, TEST_DB_URL, TOKEN_SECRET,
} from './helpers';

const KEY = 'pn-webhook-key-0123456789abcdef';
const ACC = '0123499999';
const POLICY = { holdMinutes: 10, maxUnitsPerBooking: 5, childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false } };

let app: INestApplication;
let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let owner: AuthUser;
let accountant: AuthUser;
let platform: AuthUser;
let txnSeq = 5000;
let phoneSeq = 100;
const http = () => request(app.getHttpServer());
const freshPhone = () => `09126${String(phoneSeq++).padStart(5, '0')}`;

const vnNow = () => new Date(s.clock.now().getTime() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
const transfer = (content: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id: txnSeq++, gateway: 'MBBank', transactionDate: vnNow(), accountNumber: ACC, code: null, content,
  transferType: 'in', transferAmount: amount, referenceCode: `FT${txnSeq}`, ...extra,
});
const webhook = (payload: object, key = KEY) =>
  http().post('/api/v1/webhooks/payments/sepay').set('Authorization', `Apikey ${key}`).send(payload);
const hold = (seatCode: string, tripId = seed.bedTrip.id) =>
  s.bookings.createHold({ tripId, contactName: 'K', contactPhone: freshPhone(), items: [{ seatCode }] }, newKey());
const booking = async (code: string) =>
  (await s.db.query<{ status: string; paid_amount: number }>('SELECT status, paid_amount FROM bookings WHERE code = $1', [code])).rows[0]!;

async function user(operatorId: string | null, role: 'OWNER' | 'ACCOUNTANT' | 'SELLER' | 'DISPATCHER' | 'PLATFORM_ADMIN') {
  const users = new UsersService(s.db, s.clock);
  const input = { fullName: role, phone: freshPhone(), password: 'staff-password-1' };
  const u = operatorId ? await users.createStaff(operatorId, { ...input, role }) : await users.createPlatformAdmin(input);
  // Token đầy đủ cho test HTTP (bỏ qua bước 2FA, đã được test riêng ở auth-admin.int-spec.ts).
  const now = Math.floor(s.clock.now().getTime() / 1000);
  const token = signJwt({ sub: u.id, ver: 1, scope: 'full', iat: now, exp: now + 3600 }, AUTH_SECRET);
  const actor: AuthUser = { id: u.id, operatorId, role, fullName: role, phone: u.phone, mfaEnabled: true, scope: 'full' };
  return { actor, token };
}

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  await s.operators.updatePolicy(seed.op.id, { ...POLICY, depositPercent: 50 });
  owner = (await user(seed.op.id, 'OWNER')).actor;
  accountant = (await user(seed.op.id, 'ACCOUNTANT')).actor;
  platform = (await user(null, 'PLATFORM_ADMIN')).actor;
  await s.payments.configureAccount(owner, seed.op.id, { bankCode: 'MB', accountNumber: ACC, accountName: 'PN', webhookApiKey: KEY });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, clock: s.clock, abuse: RELAXED_ABUSE, sepayClient: s.sepay,
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
});
afterAll(async () => {
  await app.close();
  await s.db.close();
});
beforeEach(() => s.clock.set(T0));

describe('a bank transfer is never counted twice (manual + SePay)', () => {
  it('a SePay transfer for a booking that already has a matching manual bank entry is not auto-allocated', async () => {
    const h = await hold('A1'); // 380.000đ, cọc 190.000đ
    await s.payments.recordManual(accountant, seed.op.id, { bookingCode: h.booking.code, amount: 100_000, method: 'MANUAL_BANK', bankReference: 'FT999' }, newKey());
    await webhook(transfer(h.booking.code, 100_000, { referenceCode: 'FT999' })).expect(200);
    expect(await booking(h.booking.code)).toMatchObject({ paid_amount: 100_000, status: 'HOLDING' });
    const { rows } = await s.db.query("SELECT review_status, review_reason FROM payments WHERE method = 'BANK_TRANSFER' AND content = $1", [h.booking.code]);
    expect(rows[0]).toMatchObject({ review_status: 'NEEDS_REVIEW', review_reason: 'POSSIBLE_DUPLICATE' });
  });

  it('the same bank reference cannot be recorded manually twice', async () => {
    const h = await hold('A3');
    const input = { bookingCode: h.booking.code, amount: 50_000, method: 'MANUAL_BANK' as const, bankReference: 'ft-777' };
    await s.payments.recordManual(accountant, seed.op.id, input, newKey());
    expect(await errorCode(s.payments.recordManual(owner, seed.op.id, { ...input, bankReference: 'FT 777' }, newKey()))).toBe('CONFLICT');
  });

  it('a manual bank entry for a booking already paid by a matching SePay transfer is refused unless confirmed', async () => {
    const h = await hold('A5');
    await webhook(transfer(h.booking.code, 190_000)).expect(200);
    const input = { bookingCode: h.booking.code, amount: 190_000, method: 'MANUAL_BANK' as const, bankReference: 'FT-NEW-1' };
    expect(await errorCode(s.payments.recordManual(accountant, seed.op.id, input, newKey()))).toBe('CONFLICT');
    expect((await booking(h.booking.code)).paid_amount).toBe(190_000);
  });
});

describe('resolved payments are closed', () => {
  it('leftover money of a RESOLVED payment cannot be allocated', async () => {
    const a = await hold('A7');
    await webhook(transfer(a.booking.code, 760_000)).expect(200);
    const { rows } = await s.db.query<{ id: string }>("SELECT id FROM payments WHERE content = $1 AND method = 'BANK_TRANSFER'", [a.booking.code]);
    await s.payments.resolve(accountant, seed.op.id, rows[0]!.id, { note: 'Đã hoàn phần dư cho khách' });
    const b = await hold('A9');
    expect(await errorCode(s.payments.allocate(accountant, seed.op.id, rows[0]!.id, { bookingCode: b.booking.code }))).toBe('CONFLICT');
    expect((await booking(b.booking.code)).paid_amount).toBe(0);
  });
});

describe('amountDueNow never asks to pay a dead booking', () => {
  it('is 0 for an expired hold (lazily or marked) and for a cancelled booking', async () => {
    const h = await hold('B1');
    s.clock.advanceMinutes(11);
    expect((await s.bookings.getByCode(h.booking.code, h.accessToken)).amountDueNow).toBe(0);
    await s.bookings.expireDueHolds();
    expect((await s.bookings.getByCode(h.booking.code, h.accessToken)).amountDueNow).toBe(0);
    s.clock.set(T0);
    const c = await hold('B3');
    await s.db.query("UPDATE bookings SET status = 'CANCELLED' WHERE code = $1", [c.booking.code]);
    expect((await s.bookings.getByCode(c.booking.code, c.accessToken)).amountDueNow).toBe(0);
  });
});

describe('booking code extraction', () => {
  it.each([
    ['NGUYEN VAN AN CK AN7K3D2Q', 'AN', 'AN7K3D2Q'],
    ['CK PN PN7K3D2Q', 'PN', 'PN7K3D2Q'],
    ['PNPNPN7K3D2Q', 'PN', 'PN7K3D2Q'],
  ])('finds the real code in %p even when the prefix appears earlier', (content, op, code) => {
    expect(extractBookingCodes(content, op)).toContain(code);
  });

  it('matches the booking end-to-end when the sender name starts with the operator prefix', async () => {
    const h = await hold('B5');
    await webhook(transfer(`PN PHAM NGOC ${h.booking.code}`, 190_000)).expect(200);
    expect((await booking(h.booking.code)).status).toBe('CONFIRMED');
  });
});

describe('very large transfers', () => {
  it('records a transfer above 2.1 billion VND (as a flagged payment) instead of failing forever', async () => {
    const r = await webhook(transfer('CHUYEN NHAM SO TIEN LON', 3_000_000_000));
    expect(r.status).toBe(200);
    const { rows } = await s.db.query<{ amount: number; review_reason: string }>(
      "SELECT amount, review_reason FROM payments WHERE content = 'CHUYEN NHAM SO TIEN LON'",
    );
    expect(rows[0]).toEqual({ amount: 3_000_000_000, review_reason: 'UNMATCHED' });
  });

  it('a failing item does not stop reconciliation of the others', async () => {
    await s.payments.configureAccount(owner, seed.op.id, { bankCode: 'MB', accountNumber: ACC, accountName: 'PN', webhookApiKey: KEY, apiToken: 'tok-12345678' });
    const h = await hold('B7');
    const base = { accountNumber: ACC, direction: 'in' as const, referenceCode: null, code: null, transactionAt: s.clock.now() };
    s.sepay.transfers.push(
      { ...base, providerTxnId: 'bad-1', amount: 1_000, content: 'loi\u0000' }, // PostgreSQL không lưu được ký tự NUL → lỗi khi ghi
      { ...base, providerTxnId: 'good-1', amount: 190_000, content: h.booking.code },
    );
    const r = await s.payments.reconcile(seed.op.id);
    expect(r).toMatchObject({ processed: 1, errors: 1 });
    expect((await booking(h.booking.code)).status).toBe('CONFIRMED');
  });
});

describe('payment account changes', () => {
  it('the platform admin may set the first account but not change it afterwards', async () => {
    const op = await s.operators.create({ code: 'NQ', name: 'NQ' });
    const first = { bankCode: 'VCB', accountNumber: '0777000111', accountName: 'NQ', webhookApiKey: 'nq-key-0123456789abcdef0123' };
    await s.payments.configureAccount(platform, op.id, first);
    expect(await errorCode(s.payments.configureAccount(platform, op.id, { ...first, accountNumber: '0777000222' }))).toBe('FORBIDDEN');
  });

  it('changing the account revokes the old webhook key and is audited with old and new account', async () => {
    const op = await s.operators.create({ code: 'NR', name: 'NR' });
    const o = (await user(op.id, 'OWNER')).actor;
    await s.payments.configureAccount(o, op.id, { bankCode: 'VCB', accountNumber: '0888000111', accountName: 'NR', webhookApiKey: 'nr-old-key-0123456789abcdef' });
    await s.payments.configureAccount(o, op.id, { bankCode: 'VCB', accountNumber: '0888000222', accountName: 'NR', webhookApiKey: 'nr-new-key-0123456789abcdef' });
    const r = await webhook(transfer('NRAAAAAA', 1000, { accountNumber: '0888000111' }), 'nr-old-key-0123456789abcdef');
    expect(r.status).toBe(401);
    const { rows } = await s.db.query<{ data: { previousAccountNumber: string; accountNumber: string } }>(
      "SELECT data FROM audit_logs WHERE operator_id = $1 AND action = 'payment_account.configure' ORDER BY id DESC LIMIT 1",
      [op.id],
    );
    expect(rows[0]!.data).toMatchObject({ previousAccountNumber: '0888000111', accountNumber: '0888000222' });
    const { rows: ev } = await s.db.query("SELECT 1 FROM outbox_events WHERE operator_id = $1 AND type = 'payment_account.changed'", [op.id]);
    expect(ev).toHaveLength(1);
  });

  it("the platform admin's audit view does not include payment entries", async () => {
    const h = await hold('B9');
    await s.payments.recordManual(owner, seed.op.id, { bookingCode: h.booking.code, amount: 190_000, method: 'CASH' }, newKey());
    const { token } = await user(null, 'PLATFORM_ADMIN');
    const res = await http().get(`/api/v1/admin/operators/${seed.op.id}/audit-logs`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.entries.some((e: { action: string }) => e.action.startsWith('payment.'))).toBe(false);
  });
});

describe('payment routes over HTTP: permissions and tenant isolation', () => {
  let tokens: Record<string, string>;
  let paymentId: string;

  beforeAll(async () => {
    tokens = {
      PLATFORM_ADMIN: (await user(null, 'PLATFORM_ADMIN')).token,
      DISPATCHER: (await user(seed.op.id, 'DISPATCHER')).token,
      SELLER: (await user(seed.op.id, 'SELLER')).token,
      ACCOUNTANT: (await user(seed.op.id, 'ACCOUNTANT')).token,
    };
    const other = await s.operators.create({ code: 'NX', name: 'NX' });
    tokens.OTHER_OWNER = (await user(other.id, 'OWNER')).token;
    await webhook(transfer('KHONG MA HTTP', 10_000)).expect(200);
    const { rows } = await s.db.query<{ id: string }>("SELECT id FROM payments WHERE content = 'KHONG MA HTTP'");
    paymentId = rows[0]!.id;
  });

  const routes = () => [
    ['GET', `/api/v1/admin/operators/${seed.op.id}/payments`],
    ['POST', `/api/v1/admin/operators/${seed.op.id}/payments/manual`],
    ['POST', `/api/v1/admin/operators/${seed.op.id}/payments/${paymentId}/allocate`],
    ['POST', `/api/v1/admin/operators/${seed.op.id}/payments/${paymentId}/resolve`],
    ['POST', `/api/v1/admin/operators/${seed.op.id}/payments/reconcile`],
  ] as const;

  const call = (method: 'GET' | 'POST', path: string, token: string) =>
    (method === 'GET' ? http().get(path) : http().post(path).set('Idempotency-Key', newKey()).send({}))
      .set('Authorization', `Bearer ${token}`);

  it.each(['PLATFORM_ADMIN', 'DISPATCHER'])('%s gets 403 on every money route', async (role) => {
    for (const [m, p] of routes()) expect([p, (await call(m, p, tokens[role]!)).status]).toEqual([p, 403]);
  });

  it('SELLER may read and record, but not allocate, resolve or reconcile', async () => {
    const [list, manual, allocate, resolve, reconcile] = routes();
    expect((await call(list[0], list[1], tokens.SELLER!)).status).toBe(200);
    expect((await call(manual[0], manual[1], tokens.SELLER!)).status).toBe(400); // qua quyền, body rỗng → lỗi dữ liệu
    for (const [m, p] of [allocate, resolve, reconcile]) expect([p, (await call(m, p, tokens.SELLER!)).status]).toEqual([p, 403]);
  });

  it("another operator's owner gets 404", async () => {
    for (const [m, p] of routes()) expect([p, (await call(m, p, tokens.OTHER_OWNER!)).status]).toEqual([p, 404]);
  });
});
