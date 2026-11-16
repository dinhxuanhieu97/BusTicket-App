import { notFound } from '../common/errors';
import { Queryable } from '../db/db';
import type { StopPoint } from '../bookings/stops';

/**
 * Phạm vi đơn trong danh sách khách của chuyến:
 * - `confirmed`: đơn đã xác nhận/hoàn tất (phụ xe chỉ thấy phạm vi này).
 * - `active`: thêm đơn đang giữ chỗ còn hạn (nhân viên cần gọi khách chưa trả tiền).
 * - `all`: thêm cả đơn đã hết hạn/đã hủy (tra cứu lịch sử).
 */
export type PassengerScope = 'confirmed' | 'active' | 'all';

export interface PassengerSeat {
  code: string;
  floor: string;
  occupancy: number;
  infantCount: number;
  /** Thời điểm đánh dấu lên xe; null = chưa lên. */
  boardedAt: string | null;
}

export interface PassengerBooking {
  code: string;
  status: string;
  channel: string;
  contactName: string;
  contactPhone: string;
  /** Khách đã tự xóa họ tên/SĐT (Thỏa thuận Zalo 5.3.3(d)); tên/SĐT không còn là dữ liệu thật. */
  contactErased: boolean;
  note: string | null;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: string;
  /** Điểm đón/trả khách chọn (chụp lúc đặt); null = chưa chọn. */
  pickupStop: StopPoint | null;
  dropoffStop: StopPoint | null;
  /** Nhân viên tạo đơn tại quầy/nhập file; null với đơn online. */
  createdBy: string | null;
  /** Hạn nhả chỗ của đơn đang giữ; null với đơn khác. */
  holdUntil: string | null;
  createdAt: string;
  /** Tổng tiền phụ xe đã thu trên xe (ghi qua file nhập lại); chỉ nhân viên văn phòng thấy. */
  onboardCollected: number;
  /** Lý do nhân viên hủy đơn; null nếu không phải nhân viên hủy. */
  cancelReason: string | null;
  seats: PassengerSeat[];
}

export interface PassengerSummary {
  bookings: number;
  seats: number;
  people: number;
  infants: number;
  dueAmount: number;
  /** Số chỗ (của đơn đã xác nhận) đã đánh dấu lên xe; `boardedPeople` tính theo số người của chỗ. */
  boarded: number;
  boardedPeople: number;
}

/**
 * Chuyến tóm tắt + danh sách khách theo đơn. Chỉ đọc trong nhà xe `operatorId` (lấy từ phiên ở máy chủ).
 * `summary` chỉ tính đơn đã xác nhận/hoàn tất (người thật sẽ lên xe); `holding` tính riêng đơn đang giữ chỗ.
 */
export async function loadTripPassengers(q: Queryable, operatorId: string, tripId: string, scope: PassengerScope, now: Date) {
  const trip = await tripSummary(q, operatorId, tripId);
  const statusFilter =
    scope === 'all'
      ? 'TRUE'
      : scope === 'active'
        ? `(b.status IN ('CONFIRMED', 'COMPLETED') OR (b.status = 'HOLDING' AND b.release_at > $3))`
        : `b.status IN ('CONFIRMED', 'COMPLETED')`;
  const { rows } = await q.query<{
    id: string; code: string; status: string; channel: string; contact_name: string; contact_phone: string;
    contact_erased_at: Date | null; passenger_note: string | null; total_amount: number; paid_amount: number;
    payment_status: string; release_at: Date | null; created_at: Date;
    pickup_stop: StopPoint | null; dropoff_stop: StopPoint | null; created_by_name: string | null;
    seat_code: string; floor: string; occupancy: number; infant_count: number; boarded_at: Date | null;
    onboard: number; cancel_reason: string | null;
  }>(
    `SELECT b.id, b.code, b.status, b.channel, b.contact_name, b.contact_phone, b.contact_erased_at, b.passenger_note,
            b.total_amount, b.paid_amount, b.payment_status, b.release_at, b.created_at,
            b.pickup_stop, b.dropoff_stop, u.full_name AS created_by_name,
            bi.seat_code, ts.floor, bi.occupancy, bi.infant_count, bi.boarded_at, b.cancel_reason,
            COALESCE((SELECT sum(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
                      WHERE pa.booking_id = b.id AND p.collected_onboard), 0)::int AS onboard
     FROM booking_items bi
     JOIN bookings b ON b.id = bi.booking_id
     LEFT JOIN users u ON u.id = b.created_by
     JOIN trip_seats ts ON ts.trip_id = bi.trip_id AND ts.seat_code = bi.seat_code
     WHERE bi.trip_id = $1 AND b.operator_id = $2 AND ${statusFilter}
     ORDER BY ts.floor, length(bi.seat_code), bi.seat_code, b.created_at, b.code`,
    scope === 'active' ? [tripId, operatorId, now] : [tripId, operatorId],
  );
  const byBooking = new Map<string, PassengerBooking>();
  for (const r of rows) {
    let b = byBooking.get(r.id);
    if (!b) {
      // Khi khách xóa thông tin, DB đã thay tên bằng nhãn "Khách đã xóa thông tin", SĐT rỗng, ghi chú NULL
      // (BookingsService.eraseContact) — trả nguyên như cũ để màn phụ xe hiện tại không đổi, kèm cờ cho giao diện mới.
      b = {
        code: r.code,
        // Đơn giữ chỗ đã quá hạn nhưng tác vụ dọn chưa chạy: coi như EXPIRED (như BookingsService.effectiveStatus).
        status: r.status === 'HOLDING' && (!r.release_at || r.release_at <= now) ? 'EXPIRED' : r.status,
        channel: r.channel,
        contactName: r.contact_name,
        contactPhone: r.contact_phone,
        contactErased: r.contact_erased_at !== null,
        note: r.passenger_note,
        totalAmount: r.total_amount,
        paidAmount: r.paid_amount,
        dueAmount: Math.max(r.total_amount - r.paid_amount, 0),
        paymentStatus: r.payment_status,
        pickupStop: r.pickup_stop,
        dropoffStop: r.dropoff_stop,
        createdBy: r.created_by_name,
        holdUntil: r.status === 'HOLDING' && r.release_at && r.release_at > now ? r.release_at.toISOString() : null,
        createdAt: r.created_at.toISOString(),
        onboardCollected: r.onboard,
        cancelReason: r.cancel_reason,
        seats: [],
      };
      byBooking.set(r.id, b);
    }
    b.seats.push({
      code: r.seat_code, floor: r.floor, occupancy: r.occupancy, infantCount: r.infant_count, boardedAt: r.boarded_at?.toISOString() ?? null,
    });
  }
  const bookings = [...byBooking.values()];
  const confirmed = bookings.filter((b) => b.status === 'CONFIRMED' || b.status === 'COMPLETED');
  const holding = bookings.filter((b) => b.status === 'HOLDING');
  return {
    trip,
    bookings,
    summary: summarize(confirmed),
    holding: { bookings: holding.length, seats: holding.reduce((n, b) => n + b.seats.length, 0) },
    fetchedAt: now.toISOString(),
  };
}

function summarize(bookings: PassengerBooking[]): PassengerSummary {
  const seats = bookings.flatMap((b) => b.seats);
  return {
    bookings: bookings.length,
    seats: seats.length,
    people: seats.reduce((n, s) => n + s.occupancy, 0),
    infants: seats.reduce((n, s) => n + s.infantCount, 0),
    dueAmount: bookings.reduce((n, b) => n + b.dueAmount, 0),
    boarded: seats.filter((s) => s.boardedAt).length,
    boardedPeople: seats.reduce((n, s) => n + (s.boardedAt ? s.occupancy : 0), 0),
  };
}

/** Tóm tắt chuyến (tuyến, xe) cho trang danh sách khách. */
async function tripSummary(q: Queryable, operatorId: string, tripId: string) {
  const { rows } = await q.query<{
    id: string; name: string; status: string; depart_at: Date; contact_phone: string | null;
    route_code: string; origin: string; destination: string; vehicle_code: string; vehicle_name: string; plate_number: string | null;
  }>(
    `SELECT t.id, t.name, t.status, t.depart_at, t.contact_phone, r.code AS route_code, r.origin, r.destination,
            v.code AS vehicle_code, v.name AS vehicle_name, v.plate_number
     FROM trips t JOIN routes r ON r.id = t.route_id JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.id = $1 AND t.operator_id = $2`,
    [tripId, operatorId],
  );
  const t = rows[0];
  if (!t) throw notFound('chuyến');
  return {
    id: t.id, name: t.name, status: t.status, departAt: t.depart_at.toISOString(), contactPhone: t.contact_phone,
    route: { code: t.route_code, origin: t.origin, destination: t.destination },
    vehicle: { code: t.vehicle_code, name: t.vehicle_name, plateNumber: t.plate_number },
  };
}
