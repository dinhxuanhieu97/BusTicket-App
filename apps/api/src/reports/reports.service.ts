import { Injectable } from '@nestjs/common';
import { can, Role } from '../auth/permissions';
import { Clock } from '../common/clock';
import { isUuid } from '../common/ids';
import { Db } from '../db/db';
import { likeEscape, reportRange, searchTerms, vnDates } from './report-query';

const VN_DAY = `to_char(%s AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`;
const vnDay = (col: string) => VN_DAY.replace('%s', col);

/**
 * Chia tiền mỗi đơn (`money`: booking_id, amount) về tuyến của từng chặng theo tỉ lệ `line_total` của các dòng đơn
 * (đơn khứ hồi có chặng về trên tuyến ngược chiều). Đơn không có dòng tính tiền thì quy về chuyến chính của đơn.
 * Làm tròn từng tuyến nên tổng theo tuyến có thể lệch vài đồng so với tổng đã phân bổ.
 */
const ROUTE_SHARE_SQL = `,
  legs AS (
    SELECT m.booking_id, m.amount, bi.trip_id, SUM(bi.line_total)::numeric AS leg_total,
      SUM(SUM(bi.line_total)) OVER (PARTITION BY m.booking_id)::numeric AS booking_total
    FROM money m
    JOIN bookings b ON b.id = m.booking_id AND b.operator_id = $1
    JOIN booking_items bi ON bi.booking_id = b.id
    GROUP BY m.booking_id, m.amount, bi.trip_id
    UNION ALL
    SELECT m.booking_id, m.amount, b.trip_id, 1, 1
    FROM money m JOIN bookings b ON b.id = m.booking_id AND b.operator_id = $1
    WHERE NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id)
  ),
  shares AS (
    SELECT booking_id, trip_id,
      CASE WHEN booking_total > 0 THEN amount * leg_total / booking_total
           ELSE amount / COUNT(*) OVER (PARTITION BY booking_id) END AS amount
    FROM legs
  )
  SELECT ro.id, ro.code, ro.origin, ro.destination, ROUND(SUM(sh.amount))::bigint AS amount,
    COUNT(DISTINCT sh.booking_id)::int AS bookings
  FROM shares sh
  JOIN trips t ON t.id = sh.trip_id AND t.operator_id = $1
  JOIN routes ro ON ro.id = t.route_id
  GROUP BY ro.id ORDER BY amount DESC, ro.code`;

/** Chuyến "sắp đóng bán": đang mở và giờ đóng bán trong 2 giờ tới. */
export const CLOSING_SOON_MS = 2 * 60 * 60 * 1000;
const SEARCH_LIMIT = 8;

/**
 * Số liệu tổng hợp cho dashboard. Mọi truy vấn lọc theo `operator_id` của route (AuthGuard đã kiểm người gọi
 * thuộc nhà xe đó). Tiền là số nguyên VND; ngày báo cáo theo giờ Việt Nam.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /**
   * Doanh thu trong kỳ. `received` = tổng khoản thu có `received_at` trong kỳ (mọi phương thức, kể cả khoản chưa
   * khớp đơn); `refunded` = khoản cần hoàn đã chuyển xong (`REFUNDED`) có `resolved_at` trong kỳ; `net` = hiệu.
   * Theo tuyến: phần đã phân bổ vào đơn, chia theo chặng (`ROUTE_SHARE_SQL`); phần chưa gắn đơn ghi riêng. Phân bổ làm
   * sau vẫn tính cho kỳ của khoản thu, nên `unallocated` của kỳ cũ có thể giảm dần.
   */
  async revenue(operatorId: string, input: unknown) {
    const r = reportRange(input);
    const dates = vnDates(r.from, r.days);
    const empty = { received: 0, refunded: 0, net: 0, payments: 0, refunds: 0 };
    if (!isUuid(operatorId)) {
      return { from: r.from, to: r.to, totals: empty, byDay: dates.map((date) => ({ date, ...empty })), byMethod: [], byHour: [], byRoute: [], unallocated: 0 };
    }
    const args = [operatorId, r.start, r.end];
    const [days, methods, hours, refunds, routes, routeRefunds, allocatedSum] = await Promise.all([
      this.db.query<{ date: string; amount: number; count: number }>(
        `SELECT ${vnDay('received_at')} AS date, SUM(amount)::bigint AS amount, COUNT(*)::int AS count
         FROM payments WHERE operator_id = $1 AND received_at >= $2 AND received_at < $3 GROUP BY 1`,
        args,
      ),
      this.db.query<{ method: string; amount: number; count: number }>(
        `SELECT method, SUM(amount)::bigint AS amount, COUNT(*)::int AS count
         FROM payments WHERE operator_id = $1 AND received_at >= $2 AND received_at < $3 GROUP BY 1 ORDER BY 2 DESC`,
        args,
      ),
      this.db.query<{ hour: number; amount: number; count: number }>(
        `SELECT EXTRACT(HOUR FROM received_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS hour,
           SUM(amount)::bigint AS amount, COUNT(*)::int AS count
         FROM payments WHERE operator_id = $1 AND received_at >= $2 AND received_at < $3 GROUP BY 1 ORDER BY 1`,
        args,
      ),
      this.db.query<{ date: string; amount: number; count: number }>(
        `SELECT ${vnDay('resolved_at')} AS date, SUM(amount)::bigint AS amount, COUNT(*)::int AS count
         FROM refund_obligations WHERE operator_id = $1 AND status = 'REFUNDED' AND resolved_at >= $2 AND resolved_at < $3
         GROUP BY 1`,
        args,
      ),
      this.db.query<{ id: string; code: string; origin: string; destination: string; amount: number; bookings: number }>(
        `WITH money AS (
           SELECT pa.booking_id, SUM(pa.amount)::numeric AS amount
           FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
           WHERE p.operator_id = $1 AND p.received_at >= $2 AND p.received_at < $3
           GROUP BY pa.booking_id
         )
         ${ROUTE_SHARE_SQL}`,
        args,
      ),
      this.db.query<{ id: string; code: string; origin: string; destination: string; amount: number; bookings: number }>(
        `WITH money AS (
           SELECT booking_id, amount::numeric AS amount FROM refund_obligations
           WHERE operator_id = $1 AND status = 'REFUNDED' AND resolved_at >= $2 AND resolved_at < $3
         )
         ${ROUTE_SHARE_SQL}`,
        args,
      ),
      this.db.query<{ amount: number }>(
        `SELECT COALESCE(SUM(pa.amount), 0)::bigint AS amount
         FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
         WHERE p.operator_id = $1 AND p.received_at >= $2 AND p.received_at < $3`,
        args,
      ),
    ]);
    const dayIn = new Map(days.rows.map((d) => [d.date, d]));
    const dayOut = new Map(refunds.rows.map((d) => [d.date, d]));
    const byDay = dates.map((date) => {
      const inn = dayIn.get(date);
      const out = dayOut.get(date);
      const received = inn?.amount ?? 0;
      const refunded = out?.amount ?? 0;
      return { date, received, refunded, net: received - refunded, payments: inn?.count ?? 0, refunds: out?.count ?? 0 };
    });
    const totals = byDay.reduce(
      (t, d) => ({
        received: t.received + d.received, refunded: t.refunded + d.refunded, net: t.net + d.net,
        payments: t.payments + d.payments, refunds: t.refunds + d.refunds,
      }),
      empty,
    );
    const routeMap = new Map<string, { code: string; origin: string; destination: string; received: number; refunded: number; bookings: number }>();
    for (const x of routes.rows) routeMap.set(x.id, { code: x.code, origin: x.origin, destination: x.destination, received: x.amount, refunded: 0, bookings: x.bookings });
    for (const x of routeRefunds.rows) {
      const row = routeMap.get(x.id) ?? { code: x.code, origin: x.origin, destination: x.destination, received: 0, refunded: 0, bookings: 0 };
      row.refunded = x.amount;
      routeMap.set(x.id, row);
    }
    const allocated = allocatedSum.rows[0]!.amount;
    const byRoute = [...routeMap.values()]
      .map((x) => ({ ...x, net: x.received - x.refunded }))
      .sort((a, b) => b.net - a.net || a.code.localeCompare(b.code));
    return {
      from: r.from, to: r.to, totals, byDay,
      byMethod: methods.rows,
      byHour: hours.rows,
      byRoute,
      unallocated: totals.received - allocated,
    };
  }

  /**
   * Đơn theo ngày tạo (giờ VN). `bookings` = đơn đã xác nhận/đã đi + đơn nhân viên hủy; `cancelled` = đơn nhân viên
   * hủy (`cancelled_at`); `abandoned` = giữ chỗ hết hạn (kể cả chưa được quét) hoặc khách tự bỏ khi chưa trả tiền
   * (không tính vào tỷ lệ hủy); `seats` = số chỗ (mỗi chặng một chỗ, đơn khứ hồi tính 2) của đơn đã xác nhận/đã đi.
   */
  async bookings(operatorId: string, input: unknown) {
    const r = reportRange(input);
    const dates = vnDates(r.from, r.days);
    const zero = { bookings: 0, cancelled: 0, abandoned: 0, holding: 0, seats: 0 };
    const rows = isUuid(operatorId)
      ? (
          await this.db.query<{ date: string } & typeof zero>(
            `SELECT ${vnDay('b.created_at')} AS date,
               COUNT(*) FILTER (WHERE b.status IN ('CONFIRMED', 'COMPLETED') OR (b.status = 'CANCELLED' AND b.cancelled_at IS NOT NULL))::int AS bookings,
               COUNT(*) FILTER (WHERE b.status = 'CANCELLED' AND b.cancelled_at IS NOT NULL)::int AS cancelled,
               COUNT(*) FILTER (WHERE b.status = 'EXPIRED' OR (b.status = 'CANCELLED' AND b.cancelled_at IS NULL)
                 OR (b.status = 'HOLDING' AND COALESCE(b.release_at, b.hold_expires_at) <= $4))::int AS abandoned,
               COUNT(*) FILTER (WHERE b.status = 'HOLDING' AND COALESCE(b.release_at, b.hold_expires_at) > $4)::int AS holding,
               COALESCE(SUM((SELECT COUNT(*) FROM booking_items bi WHERE bi.booking_id = b.id))
                 FILTER (WHERE b.status IN ('CONFIRMED', 'COMPLETED')), 0)::int AS seats
             FROM bookings b WHERE b.operator_id = $1 AND b.created_at >= $2 AND b.created_at < $3 GROUP BY 1`,
            [operatorId, r.start, r.end, this.clock.now()],
          )
        ).rows
      : [];
    const map = new Map(rows.map((x) => [x.date, x]));
    const byDay = dates.map((date) => {
      const { date: _d, ...v } = map.get(date) ?? { date, ...zero };
      return { date, ...v };
    });
    const totals = byDay.reduce(
      (t, d) => ({
        bookings: t.bookings + d.bookings, cancelled: t.cancelled + d.cancelled, abandoned: t.abandoned + d.abandoned,
        holding: t.holding + d.holding, seats: t.seats + d.seats,
      }),
      zero,
    );
    return { from: r.from, to: r.to, totals: { ...totals, cancelRate: rate(totals.cancelled, totals.bookings) }, byDay };
  }

  /**
   * Số đếm cho chuông thông báo và tab Sổ thu. Nhóm tiền chỉ trả khi vai trò có `payment.read`, ngược lại `null`.
   */
  async counters(operatorId: string, role: Role) {
    const now = this.clock.now();
    if (!isUuid(operatorId)) return { tripsClosingSoon: 0, payments: null, refundsOpen: null };
    const { rows: trips } = await this.db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM trips
       WHERE operator_id = $1 AND status = 'OPEN' AND sales_close_at > $2 AND sales_close_at <= $3`,
      [operatorId, now, new Date(now.getTime() + CLOSING_SOON_MS)],
    );
    if (!can(role, 'payment.read')) return { tripsClosingSoon: trips[0]!.n, payments: null, refundsOpen: null };
    const [pay, ref] = await Promise.all([
      this.db.query<{ none: number; needs_review: number; resolved: number }>(
        `SELECT COUNT(*) FILTER (WHERE review_status = 'NONE')::int AS none,
           COUNT(*) FILTER (WHERE review_status = 'NEEDS_REVIEW')::int AS needs_review,
           COUNT(*) FILTER (WHERE review_status = 'RESOLVED')::int AS resolved
         FROM payments WHERE operator_id = $1`,
        [operatorId],
      ),
      this.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM refund_obligations WHERE operator_id = $1 AND status = 'OPEN'`, [operatorId]),
    ]);
    const p = pay.rows[0]!;
    return {
      tripsClosingSoon: trips[0]!.n,
      payments: { total: p.none + p.needs_review + p.resolved, NONE: p.none, NEEDS_REVIEW: p.needs_review, RESOLVED: p.resolved },
      refundsOpen: ref.rows[0]!.n,
    };
  }

  /**
   * Tìm nhanh (tên không phân biệt dấu, GB3): chuyến (mã/tên) cho mọi vai trò có `trip.read`; đơn (mã vé, SĐT, tên khách) chỉ khi có `booking.read`
   * — ngược lại `bookings: null`. Đơn đã xóa thông tin liên hệ chỉ tìm được theo mã vé.
   */
  async search(operatorId: string, role: Role, input: unknown) {
    const t = searchTerms(input);
    const withBookings = can(role, 'booking.read');
    if (!isUuid(operatorId)) return { q: t.q, trips: [], bookings: withBookings ? [] : null };
    const contains = `%${likeEscape(t.fold)}%`;
    const codePrefix = `${likeEscape(t.code)}%`;
    const tripsQ = this.db.query<{ id: string; code: string; name: string; status: string; depart_at: Date; route_code: string }>(
      `SELECT t.id, t.code, t.name, t.status, t.depart_at, r.code AS route_code
       FROM trips t JOIN routes r ON r.id = t.route_id
       WHERE t.operator_id = $1 AND (t.code LIKE $2 ESCAPE '\\' OR vn_fold(t.name) LIKE $3 ESCAPE '\\')
       ORDER BY abs(extract(epoch FROM t.depart_at - $4::timestamptz)), t.id LIMIT ${SEARCH_LIMIT}`,
      [operatorId, codePrefix, contains, this.clock.now()],
    );
    const bookingsQ = withBookings
      ? this.db.query<{
          code: string; status: string; contact_name: string; contact_phone: string; total_amount: number;
          trip_id: string; trip_code: string; trip_name: string; depart_at: Date;
        }>(
          `SELECT b.code, b.status, b.contact_name, b.contact_phone, b.total_amount,
             t.id AS trip_id, t.code AS trip_code, t.name AS trip_name, t.depart_at
           FROM bookings b JOIN trips t ON t.id = b.trip_id
           WHERE b.operator_id = $1 AND (
             b.code LIKE $2 ESCAPE '\\'
             OR (b.contact_erased_at IS NULL AND vn_fold(b.contact_name) LIKE $3 ESCAPE '\\')
             OR ($4::text IS NOT NULL AND b.contact_erased_at IS NULL AND b.contact_phone LIKE '%' || $4 || '%'))
           ORDER BY (b.code LIKE $2 ESCAPE '\\') DESC, b.created_at DESC, b.id LIMIT ${SEARCH_LIMIT}`,
          [operatorId, codePrefix, contains, t.phone],
        )
      : null;
    const [trips, bookings] = await Promise.all([tripsQ, bookingsQ]);
    return {
      q: t.q,
      trips: trips.rows.map((x) => ({ id: x.id, code: x.code, name: x.name, status: x.status, departAt: x.depart_at, routeCode: x.route_code })),
      bookings: bookings
        ? bookings.rows.map((x) => ({
            code: x.code, status: x.status, contactName: x.contact_name, contactPhone: x.contact_phone, totalAmount: x.total_amount,
            trip: { id: x.trip_id, code: x.trip_code, name: x.trip_name, departAt: x.depart_at },
          }))
        : null,
    };
  }
}

function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null;
}
