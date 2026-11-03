import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { normalizeVnPhone } from '../common/phone';
import { vnDayRange } from '../common/vn-time';
import { Db, isPgError, PG_UNIQUE_VIOLATION } from '../db/db';
import { MAX_UNIT_PRICE } from '../bookings/pricing';
import { OperatorsService } from '../operators/operators.service';

export const createRouteSchema = z
  .object({
    code: z.string().regex(/^[A-Z0-9-]{2,32}$/),
    origin: z.string().trim().min(1).max(80),
    destination: z.string().trim().min(1).max(80),
  })
  .strict();

/** Nhận ISO 8601 có múi giờ hoặc Date; trả Date. */
const instant = z
  .union([z.string().datetime({ offset: true }), z.date()])
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), 'Thời điểm không hợp lệ');

const fareSchema = z
  .object({
    floor: z.string().regex(/^[A-Z]$/),
    occupancy: z.union([z.literal(1), z.literal(2)]),
    price: z.number().int().min(0).max(MAX_UNIT_PRICE),
  })
  .strict();

export const createTripSchema = z
  .object({
    routeId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    contactPhone: z.string().optional(),
    departAt: instant,
    salesOpenAt: instant,
    salesCloseAt: instant,
    fares: z.array(fareSchema).min(1),
    status: z.enum(['DRAFT', 'OPEN']).default('OPEN'),
  })
  .strict();
export type CreateTripInput = z.input<typeof createTripSchema>;

export interface TripRow {
  id: string;
  operator_id: string;
  route_id: string;
  vehicle_id: string;
  seat_layout_id: string;
  name: string;
  contact_phone: string | null;
  depart_at: Date;
  sales_open_at: Date;
  sales_close_at: Date;
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'CANCELLED';
}

export type PublicSeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';

/**
 * Trạng thái chỗ khách nhìn thấy. Đơn HOLDING đã quá hạn được coi là trống (hết hạn "lười"),
 * kể cả khi tác vụ nền chưa kịp giải phóng (PNTicketDocs mục 5.2).
 */
export const SEAT_STATUS_SQL = `
  CASE
    WHEN NOT ts.sellable THEN 'BLOCKED'
    WHEN b.id IS NULL THEN 'AVAILABLE'
    WHEN b.status = 'HOLDING' AND b.hold_expires_at > $2 THEN 'HELD'
    WHEN b.status IN ('CONFIRMED', 'COMPLETED') THEN 'BOOKED'
    ELSE 'AVAILABLE'
  END`;

@Injectable()
export class TripsService {
  constructor(
    private readonly db: Db,
    private readonly operators: OperatorsService,
    private readonly clock: Clock,
  ) {}

  async createRoute(operatorId: string, input: z.input<typeof createRouteSchema>) {
    const data = createRouteSchema.parse(input);
    await this.operators.getById(operatorId);
    try {
      const { rows } = await this.db.query<{ id: string; code: string; origin: string; destination: string }>(
        `INSERT INTO routes (operator_id, code, origin, destination) VALUES ($1, $2, $3, $4)
         RETURNING id, code, origin, destination`,
        [operatorId, data.code, data.origin, data.destination],
      );
      return rows[0]!;
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new DomainError('CONFLICT', `Mã tuyến ${data.code} đã tồn tại.`);
      throw e;
    }
  }

  /**
   * Tạo chuyến: chụp phiên bản sơ đồ hiện tại của xe vào `trip_seats`, bắt buộc có đủ giá
   * cho mọi (tầng × số người) bán được.
   */
  async createTrip(operatorId: string, input: CreateTripInput): Promise<TripRow> {
    const data = createTripSchema.parse(input);
    if (!(data.salesOpenAt < data.salesCloseAt && data.salesCloseAt <= data.departAt)) {
      throw new DomainError('VALIDATION_FAILED', 'Thời gian không hợp lệ: mở bán < đóng bán ≤ giờ khởi hành.');
    }
    const contactPhone = data.contactPhone ? normalizeVnPhone(data.contactPhone) : null;
    if (!isUuid(operatorId)) throw notFound('nhà xe');

    return this.db.tx(async (c) => {
      const { rows: routes } = await c.query('SELECT id FROM routes WHERE id = $1 AND operator_id = $2', [
        data.routeId,
        operatorId,
      ]);
      if (!routes[0]) throw notFound('tuyến');
      const { rows: vehicles } = await c.query<{ id: string; seat_layout_id: string; status: string }>(
        // FOR SHARE: chặn đổi sơ đồ/trạng thái xe trong lúc đang chụp sơ đồ vào chuyến.
        'SELECT id, seat_layout_id, status FROM vehicles WHERE id = $1 AND operator_id = $2 FOR SHARE',
        [data.vehicleId, operatorId],
      );
      const vehicle = vehicles[0];
      if (!vehicle) throw notFound('xe');
      if (vehicle.status !== 'ACTIVE') throw new DomainError('VALIDATION_FAILED', 'Xe đang không hoạt động.');

      const { rows: needs } = await c.query<{ floor: string; max_occ: number }>(
        `SELECT floor, MAX(max_occupancy) AS max_occ FROM seats
         WHERE seat_layout_id = $1 AND sellable GROUP BY floor ORDER BY floor`,
        [vehicle.seat_layout_id],
      );
      const fareKey = (f: string, o: number) => `${f}:${o}`;
      const given = new Map<string, number>();
      for (const f of data.fares) {
        const k = fareKey(f.floor, f.occupancy);
        if (given.has(k)) throw new DomainError('VALIDATION_FAILED', `Giá tầng ${f.floor}, ${f.occupancy} người bị khai báo trùng.`);
        given.set(k, f.price);
      }
      const required = needs.flatMap((n) => Array.from({ length: n.max_occ }, (_, i) => fareKey(n.floor, i + 1)));
      const missing = required.filter((k) => !given.has(k));
      if (missing.length) {
        throw new DomainError('FARE_NOT_CONFIGURED', 'Thiếu giá cho một số tầng/số người.', { missing });
      }
      const extra = [...given.keys()].filter((k) => !required.includes(k));
      if (extra.length) {
        throw new DomainError('VALIDATION_FAILED', 'Có giá cho tầng/số người mà sơ đồ xe không có.', { extra });
      }

      const { rows } = await c.query<TripRow>(
        `INSERT INTO trips (operator_id, route_id, vehicle_id, seat_layout_id, name, contact_phone,
                            depart_at, sales_open_at, sales_close_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [operatorId, data.routeId, vehicle.id, vehicle.seat_layout_id, data.name, contactPhone,
          data.departAt, data.salesOpenAt, data.salesCloseAt, data.status],
      );
      const trip = rows[0]!;
      await c.query(
        `INSERT INTO trip_seats (trip_id, seat_code, floor, max_occupancy, sellable)
         SELECT $1, code, floor, max_occupancy, sellable FROM seats WHERE seat_layout_id = $2`,
        [trip.id, vehicle.seat_layout_id],
      );
      for (const f of data.fares) {
        await c.query('INSERT INTO trip_fares (trip_id, floor, occupancy, price) VALUES ($1, $2, $3, $4)', [
          trip.id, f.floor, f.occupancy, f.price,
        ]);
      }
      return trip;
    });
  }

  async listRoutes(operatorId: string) {
    if (!isUuid(operatorId)) return [];
    const { rows } = await this.db.query(
      'SELECT id, code, origin, destination FROM routes WHERE operator_id = $1 ORDER BY code',
      [operatorId],
    );
    return rows;
  }

  /** Mọi chuyến (mọi trạng thái) của nhà xe trong một ngày giờ VN — cho trang quản trị. */
  async listForAdmin(operatorId: string, date: string) {
    const { start, end } = vnDayRange(date);
    if (!isUuid(operatorId)) return [];
    const now = this.clock.now();
    const { rows } = await this.db.query(
      `SELECT t.id, t.name, t.status, t.depart_at, t.sales_open_at, t.sales_close_at, t.contact_phone,
              r.code AS route_code, v.code AS vehicle_code, v.name AS vehicle_name,
              (SELECT COUNT(*)::int FROM trip_seats ts LEFT JOIN bookings b ON b.id = ts.booking_id
                WHERE ts.trip_id = t.id AND (${SEAT_STATUS_SQL}) = 'AVAILABLE') AS available,
              (SELECT COUNT(*)::int FROM trip_seats ts WHERE ts.trip_id = t.id) AS capacity
       FROM trips t JOIN routes r ON r.id = t.route_id JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.operator_id = $1 AND t.depart_at >= $3 AND t.depart_at < $4
       ORDER BY t.depart_at`,
      [operatorId, now, start, end],
    );
    return rows;
  }

  /**
   * Đổi trạng thái bán: DRAFT → OPEN, OPEN ↔ CLOSED. Hủy chuyến (CANCELLED) cần xử lý khách
   * và tiền nên làm ở task sau.
   */
  async setStatus(operatorId: string, tripId: string, status: 'OPEN' | 'CLOSED'): Promise<TripRow> {
    if (!isUuid(operatorId) || !isUuid(tripId)) throw notFound('chuyến');
    const allowed: Record<string, string[]> = { DRAFT: ['OPEN'], OPEN: ['CLOSED'], CLOSED: ['OPEN'], CANCELLED: [] };
    return this.db.tx(async (c) => {
      const { rows } = await c.query<TripRow>(
        'SELECT * FROM trips WHERE id = $1 AND operator_id = $2 FOR NO KEY UPDATE',
        [tripId, operatorId],
      );
      const t = rows[0];
      if (!t) throw notFound('chuyến');
      if (t.status === status) return t;
      if (!allowed[t.status]!.includes(status)) {
        throw new DomainError('CONFLICT', `Không thể chuyển chuyến từ ${t.status} sang ${status}.`);
      }
      const { rows: updated } = await c.query<TripRow>('UPDATE trips SET status = $2 WHERE id = $1 RETURNING *', [tripId, status]);
      return updated[0]!;
    });
  }

  /** Tìm chuyến đang bán của một nhà xe trong một ngày (giờ Việt Nam). Dữ liệu công khai. */
  async search(operatorCode: string, date: string, routeCode?: string) {
    const op = await this.operators.getByCode(operatorCode);
    const { start, end } = vnDayRange(date);
    const now = this.clock.now();
    const { rows } = await this.db.query<{
      id: string; name: string; depart_at: Date; route_code: string; origin: string; destination: string;
      vehicle_name: string; vehicle_code: string; vehicle_type: string; layout_name: string; unit: string;
      available: number; from_price: number;
    }>(
      `SELECT t.id, t.name, t.depart_at, r.code AS route_code, r.origin, r.destination,
              v.name AS vehicle_name, v.code AS vehicle_code, v.type AS vehicle_type,
              sl.name AS layout_name, sl.unit,
              (SELECT COUNT(*)::int FROM trip_seats ts LEFT JOIN bookings b ON b.id = ts.booking_id
                WHERE ts.trip_id = t.id AND (${SEAT_STATUS_SQL}) = 'AVAILABLE') AS available,
              (SELECT MIN(price)::int FROM trip_fares f WHERE f.trip_id = t.id AND f.occupancy = 1) AS from_price
       FROM trips t
       JOIN routes r ON r.id = t.route_id
       JOIN vehicles v ON v.id = t.vehicle_id
       JOIN seat_layouts sl ON sl.id = t.seat_layout_id
       WHERE t.operator_id = $1 AND t.status = 'OPEN'
         AND t.depart_at >= $3 AND t.depart_at < $4
         AND t.sales_open_at <= $2 AND t.sales_close_at > $2
         AND ($5::text IS NULL OR r.code = $5)
       ORDER BY t.depart_at`,
      [op.id, now, start, end, routeCode ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      departAt: r.depart_at.toISOString(),
      route: { code: r.route_code, origin: r.origin, destination: r.destination },
      vehicle: { name: r.vehicle_name, code: r.vehicle_code, type: r.vehicle_type, layoutName: r.layout_name },
      unit: r.unit,
      availableUnits: r.available,
      fromPrice: r.from_price,
    }));
  }

  /** Sơ đồ chỗ công khai: chỉ mã chỗ, trạng thái, sức chứa và giá — không có dữ liệu khách. */
  async seatMap(tripId: string) {
    if (!isUuid(tripId)) throw notFound('chuyến');
    const now = this.clock.now();
    const { rows: trips } = await this.db.query<{
      id: string; name: string; depart_at: Date; status: string; sales_open_at: Date; sales_close_at: Date;
      definition: { floors: { code: string; label: string; rows: string[] }[] }; layout_name: string; unit: string; kind: string;
      vehicle_name: string; vehicle_code: string;
    }>(
      `SELECT t.id, t.name, t.depart_at, t.status, t.sales_open_at, t.sales_close_at,
              sl.definition, sl.name AS layout_name, sl.unit, sl.kind,
              v.name AS vehicle_name, v.code AS vehicle_code
       FROM trips t JOIN seat_layouts sl ON sl.id = t.seat_layout_id JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.id = $1 AND t.status <> 'DRAFT'`,
      [tripId],
    );
    const t = trips[0];
    if (!t) throw notFound('chuyến');
    const { rows: seats } = await this.db.query<{ seat_code: string; floor: string; max_occupancy: number; status: PublicSeatStatus }>(
      `SELECT ts.seat_code, ts.floor, ts.max_occupancy, ${SEAT_STATUS_SQL} AS status
       FROM trip_seats ts LEFT JOIN bookings b ON b.id = ts.booking_id
       WHERE ts.trip_id = $1 ORDER BY ts.seat_code`,
      [tripId, now],
    );
    const { rows: fares } = await this.db.query<{ floor: string; occupancy: number; price: number }>(
      'SELECT floor, occupancy, price FROM trip_fares WHERE trip_id = $1 ORDER BY floor, occupancy',
      [tripId],
    );
    const onSale = t.status === 'OPEN' && t.sales_open_at <= now && now < t.sales_close_at;
    return {
      trip: { id: t.id, name: t.name, departAt: t.depart_at.toISOString(), onSale },
      vehicle: { name: t.vehicle_name, code: t.vehicle_code },
      layout: {
        name: t.layout_name,
        unit: t.unit,
        kind: t.kind,
        floors: t.definition.floors.map((f) => ({ code: f.code, label: f.label, rows: f.rows })),
      },
      seats: seats.map((s) => ({ code: s.seat_code, floor: s.floor, maxOccupancy: s.max_occupancy, status: s.status })),
      fares,
    };
  }
}
