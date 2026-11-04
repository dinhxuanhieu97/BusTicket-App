/**
 * T6 — thanh toán SePay: webhook, phân bổ tiền, xác nhận vé, ngoại lệ, ghi nhận thủ công, đối soát.
 * Tiêu chí: PNTicketDocs mục 13 (AC-04 … AC-10, AC-13).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import type { AuthUser } from '../src/auth/auth.service';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import {
  AUTH_SECRET, buildServices, errorCode, newKey, RELAXED_ABUSE, resetDatabase, seedOperatorWithTrips, Services, T0, TEST_DB_URL, TOKEN_SECRET,
} from './helpers';

const KEY_PN = 'pn-webhook-key-0123456789abcdef';
const KEY_AB = 'ab-webhook-key-0123456789abcdef';
const ACC_PN = '0123499999';
const ACC_AB = '0555000111';
const POLICY = { holdMinutes: 10, maxUnitsPerBooking: 5, childPolicy: { freeUnderAge: 2, price: 0, maxPerUnit: 1, countsTowardCapacity: false } };

let app: INestApplication;
let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let owner: AuthUser;
let accountant: AuthUser;
let seller: AuthUser;
let abOwner: AuthUser;
let abId: string;
let txnSeq = 1000;
let phoneSeq = 100;
const http = () => request(app.getHttpServer());
const freshPhone = () => `09125${String(phoneSeq++).padStart(5, '0')}`;

/** Giờ VN dạng SePay "YYYY-MM-DD HH:mm:ss" của thời điểm hiện tại (đồng hồ test) + lệch phút. */
function vnTime(offsetMinutes = 0): string {
  const d = new Date(s.clock.now().getTime() + offsetMinutes * 60_000 + 7 * 3600_000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function transfer(content: string, amount: number, extra: Record<string, unknown> = {}) {
  return {
    id: txnSeq++, gateway: 'MBBank', transactionDate: vnTime(), accountNumber: ACC_PN, code: null, content,
    transferType: 'in', transferAmount: amount, accumulated: 0, subAccount: null, referenceCode: `FT${txnSeq}`, description: '',
    ...extra,
  };
}

const webhook = (payload: object, key = KEY_PN) =>
  http().post('/api/v1/webhooks/payments/sepay').set('Authorization', `Apikey ${key}`).send(payload);

async function hold(seatCode: string, tripId = seed.bedTrip.id, occupancy = 1) {
  return s.bookings.createHold(
    { tripId, contactName: 'Khách', contactPhone: freshPhone(), items: [{ seatCode, occupancy }] },
    newKey(),
  );
}

async function booking(code: string) {
  const { rows } = await s.db.query<{ status: string; paid_amount: number; payment_status: string; deposit_amount: number; total_amount: number }>(
    'SELECT status, paid_amount, payment_status, deposit_amount, total_amount FROM bookings WHERE code = $1',
    [code],
  );
  return rows[0]!;
}

async function paymentsFor(content: string) {
  const { rows } = await s.db.query<{ id: string; amount: number; allocated_amount: number; review_status: string; review_reason: string | null }>(
    'SELECT id, amount, allocated_amount, review_status, review_reason FROM payments WHERE content = $1 ORDER BY created_at',
    [content],
  );
  return rows;
}

async function staff(operatorId: string, role: 'OWNER' | 'ACCOUNTANT' | 'SELLER'): Promise<AuthUser> {
  const u = await new UsersService(s.db, s.clock).createStaff(operatorId, {
    fullName: role, phone: freshPhone(), password: 'staff-password-1', role,
  });
  return { id: u.id, operatorId, role, fullName: role, phone: u.phone, mfaEnabled: true, scope: 'full' };
}

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  owner = await staff(seed.op.id, 'OWNER');
  accountant = await staff(seed.op.id, 'ACCOUNTANT');
  seller = await staff(seed.op.id, 'SELLER');
  await s.payments.configureAccount(owner, seed.op.id, {
    bankCode: 'MB', accountNumber: ACC_PN, accountName: 'NHA XE PHONG NHUNG', webhookApiKey: KEY_PN, apiToken: 'sepay-api-token-pn',
  });
  abId = (await s.operators.create({ code: 'AB', name: 'Nhà xe AB' })).id;
  abOwner = await staff(abId, 'OWNER');
  await s.payments.configureAccount(abOwner, abId, {
    bankCode: 'VCB', accountNumber: ACC_AB, accountName: 'NHA XE AB', webhookApiKey: KEY_AB,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, clock: s.clock, abuse: RELAXED_ABUSE,
      sepayClient: s.sepay,
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

describe('webhook authentication', () => {
  it('rejects a missing or wrong API key, and the key of another operator for this account', async () => {
    const h = await hold('A1');
    for (const key of [undefined, 'wrong-key', KEY_AB]) {
      const req = http().post('/api/v1/webhooks/payments/sepay').send(transfer(h.booking.code, 380_000));
      const r = await (key ? req.set('Authorization', `Apikey ${key}`) : req);
      expect([key, r.status]).toEqual([key, 401]);
    }
    expect((await booking(h.booking.code)).status).toBe('HOLDING');
    expect(await paymentsFor(h.booking.code)).toEqual([]);
  });

  it('rejects an unknown receiving account with the same 401', async () => {
    const r = await webhook(transfer('PNAAAAAA', 1000, { accountNumber: '9999999999' }));
    expect(r.status).toBe(401);
  });

  it('rejects a malformed payload with 400', async () => {
    const r = await webhook({ id: 1, accountNumber: ACC_PN, transferType: 'in' });
    expect(r.status).toBe(400);
  });
});

describe('full payment', () => {
  it('AC-04: a transfer of the full amount confirms the booking, issues the outbox event and books the seat', async () => {
    const h = await hold('A3');
    const r = await webhook(transfer(`NGUYEN VAN A CK ${h.booking.code}`, 380_000)).expect(200);
    expect(r.body).toEqual({ success: true, status: 'PROCESSED' });
    expect(await booking(h.booking.code)).toMatchObject({ status: 'CONFIRMED', paid_amount: 380_000, payment_status: 'PAID' });
    const map = await s.trips.seatMap(seed.bedTrip.id);
    expect(map.seats.find((x) => x.code === 'A3')!.status).toBe('BOOKED');
    const { rows } = await s.db.query("SELECT type FROM outbox_events WHERE payload->>'bookingCode' = $1 ORDER BY id", [h.booking.code]);
    expect(rows.map((r) => r.type)).toEqual(['payment.allocated', 'booking.confirmed']);
    const view = await s.bookings.getByCode(h.booking.code, h.accessToken);
    expect(view).toMatchObject({ status: 'CONFIRMED', paidAmount: 380_000, amountDueNow: 0, paymentStatus: 'PAID' });
  });

  it('AC-06: the same webhook sent twice (and concurrently) is counted once', async () => {
    const h = await hold('A5');
    const payload = transfer(h.booking.code, 380_000);
    const results = await Promise.all(Array.from({ length: 5 }, () => webhook(payload)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.status === 'PROCESSED')).toHaveLength(1);
    expect(results.filter((r) => r.body.status === 'DUPLICATE')).toHaveLength(4);
    const pays = await paymentsFor(h.booking.code);
    expect(pays).toHaveLength(1);
    expect(await booking(h.booking.code)).toMatchObject({ paid_amount: 380_000, status: 'CONFIRMED' });
    const { rows } = await s.db.query("SELECT COUNT(*)::int AS n FROM outbox_events WHERE type = 'booking.confirmed' AND payload->>'bookingCode' = $1", [h.booking.code]);
    expect(rows[0]!.n).toBe(1);
  });

  it('ignores outgoing transfers but stores the event', async () => {
    const r = await webhook(transfer('rut tien', 500_000, { transferType: 'out' })).expect(200);
    expect(r.body.status).toBe('IGNORED');
    expect(await paymentsFor('rut tien')).toEqual([]);
  });
});

describe('deposit and partial payments', () => {
  beforeAll(() => s.operators.updatePolicy(seed.op.id, { ...POLICY, depositPercent: 50 }));
  afterAll(() => s.operators.updatePolicy(seed.op.id, { ...POLICY, depositPercent: 100 }));

  it('a 50% deposit confirms; the rest later makes it PAID', async () => {
    const h = await hold('A2', seed.limoTrip.id, 2); // phòng đôi tầng 1: 700.000đ → cọc 350.000đ
    expect(h.booking).toMatchObject({ totalAmount: 700_000, depositAmount: 350_000, amountDueNow: 350_000 });
    await webhook(transfer(h.booking.code, 350_000)).expect(200);
    expect(await booking(h.booking.code)).toMatchObject({ status: 'CONFIRMED', payment_status: 'DEPOSIT_PAID', paid_amount: 350_000 });
    expect((await s.bookings.getByCode(h.booking.code, h.accessToken)).amountDueNow).toBe(350_000);
    s.clock.advanceMinutes(60); // phần còn lại trả sau hạn giữ chỗ: đơn đã xác nhận nên vẫn nhận
    await webhook(transfer(h.booking.code, 350_000)).expect(200);
    expect(await booking(h.booking.code)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID', paid_amount: 700_000 });
  });

  it('AC-08: below the deposit stays on hold as PARTIAL; a second transfer confirms', async () => {
    const h = await hold('A4', seed.limoTrip.id, 1); // 450.000đ → cọc 225.000đ
    await webhook(transfer(h.booking.code, 100_000)).expect(200);
    expect(await booking(h.booking.code)).toMatchObject({ status: 'HOLDING', payment_status: 'PARTIAL', paid_amount: 100_000 });
    expect((await s.bookings.getByCode(h.booking.code, h.accessToken)).amountDueNow).toBe(125_000);
    await webhook(transfer(h.booking.code, 125_000)).expect(200);
    expect(await booking(h.booking.code)).toMatchObject({ status: 'CONFIRMED', payment_status: 'DEPOSIT_PAID', paid_amount: 225_000 });
  });

  it('AC-08: overpayment confirms, allocates only up to the total and flags the rest', async () => {
    const h = await hold('A6', seed.limoTrip.id, 1);
    await webhook(transfer(h.booking.code, 500_000)).expect(200);
    expect(await booking(h.booking.code)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID', paid_amount: 450_000 });
    const [p] = await paymentsFor(h.booking.code);
    expect(p).toMatchObject({ amount: 500_000, allocated_amount: 450_000, review_status: 'NEEDS_REVIEW', review_reason: 'OVERPAID' });
  });
});

describe('late, unmatched and ambiguous transfers', () => {
  it('AC-09: money arriving after the hold expired and the seat was resold is flagged, the new buyer keeps the seat', async () => {
    const first = await hold('B1');
    s.clock.advanceMinutes(11);
    const second = await hold('B1'); // hết hạn "lười" → bán lại
    const late = transfer(first.booking.code, 380_000);
    await webhook(late).expect(200);
    expect((await booking(first.booking.code)).status).toBe('EXPIRED');
    expect((await booking(second.booking.code)).status).toBe('HOLDING');
    const [p] = await paymentsFor(first.booking.code);
    expect(p).toMatchObject({ allocated_amount: 0, review_status: 'NEEDS_REVIEW', review_reason: 'LATE' });
  });

  it('a transfer made before the hold expired but delivered late still confirms if the seat was not resold', async () => {
    const h = await hold('B3');
    const paidInTime = transfer(h.booking.code, 380_000, { transactionDate: vnTime(9) });
    s.clock.advanceMinutes(12);
    await webhook(paidInTime).expect(200);
    expect((await booking(h.booking.code)).status).toBe('CONFIRMED');
  });

  it('a transfer made after the hold expired is flagged even if nobody took the seat', async () => {
    const h = await hold('B5');
    s.clock.advanceMinutes(12);
    await webhook(transfer(h.booking.code, 380_000)).expect(200);
    expect(await booking(h.booking.code)).toMatchObject({ status: 'HOLDING', paid_amount: 0 });
    expect((await paymentsFor(h.booking.code))[0]).toMatchObject({ review_reason: 'LATE' });
  });

  it('AC-05: a payment and a competing hold racing on an expired booking never both win', async () => {
    const h = await hold('B7');
    const paidInTime = transfer(h.booking.code, 380_000, { transactionDate: vnTime(5) });
    s.clock.advanceMinutes(15);
    const [w, competing] = await Promise.all([
      webhook(paidInTime),
      s.bookings.createHold({ tripId: seed.bedTrip.id, contactName: 'K', contactPhone: freshPhone(), items: [{ seatCode: 'B7' }] }, newKey())
        .then(() => 'OK', (e) => e.code),
    ]);
    expect(w.status).toBe(200);
    const first = await booking(h.booking.code);
    if (first.status === 'CONFIRMED') expect(competing).toBe('SEAT_UNAVAILABLE');
    else {
      expect(competing).toBe('OK');
      expect((await paymentsFor(h.booking.code))[0]).toMatchObject({ review_reason: 'LATE', allocated_amount: 0 });
    }
    const { rows } = await s.db.query(
      `SELECT COUNT(*)::int AS n FROM trip_seats ts JOIN bookings b ON b.id = ts.booking_id
       WHERE ts.trip_id = $1 AND ts.seat_code = 'B7' AND b.status IN ('HOLDING', 'CONFIRMED')`,
      [seed.bedTrip.id],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('flags a transfer without any booking code as UNMATCHED', async () => {
    await webhook(transfer('chuyen tien ve que', 200_000)).expect(200);
    expect((await paymentsFor('chuyen tien ve que'))[0]).toMatchObject({ review_reason: 'UNMATCHED', allocated_amount: 0 });
  });

  it('flags a transfer naming two existing bookings as AMBIGUOUS', async () => {
    const a = await hold('B9');
    const b = await hold('C1');
    const content = `${a.booking.code} ${b.booking.code}`;
    await webhook(transfer(content, 760_000)).expect(200);
    expect((await paymentsFor(content))[0]).toMatchObject({ review_reason: 'AMBIGUOUS', allocated_amount: 0 });
    expect((await booking(a.booking.code)).status).toBe('HOLDING');
  });

  it("never applies money to another operator's booking with the same code shape", async () => {
    const h = await hold('C3');
    // Tiền vào tài khoản của AB nhưng nội dung là mã đơn của PN: không được phân bổ.
    await webhook(transfer(h.booking.code, 380_000, { accountNumber: ACC_AB }), KEY_AB).expect(200);
    expect((await booking(h.booking.code)).paid_amount).toBe(0);
  });

  it('matches codes written in lower case or glued to other text', async () => {
    const h = await hold('C5');
    const content = `ck${h.booking.code.toLowerCase()}tien xe`;
    await webhook(transfer(content, 380_000)).expect(200);
    expect((await booking(h.booking.code)).status).toBe('CONFIRMED');
  });
});

describe('manual payments (level 0) and staff actions', () => {
  it('AC-13: recording cash twice with the same key records it once', async () => {
    const h = await hold('C7');
    const key = newKey();
    const input = { bookingCode: h.booking.code, amount: 380_000, method: 'CASH' as const };
    const results = await Promise.all(Array.from({ length: 4 }, () => s.payments.recordManual(seller, seed.op.id, input, key)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await booking(h.booking.code)).toMatchObject({ status: 'CONFIRMED', paid_amount: 380_000 });
    expect(await errorCode(s.payments.recordManual(seller, seed.op.id, { ...input, amount: 1000 }, key))).toBe('IDEMPOTENCY_CONFLICT');
    const { rows } = await s.db.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'payment.record_manual' AND data->>'bookingCode' = $1", [h.booking.code]);
    expect(rows[0]!.n).toBe(1);
  });

  it('only owner/accountant may confirm a bank transfer manually, and it needs a bank reference', async () => {
    const h = await hold('C9');
    const input = { bookingCode: h.booking.code, amount: 380_000, method: 'MANUAL_BANK' as const, bankReference: 'FT26308ABC' };
    expect(await errorCode(s.payments.recordManual(seller, seed.op.id, input, newKey()))).toBe('FORBIDDEN');
    expect(await errorCode(s.payments.recordManual(accountant, seed.op.id, { ...input, bankReference: undefined }, newKey()))).toBe('VALIDATION_FAILED');
    await s.payments.recordManual(accountant, seed.op.id, input, newKey());
    expect((await booking(h.booking.code)).status).toBe('CONFIRMED');
  });

  it("cannot record a payment for another operator's booking", async () => {
    const h = await hold('D1');
    expect(
      await errorCode(s.payments.recordManual(abOwner, abId, { bookingCode: h.booking.code, amount: 1000, method: 'CASH' }, newKey())),
    ).toBe('NOT_FOUND');
  });

  it('allocates an unmatched transfer to the right booking, never more than what is left', async () => {
    const h = await hold('D2');
    const content = 'CK TIEN XE TET';
    await webhook(transfer(content, 500_000)).expect(200);
    const [p] = await paymentsFor(content);
    expect(await errorCode(s.payments.allocate(accountant, seed.op.id, p!.id, { bookingCode: h.booking.code, amount: 600_000 }))).toBe(
      'VALIDATION_FAILED',
    );
    const view = await s.payments.allocate(accountant, seed.op.id, p!.id, { bookingCode: h.booking.code });
    expect(view).toMatchObject({ allocatedAmount: 380_000, unallocatedAmount: 120_000 });
    expect((await booking(h.booking.code)).status).toBe('CONFIRMED');
    // Đơn đã trả đủ: không phân bổ thêm được.
    expect(await errorCode(s.payments.allocate(accountant, seed.op.id, p!.id, { bookingCode: h.booking.code }))).toBe('CONFLICT');
  });

  it('parallel manual allocations of one payment never exceed its amount', async () => {
    const content = 'TIEN XE KHONG GHI MA';
    await webhook(transfer(content, 400_000)).expect(200);
    const [p] = await paymentsFor(content);
    const targets = await Promise.all(['D3', 'D4', 'D5', 'D6'].map((c) => hold(c)));
    await Promise.all(targets.map((t) => errorCode(s.payments.allocate(accountant, seed.op.id, p!.id, { bookingCode: t.booking.code, amount: 380_000 }))));
    const { rows } = await s.db.query<{ amount: number; allocated_amount: number; sum: number }>(
      `SELECT p.amount, p.allocated_amount, (SELECT COALESCE(SUM(amount), 0)::int FROM payment_allocations WHERE payment_id = p.id) AS sum
       FROM payments p WHERE p.id = $1`,
      [p!.id],
    );
    expect(rows[0]!.sum).toBe(rows[0]!.allocated_amount);
    expect(rows[0]!.allocated_amount).toBeLessThanOrEqual(400_000);
  });

  it('resolving a flagged payment needs a note and is audited', async () => {
    const content = 'KHACH CHUYEN NHAM';
    await webhook(transfer(content, 50_000)).expect(200);
    const [p] = await paymentsFor(content);
    expect(await errorCode(s.payments.resolve(accountant, seed.op.id, p!.id, { note: '' }))).toBe('VALIDATION_FAILED');
    const v = await s.payments.resolve(accountant, seed.op.id, p!.id, { note: 'Đã hoàn tiền cho khách qua MB, FT999' });
    expect(v.review).toMatchObject({ status: 'RESOLVED' });
    expect(await errorCode(s.payments.resolve(accountant, seed.op.id, p!.id, { note: 'lần hai' }))).toBe('CONFLICT');
    expect(await errorCode(s.payments.resolve(abOwner, abId, p!.id, { note: 'không phải của tôi' }))).toBe('NOT_FOUND');
  });

  it('lists payments needing review', async () => {
    const list = await s.payments.list(seed.op.id, { review: 'NEEDS_REVIEW' });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((p) => p.review.status === 'NEEDS_REVIEW')).toBe(true);
    // Sổ của AB chỉ có khoản tiền vào tài khoản AB (mang mã đơn PN) — ghi nhận là chưa khớp, không gắn vào đơn PN.
    const ab = await s.payments.list(abId, { review: 'NEEDS_REVIEW' });
    expect(ab.every((p) => p.matchedBookingCode === null && p.allocatedAmount === 0)).toBe(true);
    const pnIds = new Set(list.map((p) => p.id));
    expect(ab.some((p) => pnIds.has(p.id))).toBe(false);
  });
});

describe('AC-10: reconciliation catches missed webhooks', () => {
  it('processes transfers the webhook never delivered, once', async () => {
    const h = await hold('D7');
    const missed = { ...transfer(h.booking.code, 380_000) };
    s.sepay.transfers.push({
      providerTxnId: String(missed.id), accountNumber: ACC_PN, direction: 'in', amount: 380_000, content: missed.content,
      referenceCode: null, code: null, transactionAt: s.clock.now(),
    });
    const r1 = await s.payments.reconcile(seed.op.id);
    expect(r1).toMatchObject({ processed: 1 });
    expect((await booking(h.booking.code)).status).toBe('CONFIRMED');
    expect(s.sepay.calls.at(-1)!.token).toBe('sepay-api-token-pn');
    const r2 = await s.payments.reconcile(seed.op.id);
    expect(r2).toMatchObject({ processed: 0, duplicates: 1 });
    // Webhook đến muộn cho cùng giao dịch cũng bị coi là trùng.
    expect((await webhook(missed)).body.status).toBe('DUPLICATE');
  });

  it('needs an API token', async () => {
    expect(await errorCode(s.payments.reconcile(abId))).toBe('VALIDATION_FAILED');
  });
});

describe('payment instructions for the customer', () => {
  it('returns the QR, amount due and the booking code as transfer content', async () => {
    const h = await hold('D8'); // D8: tầng trên (D6–D10) → 350.000đ
    const r = await http().get(`/api/v1/bookings/${h.booking.code}/payment`).set('X-Booking-Token', h.accessToken).expect(200);
    expect(r.body).toMatchObject({
      payable: true, amountDue: 350_000, transferContent: h.booking.code,
      bank: { code: 'MB', accountNumber: ACC_PN, accountName: 'NHA XE PHONG NHUNG' },
    });
    expect(r.body.qrImageUrl).toContain('amount=350000');
    expect(JSON.stringify(r.body)).not.toMatch(/sepay-api-token|webhook/i);
    await http().get(`/api/v1/bookings/${h.booking.code}/payment`).set('X-Booking-Token', 'nope').expect(404);
  });

  it('is not payable once paid or expired', async () => {
    const paid = await hold('D9');
    await webhook(transfer(paid.booking.code, 380_000)).expect(200);
    const a = await http().get(`/api/v1/bookings/${paid.booking.code}/payment`).set('X-Booking-Token', paid.accessToken).expect(200);
    expect(a.body).toMatchObject({ payable: false, reason: 'PAID' });
    const exp = await hold('D10');
    s.clock.advanceMinutes(11);
    const b = await http().get(`/api/v1/bookings/${exp.booking.code}/payment`).set('X-Booking-Token', exp.accessToken).expect(200);
    expect(b.body).toMatchObject({ payable: false, reason: 'NOT_PAYABLE' });
  });
});

describe('payment account configuration', () => {
  it('never returns the webhook key or API token, and one account cannot belong to two operators', async () => {
    const acc = await s.payments.getAccount(seed.op.id);
    expect(acc).toEqual({ provider: 'SEPAY', bankCode: 'MB', accountNumber: ACC_PN, accountName: 'NHA XE PHONG NHUNG', reconcileEnabled: true });
    const { rows } = await s.db.query('SELECT webhook_key_hash, api_token_enc FROM operator_payment_accounts WHERE account_number = $1', [ACC_PN]);
    expect(JSON.stringify(rows)).not.toContain(KEY_PN);
    expect(JSON.stringify(rows)).not.toContain('sepay-api-token-pn');
    expect(
      await errorCode(s.payments.configureAccount(abOwner, abId, { bankCode: 'MB', accountNumber: ACC_PN, accountName: 'X', webhookApiKey: 'x'.repeat(30) })),
    ).toBe('CONFLICT');
    expect(await errorCode(s.payments.configureAccount(owner, seed.op.id, { bankCode: 'MB', accountNumber: ACC_PN, accountName: 'X', webhookApiKey: 'short' }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});
