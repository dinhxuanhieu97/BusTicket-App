/**
 * Tiền về muộn — nhân viên cấp lại chỗ (chốt 17/11/2026): đúng chỗ cũ nếu còn trống, ngược lại đổi sang chỗ khác
 * cùng chuyến hoặc chuyến khác; giá theo chỗ mới; tiền dư giữ lại ở hàng chờ (OVERPAID) để hoàn.
 */
import type { AuthUser } from '../src/auth/auth.service';
import { UsersService } from '../src/auth/users.service';
import { buildServices, errorCode, newKey, resetDatabase, seedOperatorWithTrips, Services, T0 } from './helpers';

let s: Services;
let seed: Awaited<ReturnType<typeof seedOperatorWithTrips>>;
let owner: AuthUser;
let otherOwner: AuthUser;
let otherOpId: string;
let phoneSeq = 100;
const freshPhone = () => `09126${String(phoneSeq++).padStart(5, '0')}`;

async function staff(operatorId: string, role: 'OWNER' | 'ACCOUNTANT'): Promise<AuthUser> {
  const u = await new UsersService(s.db, s.clock).createStaff(operatorId, {
    fullName: role, phone: freshPhone(), password: 'staff-password-1', role,
  });
  return { id: u.id, operatorId, role, fullName: role, phone: u.phone, mfaEnabled: true, scope: 'full' };
}

const hold = (seatCode: string, tripId = seed.bedTrip.id) =>
  s.bookings.createHold({ tripId, contactName: 'Khách', contactPhone: freshPhone(), items: [{ seatCode }] }, newKey());

/** Giường tầng 1 (số lẻ) 380.000đ, tầng 2 (số chẵn) 350.000đ. Đơn giữ chỗ hết hạn rồi khách mới chuyển tiền: khoản thu LATE (nhà xe đã tắt tự xác nhận lại). */
async function latePayment(seatCode: string, amount = 380_000) {
  const h = await hold(seatCode);
  s.clock.advanceMinutes(14);
  await s.bookings.expireDueHolds();
  const p = await s.payments.recordManual(owner, seed.op.id, { bookingCode: h.booking.code, amount, method: 'CASH' }, newKey());
  expect(p.review).toMatchObject({ status: 'NEEDS_REVIEW', reason: 'LATE' });
  return { code: h.booking.code, paymentId: p.id };
}

async function bookingRow(code: string) {
  const { rows } = await s.db.query<{
    id: string; status: string; trip_id: string; total_amount: number; deposit_amount: number; paid_amount: number;
    payment_status: string; hold_expires_at: Date | null;
  }>('SELECT id, status, trip_id, total_amount, deposit_amount, paid_amount, payment_status, hold_expires_at FROM bookings WHERE code = $1', [code]);
  return rows[0]!;
}

async function paymentRow(id: string) {
  const { rows } = await s.db.query<{ allocated_amount: number; review_status: string; review_reason: string | null }>(
    'SELECT allocated_amount, review_status, review_reason FROM payments WHERE id = $1', [id],
  );
  return rows[0]!;
}

async function seatHolder(tripId: string, seatCode: string) {
  const { rows } = await s.db.query<{ code: string | null }>(
    'SELECT b.code FROM trip_seats ts LEFT JOIN bookings b ON b.id = ts.booking_id WHERE ts.trip_id = $1 AND ts.seat_code = $2',
    [tripId, seatCode],
  );
  return rows[0]!.code;
}

beforeAll(async () => {
  await resetDatabase();
  s = buildServices();
  s.clock.set(T0);
  seed = await seedOperatorWithTrips(s, 'PN');
  owner = await staff(seed.op.id, 'OWNER');
  const policy = await s.operators.currentPolicy(seed.op.id);
  const { operatorId: _o, version: _v, ...input } = policy;
  await s.operators.updatePolicy(seed.op.id, { ...input, autoReinstateLatePayment: false });
  otherOpId = (await s.operators.create({ code: 'AB', name: 'Nhà xe AB' })).id;
  otherOwner = await staff(otherOpId, 'OWNER');
});
afterAll(() => s.db.close());
beforeEach(() => s.clock.set(T0));

describe('manual reinstate of a late payment', () => {
  it('re-books the same seat when it is still free and resolves the payment', async () => {
    const { code, paymentId } = await latePayment('A1');
    expect(await seatHolder(seed.bedTrip.id, 'A1')).toBeNull();
    expect(await s.payments.reinstateContext(seed.op.id, paymentId)).toMatchObject({
      eligible: true, unallocatedAmount: 380_000,
      booking: { code, status: 'EXPIRED', previousTotal: 380_000, paidAmount: 0 },
      legs: [{ tripId: seed.bedTrip.id, departed: false, seats: [{ seatCode: 'A1', occupancy: 1, available: true }] }],
    });
    expect(await errorCode(s.payments.reinstateContext(otherOpId, paymentId))).toBe('NOT_FOUND');

    const r = await s.payments.reinstateLate(owner, seed.op.id, paymentId, {
      legs: [{ tripId: seed.bedTrip.id, items: [{ seatCode: 'A1' }] }],
    });
    expect(r.booking).toMatchObject({ code, status: 'CONFIRMED', paymentStatus: 'PAID', totalAmount: 380_000, paidAmount: 380_000 });
    expect(r.payment).toMatchObject({ allocatedAmount: 380_000, review: { status: 'RESOLVED' } });
    expect(await seatHolder(seed.bedTrip.id, 'A1')).toBe(code);
    const { rows } = await s.db.query(
      "SELECT actor_user_id, data FROM audit_logs WHERE action = 'booking.reinstate' AND data->>'bookingCode' = $1", [code],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: owner.id,
      data: { manual: true, previousStatus: 'EXPIRED', seats: [{ tripId: seed.bedTrip.id, seatCode: 'A1' }] },
    });
  });

  it('moves to a cheaper seat on the same trip and keeps the difference in the review queue as OVERPAID', async () => {
    const { code, paymentId } = await latePayment('B1');
    const resold = await hold('B1');
    expect((await s.payments.reinstateContext(seed.op.id, paymentId)).legs[0]!.seats[0]).toMatchObject({ seatCode: 'B1', available: false });
    expect(await errorCode(s.payments.reinstateLate(owner, seed.op.id, paymentId, {
      legs: [{ tripId: seed.bedTrip.id, items: [{ seatCode: 'B1' }] }],
    }))).toBe('SEAT_UNAVAILABLE');
    expect(await paymentRow(paymentId)).toMatchObject({ allocated_amount: 0, review_reason: 'LATE' });
    expect(await seatHolder(seed.bedTrip.id, 'B1')).toBe(resold.booking.code);

    const r = await s.payments.reinstateLate(owner, seed.op.id, paymentId, {
      legs: [{ tripId: seed.bedTrip.id, items: [{ seatCode: 'C2' }] }], note: 'Khách đồng ý tầng trên',
    });
    expect(r.booking).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', totalAmount: 350_000, paidAmount: 350_000 });
    expect(await paymentRow(paymentId)).toMatchObject({ allocated_amount: 350_000, review_status: 'NEEDS_REVIEW', review_reason: 'OVERPAID' });
    expect(await seatHolder(seed.bedTrip.id, 'C2')).toBe(code);
    expect(await seatHolder(seed.bedTrip.id, 'B1')).toBe(resold.booking.code);
    const { rows: items } = await s.db.query(
      'SELECT seat_code, unit_price FROM booking_items i JOIN bookings b ON b.id = i.booking_id WHERE b.code = $1', [code],
    );
    expect(items).toEqual([{ seat_code: 'C2', unit_price: 350_000 }]);
  });

  it('moves to another trip; below the new deposit the seats are held again for the customer to top up', async () => {
    const { code, paymentId } = await latePayment('B3');
    const r = await s.payments.reinstateLate(owner, seed.op.id, paymentId, {
      legs: [{ tripId: seed.limoTrip.id, items: [{ seatCode: 'A1' }] }],
    });
    // Limousine tầng 1 giá 450.000đ, cọc 100% → còn thiếu 70.000đ.
    expect(r.booking).toMatchObject({ status: 'HOLDING', paymentStatus: 'PARTIAL', totalAmount: 450_000, paidAmount: 380_000 });
    expect(r.booking.holdExpiresAt).not.toBeNull();
    const b = await bookingRow(code);
    expect(b).toMatchObject({ trip_id: seed.limoTrip.id, status: 'HOLDING', deposit_amount: 450_000 });
    // Tiền đã phân bổ nhưng vé chưa xác nhận → khoản thu vẫn ở hàng chờ; khách được báo hạn mới.
    expect(await paymentRow(paymentId)).toMatchObject({ allocated_amount: 380_000, review_status: 'NEEDS_REVIEW', review_reason: 'LATE' });
    const { rows: events } = await s.db.query(
      "SELECT payload FROM outbox_events WHERE type = 'booking.reinstated_hold' AND payload->>'bookingCode' = $1", [code],
    );
    expect(events).toEqual([{ payload: expect.objectContaining({ amountDue: 70_000, totalAmount: 450_000 }) }]);
    expect(await seatHolder(seed.limoTrip.id, 'A1')).toBe(code);
    expect(await seatHolder(seed.bedTrip.id, 'B3')).toBeNull();

    // Khách chuyển thêm phần thiếu trong hạn mới → vé được xác nhận.
    s.clock.advanceMinutes(5);
    await s.payments.recordManual(owner, seed.op.id, { bookingCode: code, amount: 70_000, method: 'CASH' }, newKey());
    expect(await bookingRow(code)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID', paid_amount: 450_000 });
  });

  it('accepts a hold that is past its release time but not yet swept by the background job', async () => {
    const h = await hold('B9');
    s.clock.advanceMinutes(14); // không chạy expireDueHolds: đơn vẫn HOLDING trong DB
    const p = await s.payments.recordManual(owner, seed.op.id, { bookingCode: h.booking.code, amount: 380_000, method: 'CASH' }, newKey());
    expect(p.review).toMatchObject({ reason: 'LATE' });
    expect((await bookingRow(h.booking.code)).status).toBe('HOLDING');
    const r = await s.payments.reinstateLate(owner, seed.op.id, p.id, { legs: [{ tripId: seed.bedTrip.id, items: [{ seatCode: 'B9' }] }] });
    expect(r.booking).toMatchObject({ status: 'CONFIRMED', paidAmount: 380_000 });
    expect(await seatHolder(seed.bedTrip.id, 'B9')).toBe(h.booking.code);
  });

  it('refuses when the booking already holds more money than the new seats cost', async () => {
    const h = await hold('C1');
    await s.payments.recordManual(owner, seed.op.id, { bookingCode: h.booking.code, amount: 100_000, method: 'CASH' }, newKey());
    s.clock.advanceMinutes(14);
    await s.bookings.expireDueHolds();
    const late = await s.payments.recordManual(owner, seed.op.id, { bookingCode: h.booking.code, amount: 380_000, method: 'CASH' }, newKey());
    // Không có chỗ nào rẻ hơn 100.000đ nên dựng tình huống bằng cách hạ giá tầng 2 của chuyến xuống 50.000đ.
    await s.db.query("UPDATE trip_fares SET price = 50000 WHERE trip_id = $1 AND floor = '2'", [seed.bedTrip.id]);
    try {
      expect(await errorCode(s.payments.reinstateLate(owner, seed.op.id, late.id, {
        legs: [{ tripId: seed.bedTrip.id, items: [{ seatCode: 'C10' }] }],
      }))).toBe('CONFLICT');
    } finally {
      await s.db.query("UPDATE trip_fares SET price = 350000 WHERE trip_id = $1 AND floor = '2'", [seed.bedTrip.id]);
    }
    expect(await paymentRow(late.id)).toMatchObject({ allocated_amount: 0, review_reason: 'LATE' });
  });

  it('refuses a second reinstate of the same payment (double click)', async () => {
    const { paymentId } = await latePayment('C4', 350_000);
    const body = { legs: [{ tripId: seed.bedTrip.id, items: [{ seatCode: 'C4' }] }] };
    await s.payments.reinstateLate(owner, seed.op.id, paymentId, body);
    expect(await errorCode(s.payments.reinstateLate(owner, seed.op.id, paymentId, body))).toBe('CONFLICT');
  });

  it('refuses payments that are not LATE, other operators, departed trips and unknown seats without changing anything', async () => {
    const h = await hold('C6');
    const onTime = await s.payments.recordManual(owner, seed.op.id, { bookingCode: h.booking.code, amount: 350_000, method: 'CASH' }, newKey());
    const legs = [{ tripId: seed.bedTrip.id, items: [{ seatCode: 'C8' }] }];
    expect(await errorCode(s.payments.reinstateLate(owner, seed.op.id, onTime.id, { legs }))).toBe('CONFLICT');

    const { code, paymentId } = await latePayment('B5');
    expect(await errorCode(s.payments.reinstateLate(otherOwner, otherOpId, paymentId, { legs }))).toBe('NOT_FOUND');
    expect(await errorCode(s.payments.reinstateLate(owner, seed.op.id, paymentId, {
      legs: [{ tripId: seed.bedTrip.id, items: [{ seatCode: 'Z99' }] }],
    }))).toBe('VALIDATION_FAILED');
    expect(await errorCode(s.payments.reinstateLate(owner, seed.op.id, paymentId, {
      legs: [{ tripId: seed.bedTrip.id, items: [{ seatCode: 'B5' }, { seatCode: 'B5' }] }],
    }))).toBe('VALIDATION_FAILED');

    s.clock.set(new Date(seed.bedTrip.depart_at));
    expect(await errorCode(s.payments.reinstateLate(owner, seed.op.id, paymentId, { legs }))).toBe('TRIP_NOT_ON_SALE');

    expect(await paymentRow(paymentId)).toMatchObject({ allocated_amount: 0, review_status: 'NEEDS_REVIEW', review_reason: 'LATE' });
    expect(await bookingRow(code)).toMatchObject({ status: 'EXPIRED', paid_amount: 0 });
  });

  it('a reinstate racing a new hold on the same seat never gives the seat to both', async () => {
    const { code, paymentId } = await latePayment('B7');
    const [reinstate, competing] = await Promise.all([
      s.payments.reinstateLate(owner, seed.op.id, paymentId, { legs: [{ tripId: seed.bedTrip.id, items: [{ seatCode: 'B7' }] }] })
        .then(() => 'OK', (e) => e.code),
      hold('B7').then(() => 'OK', (e) => e.code),
    ]);
    expect([reinstate, competing].sort()).toEqual(['OK', 'SEAT_UNAVAILABLE']);
    const holder = await seatHolder(seed.bedTrip.id, 'B7');
    if (reinstate === 'OK') expect(holder).toBe(code);
    else {
      expect(holder).not.toBe(code);
      expect(await paymentRow(paymentId)).toMatchObject({ review_reason: 'LATE', allocated_amount: 0 });
    }
  });
});
