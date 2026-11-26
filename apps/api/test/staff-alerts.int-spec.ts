import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CapturingMailSender } from '../src/alerts/mail-sender';
import { ALERT_MAX_ATTEMPTS, ALERT_STALE_MS, StaffAlertsService } from '../src/alerts/staff-alerts.service';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/auth/users.service';
import { HttpErrorFilter } from '../src/common/http-error.filter';
import {
  AUTH_SECRET, buildServices, newKey, RELAXED_ABUSE, resetDatabase, seedOperatorWithTrips, Services, T0, TEST_DB_URL, TOKEN_SECRET,
} from './helpers';

// QS01/QS03: chủ xe tự cấu hình email (SMTP + mật khẩu ứng dụng) trong Dashboard; khách đặt vé hoặc gửi ảnh chuyển khoản
// thì có thư báo; chuông Dashboard đếm đơn có ảnh chờ kiểm.

let s: Services;
let app: INestApplication;
let alerts: StaffAlertsService;
const mailer = new CapturingMailSender();
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let other: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let owner: string;
let accountant: string;
let otherOwner: string;
let phoneSeq = 100;

const OWNER_PW = 'owner-password-1';
const JPEG = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, n)]);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const http = () => request(app.getHttpServer());
const settingsUrl = () => `/api/v1/admin/operators/${seed.op.id}/alert-settings`;
const config = (over: Record<string, unknown> = {}) => ({
  password: OWNER_PW, enabled: true, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpUser: 'nhaxe@gmail.com',
  smtpPassword: 'abcd efgh ijkl mnop', fromName: 'Nhà xe PN', recipients: ['dieuhanh@nhaxe.vn'], onBookingHeld: false,
  onPaymentProof: true, ...over,
});
const save = (over: Record<string, unknown> = {}, token = owner) => http().put(settingsUrl()).set(bearer(token)).send(config(over));

async function hold(tripId = seed.limoTrip.id, seat = 'A1') {
  const res = await s.bookings.createHold(
    { tripId, contactName: 'Khách Báo', contactPhone: `09137${String(phoneSeq++).padStart(5, '0')}`, items: [{ seatCode: seat }] },
    newKey(),
  );
  const { rows } = await s.db.query<{ id: string }>('SELECT id FROM bookings WHERE code = $1', [res.booking.code]);
  return { code: res.booking.code, token: res.accessToken, id: rows[0]!.id };
}
const submit = (code: string, token: string, n: number) =>
  http().post(`/api/v1/bookings/${code}/payment-proofs`).set('Content-Type', 'image/jpeg').set('X-Booking-Token', token).send(JPEG(n));
const staffEvents = async () =>
  (await s.db.query<{ type: string; aggregate_id: string; processed_at: Date | null; attempts: number; last_error: string | null }>(
    `SELECT type, aggregate_id, processed_at, attempts, last_error FROM outbox_events WHERE type LIKE 'staff.%' ORDER BY id`,
  )).rows;

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  seed = await seedOperatorWithTrips(s, 'PN');
  other = await seedOperatorWithTrips(s, 'AB');
  const users = new UsersService(s.db, s.clock);
  await users.createStaff(seed.op.id, { fullName: 'Chủ', role: 'OWNER', phone: '0907200001', password: OWNER_PW });
  await users.createStaff(seed.op.id, { fullName: 'Kế toán', role: 'ACCOUNTANT', phone: '0907200002', password: 'acct-password-1' });
  await users.createStaff(other.op.id, { fullName: 'Chủ khác', role: 'OWNER', phone: '0907200003', password: 'other-password-1' });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({
      databaseUrl: TEST_DB_URL, bookingTokenSecret: TOKEN_SECRET, authTokenSecret: AUTH_SECRET, abuse: RELAXED_ABUSE, clock: s.clock,
      authRequireMfa: false, mailSender: mailer, dashboardUrl: 'https://dash.test.vn',
    })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  alerts = app.get(StaffAlertsService);
  const login = async (phone: string, password: string) =>
    (await http().post('/api/v1/auth/login').send({ phone, password }).expect(200)).body.accessToken as string;
  owner = await login('0907200001', OWNER_PW);
  accountant = await login('0907200002', 'acct-password-1');
  otherOwner = await login('0907200003', 'other-password-1');
});

afterAll(async () => {
  await app?.close();
  await s?.db.close();
});

beforeEach(async () => {
  s.clock.set(T0);
  mailer.sent.length = 0;
  mailer.failWith = null;
});

describe('settings', () => {
  it('before any setup: nothing is queued when customers book or send proofs', async () => {
    const r = await http().get(settingsUrl()).set(bearer(owner)).expect(200);
    expect(r.body).toMatchObject({ configured: false, enabled: false, smtpHost: 'smtp.gmail.com', passwordSet: false });
    const h = await hold(seed.limoTrip.id, 'A1');
    await submit(h.code, h.token, 1).expect(201);
    expect(await staffEvents()).toEqual([]);
  });

  it('only the owner can read or change it; the accountant and another operator get 403', async () => {
    await http().get(settingsUrl()).set(bearer(accountant)).expect(403);
    await save({}, accountant).expect(403);
    await http().get(settingsUrl()).set(bearer(otherOwner)).expect(404);
    await http().post(`${settingsUrl()}/test`).set(bearer(accountant)).expect(403);
  });

  it('saving needs the owner login password', async () => {
    await save({ password: 'wrong-password' }).expect(403);
    await http().put(settingsUrl()).set(bearer(owner)).send({ ...config(), password: undefined }).expect(400);
  });

  it('stores the SMTP password encrypted, never returns it, strips spaces of a Gmail app password and audits without it', async () => {
    const r = await save().expect(200);
    expect(r.body).toMatchObject({ configured: true, enabled: true, smtpUser: 'nhaxe@gmail.com', passwordSet: true, recipients: ['dieuhanh@nhaxe.vn'] });
    expect(JSON.stringify(r.body)).not.toMatch(/abcd|smtpPassword/);
    const { rows } = await s.db.query<{ smtp_password_enc: string }>('SELECT smtp_password_enc FROM operator_alert_settings WHERE operator_id = $1', [seed.op.id]);
    expect(rows[0]!.smtp_password_enc).toMatch(/^v1\./);
    expect(rows[0]!.smtp_password_enc).not.toContain('abcd');
    const audit = await s.db.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM audit_logs WHERE action = 'alert_settings.update' ORDER BY id DESC LIMIT 1`,
    );
    expect(audit.rows[0]!.data).toMatchObject({ smtpLoginChanged: true, recipients: 1 });
    expect(JSON.stringify(audit.rows[0]!.data)).not.toMatch(/abcd|owner-password/);
    await http().post(`${settingsUrl()}/test`).set(bearer(owner)).expect(201);
    expect(mailer.sent.at(-1)!.config).toMatchObject({ host: 'smtp.gmail.com', port: 465, password: 'abcdefghijklmnop', user: 'nhaxe@gmail.com' });
  });

  it('keeps the stored password when left blank for the same account, but asks again for a new account', async () => {
    await save({ smtpPassword: undefined, recipients: ['a@nhaxe.vn', 'b@nhaxe.vn'] }).expect(200);
    await http().post(`${settingsUrl()}/test`).set(bearer(owner)).expect(201);
    expect(mailer.sent.at(-1)!.config.password).toBe('abcdefghijklmnop');
    expect(mailer.sent.at(-1)!.message.to).toEqual(['a@nhaxe.vn', 'b@nhaxe.vn']);
    const r = await save({ smtpPassword: undefined, smtpUser: 'khac@gmail.com' }).expect(400);
    expect(r.body.error.details).toMatchObject({ field: 'smtpPassword' });
    await save({ smtpHost: '10.0.0.5' }).expect(400);
  });

  it('a failed test mail is reported to the owner (503) and shown as the last error', async () => {
    mailer.failWith = 'Máy chủ từ chối đăng nhập. Kiểm tra địa chỉ email và mật khẩu ứng dụng.';
    const r = await http().post(`${settingsUrl()}/test`).set(bearer(owner)).expect(503);
    expect(r.body.error.message).toMatch(/từ chối đăng nhập/);
    expect((await http().get(settingsUrl()).set(bearer(owner))).body).toMatchObject({ lastError: expect.stringMatching(/từ chối/) });
    mailer.failWith = null;
    await http().post(`${settingsUrl()}/test`).set(bearer(owner)).expect(201);
    expect((await http().get(settingsUrl()).set(bearer(owner))).body).toMatchObject({ lastError: null, lastSentAt: T0.toISOString() });
  });
});

describe('dispatch', () => {
  beforeEach(async () => {
    await s.db.query(`UPDATE outbox_events SET processed_at = now() WHERE processed_at IS NULL`);
    await save({ smtpPassword: 'abcdefghijklmnop', onBookingHeld: false, onPaymentProof: true, recipients: ['dieuhanh@nhaxe.vn'] }).expect(200);
  });

  it('a new transfer proof sends one mail with masked phone and a dashboard link; the duplicate image does not', async () => {
    const h = await hold(seed.limoTrip.id, 'B1');
    await submit(h.code, h.token, 2).expect(201);
    await submit(h.code, h.token, 2).expect(201); // cùng ảnh → trùng, không thêm sự kiện
    expect((await staffEvents()).filter((e) => !e.processed_at)).toHaveLength(1);
    expect(await alerts.dispatchDue()).toBe(1);
    const m = mailer.sent.at(-1)!.message;
    expect(m.to).toEqual(['dieuhanh@nhaxe.vn']);
    expect(m.subject).toBe(`[PN] Khách gửi ảnh chuyển khoản — vé ${h.code}`);
    expect(m.text).toMatch(/0913\*\*\*\d{3}/);
    expect(m.text).not.toMatch(/(0|\+84)913\d{6}/);
    expect(m.text).toContain(`https://dash.test.vn/admin/passengers?date=`);
    expect(m.text).toContain(`&booking=${h.code}`);
    expect(await alerts.dispatchDue()).toBe(0); // đã gửi thì không gửi lại
  });

  it('new bookings are mailed only when that option is on', async () => {
    await hold(seed.limoTrip.id, 'B2');
    expect((await staffEvents()).filter((e) => !e.processed_at)).toHaveLength(0);
    await save({ smtpPassword: undefined, onBookingHeld: true }).expect(200);
    const h = await hold(seed.limoTrip.id, 'B3');
    expect(await alerts.dispatchDue()).toBe(1);
    expect(mailer.sent.at(-1)!.message.subject).toMatch(new RegExp(`^\\[PN\\] Đơn mới ${h.code} — 1 chỗ`));
  });

  it('retries with back-off, then gives up after the last attempt and shows the error', async () => {
    const h = await hold(seed.limoTrip.id, 'B4');
    await submit(h.code, h.token, 3).expect(201);
    mailer.failWith = 'Không kết nối được máy chủ gửi mail. Kiểm tra tên máy chủ và cổng.';
    expect(await alerts.dispatchDue()).toBe(0);
    let [e] = (await staffEvents()).filter((x) => x.aggregate_id === h.id && !x.processed_at);
    expect(e).toMatchObject({ attempts: 1, last_error: expect.stringMatching(/Không kết nối/) });
    expect(await alerts.dispatchDue()).toBe(0); // chưa tới hạn thử lại
    expect((await staffEvents()).find((x) => x.aggregate_id === h.id)!.attempts).toBe(1);
    for (let i = 2; i <= ALERT_MAX_ATTEMPTS; i++) {
      s.clock.advanceMinutes(2 ** (i - 2) + 1);
      await alerts.dispatchDue();
    }
    [e] = (await staffEvents()).filter((x) => x.aggregate_id === h.id);
    expect(e).toMatchObject({ attempts: ALERT_MAX_ATTEMPTS, processed_at: expect.any(Date) });
    expect((await http().get(settingsUrl()).set(bearer(owner))).body.lastError).toMatch(/Không kết nối/);
    expect(mailer.sent).toHaveLength(0);
  });

  it('a recovered mailer sends on the next attempt', async () => {
    const h = await hold(seed.limoTrip.id, 'B5');
    await submit(h.code, h.token, 4).expect(201);
    mailer.failWith = 'x';
    await alerts.dispatchDue();
    mailer.failWith = null;
    s.clock.advanceMinutes(2);
    expect(await alerts.dispatchDue()).toBe(1);
  });

  it('skips events queued before the alerts were switched off, and stale ones after a long outage', async () => {
    const a = await hold(seed.limoTrip.id, 'B6');
    await submit(a.code, a.token, 5).expect(201);
    await save({ smtpPassword: undefined, enabled: false }).expect(200);
    expect(await alerts.dispatchDue()).toBe(0);
    expect((await staffEvents()).find((x) => x.aggregate_id === a.id)).toMatchObject({ processed_at: expect.any(Date), last_error: 'Đã tắt báo email.' });

    await save({ smtpPassword: undefined, enabled: true }).expect(200);
    const b = await hold(seed.limoTrip.id, 'B7');
    await submit(b.code, b.token, 6).expect(201);
    s.clock.set(new Date(T0.getTime() + ALERT_STALE_MS + 60_000));
    expect(await alerts.dispatchDue()).toBe(0);
    expect((await staffEvents()).find((x) => x.aggregate_id === b.id)!.last_error).toMatch(/quá cũ/);
    expect(mailer.sent).toHaveLength(0);
  });

  it('never touches other outbox events (customer notifications waiting for T7)', async () => {
    const h = await hold(seed.limoTrip.id, 'B8');
    await s.db.query(
      `INSERT INTO outbox_events (operator_id, type, aggregate_id, dedupe_key) VALUES ($1, 'booking.confirmed', $2, $3)`,
      [seed.op.id, h.id, `booking.confirmed:${h.id}`],
    );
    await alerts.dispatchDue();
    const { rows } = await s.db.query(`SELECT processed_at, attempts FROM outbox_events WHERE dedupe_key = $1`, [`booking.confirmed:${h.id}`]);
    expect(rows[0]).toEqual({ processed_at: null, attempts: 0 });
  });

  it('two workers claiming at once send each mail once', async () => {
    const h = await hold(seed.limoTrip.id, 'B9');
    await submit(h.code, h.token, 7).expect(201);
    const [x, y] = await Promise.all([alerts.dispatchDue(), alerts.dispatchDue()]);
    expect(x + y).toBe(1);
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('pending proofs (bell)', () => {
  it('counts and lists bookings on hold with a transfer claim, scoped to the operator, newest first', async () => {
    await s.db.query(`UPDATE bookings SET status = 'CANCELLED' WHERE status = 'HOLDING'`);
    const a = await hold(seed.limoTrip.id, 'B10');
    const b = await hold(seed.limoTrip.id, 'B11');
    const c = await hold(seed.limoTrip.id, 'B12'); // không gửi ảnh
    await submit(a.code, a.token, 8).expect(201);
    s.clock.advanceMinutes(1);
    await submit(b.code, b.token, 9).expect(201);
    const o = await hold(other.limoTrip.id, 'A1');
    await submit(o.code, o.token, 10).expect(201);

    const counters = await http().get(`/api/v1/admin/operators/${seed.op.id}/counters`).set(bearer(accountant)).expect(200);
    expect(counters.body.proofsPending).toBe(2);
    const r = await http().get(`/api/v1/admin/operators/${seed.op.id}/pending-payment-proofs`).set(bearer(accountant)).expect(200);
    expect(r.body.total).toBe(2);
    expect(r.body.bookings.map((x: { code: string }) => x.code)).toEqual([b.code, a.code]);
    expect(r.body.bookings[0]).toMatchObject({ proofCount: 1, paidAmount: 0, trip: { id: seed.limoTrip.id }, contactName: 'Khách Báo' });
    expect(r.body.bookings.map((x: { code: string }) => x.code)).not.toContain(c.code);

    await s.db.query(`UPDATE bookings SET status = 'CONFIRMED' WHERE code = $1`, [b.code]); // đã ghi nhận tiền
    expect((await http().get(`/api/v1/admin/operators/${seed.op.id}/counters`).set(bearer(accountant))).body.proofsPending).toBe(1);
    s.clock.advanceMinutes(3 * 60); // quá hạn giữ chỗ (gia hạn tối đa 2 giờ) → không còn chờ kiểm
    expect((await http().get(`/api/v1/admin/operators/${seed.op.id}/pending-payment-proofs`).set(bearer(accountant))).body.total).toBe(0);
    await http().get(`/api/v1/admin/operators/${seed.op.id}/pending-payment-proofs`).set(bearer(otherOwner)).expect(404);
  });

  it('keeps proof notices after the booking is confirmed or expires, with the current state (F80)', async () => {
    await s.db.query(`UPDATE bookings SET status = 'CANCELLED' WHERE status = 'HOLDING'`);
    await s.db.query(`DELETE FROM booking_payment_proofs`);
    const free = (await s.db.query<{ seat_code: string }>(
      `SELECT seat_code FROM trip_seats WHERE trip_id = $1 AND sellable AND booking_id IS NULL ORDER BY seat_code LIMIT 2`,
      [seed.limoTrip.id],
    )).rows.map((r) => r.seat_code);
    const a = await hold(seed.limoTrip.id, free[0]);
    const b = await hold(seed.limoTrip.id, free[1]);
    await submit(a.code, a.token, 11).expect(201);
    s.clock.advanceMinutes(1);
    await submit(b.code, b.token, 12).expect(201);
    const o = await hold(other.limoTrip.id, 'B1');
    await submit(o.code, o.token, 13).expect(201);
    const url = `/api/v1/admin/operators/${seed.op.id}/payment-proof-notices`;

    let r = await http().get(url).set(bearer(accountant)).expect(200);
    expect(r.body.items.map((x: { code: string }) => x.code)).toEqual([b.code, a.code]);
    expect(r.body.items[0]).toMatchObject({ id: `proof:${b.code}:1`, proofCount: 1, state: 'PENDING', trip: { id: seed.limoTrip.id } });

    await s.db.query(`UPDATE bookings SET status = 'CONFIRMED' WHERE code = $1`, [b.code]); // đã ghi nhận tiền
    s.clock.advanceMinutes(1);
    await submit(a.code, a.token, 14).expect(201); // gửi thêm ảnh → thông báo mới
    r = await http().get(url).set(bearer(accountant)).expect(200);
    expect(r.body.items.map((x: { code: string; state: string; id: string }) => [x.code, x.state, x.id])).toEqual([
      [a.code, 'PENDING', `proof:${a.code}:2`],
      [b.code, 'CONFIRMED', `proof:${b.code}:1`],
    ]);

    s.clock.advanceMinutes(3 * 60); // quá hạn giữ chỗ
    r = await http().get(url).set(bearer(accountant)).expect(200);
    expect(r.body.items.find((x: { code: string }) => x.code === a.code).state).toBe('EXPIRED');

    await s.db.query(`UPDATE booking_payment_proofs SET created_at = created_at - interval '8 days'`); // ảnh cũ hơn 7 ngày → rời lịch sử
    expect((await http().get(url).set(bearer(accountant)).expect(200)).body.items).toEqual([]);
    await http().get(url).set(bearer(otherOwner)).expect(404);
  });
});
