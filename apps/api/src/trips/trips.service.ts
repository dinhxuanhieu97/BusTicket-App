import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { adminTripRange } from './admin-trip-query';
import { Clock } from '../common/clock';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { normalizeVnPhone } from '../common/phone';
import { vnDayRange } from '../common/vn-time';
import { Db, isPgError, PG_UNIQUE_VIOLATION, Queryable } from '../db/db';
import { MAX_UNIT_PRICE } from '../bookings/pricing';
import { OperatorsService } from '../operators/operators.service';

const stop = z.object({
  name: z.string().trim().min(1).max(160),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  day: z.number().int().min(0).max(7),
}).strict();
const stopList = z.array(stop).max(150).refine(list => list.every((s,i) => {
  const previous = list[i-1];
  return !previous || s.day > previous.day || (s.day === previous.day && s.time >= previous.time);
}), 'Các điểm cần theo thứ tự thời gian.');
const stopsSchema = z.object({pickup: stopList, dropoff: stopList}).strict();

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
    floor: z.string().regex(/^[1-3]$/),
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
  idempotency_key?: string | null;
  request_hash?: string | null;
}

/** Kết quả tạo chuyến; `replayed` = trả lại chuyến đã tạo trước đó với cùng Idempotency-Key. */
export type CreateTripResult = Omit<TripRow, 'idempotency_key' | 'request_hash'> & { replayed: boolean };

export type AdminSeatStatus = PublicSeatStatus;

export type PublicSeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';

/**
 * Trạng thái chỗ khách nhìn thấy. Đơn HOLDING đã quá hạn được coi là trống (hết hạn "lười"),
 * kể cả khi tác vụ nền chưa kịp giải phóng (PNTicketDocs mục 5.2).
 */
export const SEAT_STATUS_SQL = `
  CASE
    WHEN NOT ts.sellable THEN 'BLOCKED'
    WHEN b.id IS NULL THEN 'AVAILABLE'
    WHEN b.status = 'HOLDING' AND b.release_at > $2 THEN 'HELD'
    WHEN b.status IN ('CONFIRMED', 'COMPLETED') THEN 'BOOKED'
    ELSE 'AVAILABLE'
  END`;

/**
 * Giờ tới dự kiến: điểm trả cuối của tuyến (ngày lệch so với ngày khởi hành, giờ VN).
 * Tuyến chưa khai báo điểm trả → null (giao diện dùng quy tắc mặc định của nhà xe).
 */
export function expectedArrival(departAt: Date, stops: { dropoff?: { time: string; day: number }[] } | null): string | null {
  const last = stops?.dropoff?.at(-1);
  if (!last) return null;
  const vnMidnight = Math.floor((departAt.getTime() + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
  const [h, m] = last.time.split(':').map(Number);
  return new Date(vnMidnight + last.day * DAY_MS + (h! * 60 + m!) * 60_000).toISOString();
}
const VN_OFFSET_MS = 7 * 3600_000;
const DAY_MS = 24 * 3600_000;

/** Vehicle row must be locked before checking its allocation. */
export async function assertVehicleAvailable(
  q: Queryable, operatorId: string, vehicleId: string, start: Date, end: Date,
  options: { scheduledOnly?: boolean; exclude?: string } = {},
) {
  // A route stop can be up to day 7. Limit the indexed scan even for legacy trips without an occupancy snapshot.
  const conflict = await q.query(
    `SELECT t.id FROM trips t JOIN routes r ON r.id=t.route_id
     WHERE t.operator_id=$1 AND t.vehicle_id=$2 AND t.status<>'CANCELLED'
       AND t.depart_at >= $3::timestamptz - interval '9 days' AND t.depart_at < $4
       AND ($5::uuid IS NULL OR t.id<>$5) AND (NOT $6::boolean OR t.schedule_id IS NOT NULL)
       AND COALESCE(t.occupied_until,
         GREATEST(t.depart_at+interval '15 hours',
           (((t.depart_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + (r.stops #>> '{dropoff,-1,day}')::int)
              + (r.stops #>> '{dropoff,-1,time}')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh' + interval '1 hour')
       ) > $3 LIMIT 1`,
    [operatorId,vehicleId,start,end,options.exclude??null,options.scheduledOnly??false],
  );
  if (conflict.rows.length) throw new DomainError('CONFLICT', 'Xe đã có lịch chạy trùng khoảng thời gian.');
}

function publicTrip(t: TripRow): Omit<TripRow, 'idempotency_key' | 'request_hash'> {
  const { idempotency_key: _k, request_hash: _h, ...rest } = t;
  return rest;
}

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
  async createTrip(operatorId: string, input: CreateTripInput, idempotencyKey?: string, transaction?: PoolClient, allocation?: { until?: Date; checkAllTrips?: boolean }): Promise<CreateTripResult> {
    const data = createTripSchema.parse(input);
    const key = idempotencyKey?.trim();
    if (key !== undefined && !/^[\w-]{8,100}$/.test(key) && !(transaction && /^batch:[a-f0-9]{64}:[01]$/.test(key))) {
      throw new DomainError('VALIDATION_FAILED', 'Idempotency-Key phải dài 8–100 ký tự (chữ, số, "-", "_").', { field: 'Idempotency-Key' });
    }
    if (!(data.salesOpenAt < data.salesCloseAt && data.salesCloseAt <= data.departAt)) {
      throw new DomainError('VALIDATION_FAILED', 'Thời gian không hợp lệ: mở bán < đóng bán ≤ giờ khởi hành.');
    }
    const contactPhone = data.contactPhone ? normalizeVnPhone(data.contactPhone) : null;
    // Hash theo ngữ nghĩa (có phiên bản): thứ tự giá và cách viết SĐT không làm đổi yêu cầu.
    const requestHash = key
      ? createHash('sha256')
          .update('trip-create:v1:' + JSON.stringify({
            ...data,
            contactPhone,
            fares: [...data.fares].sort((a, b) => a.floor.localeCompare(b.floor) || a.occupancy - b.occupancy),
          }))
          .digest('hex')
      : null;
    if (!isUuid(operatorId)) throw notFound('nhà xe');

    try {
      const execute = async (c: PoolClient) => {
        if (key) {
          const existing = await this.findTripByKey(c, operatorId, key);
          if (existing) return this.replayTrip(existing, requestHash!);
        }
        const { rows: routes } = await c.query('SELECT id, stops FROM routes WHERE id = $1 AND operator_id = $2', [
          data.routeId,
          operatorId,
        ]);
        if (!routes[0]) throw notFound('tuyến');
        const { rows: vehicles } = await c.query<{ id: string; seat_layout_id: string; status: string }>(
          // Serialize vehicle allocations and pin the current seat layout.
          'SELECT id, seat_layout_id, status FROM vehicles WHERE id = $1 AND operator_id = $2 FOR UPDATE',
          [data.vehicleId, operatorId],
        );
        const vehicle = vehicles[0];
        if (!vehicle) throw notFound('xe');
        if (vehicle.status !== 'ACTIVE') throw new DomainError('VALIDATION_FAILED', 'Xe đang không hoạt động.');
        const arrival = expectedArrival(data.departAt, routes[0].stops);
        const occupiedUntil = allocation?.until ?? (arrival && new Date(arrival) > data.departAt
          ? new Date(new Date(arrival).getTime() + 60 * 60000)
          : new Date(data.departAt.getTime() + 15 * 3600000));
        await assertVehicleAvailable(c, operatorId, vehicle.id, data.departAt, occupiedUntil, {
          scheduledOnly: !allocation?.checkAllTrips,
        });

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
                              depart_at, sales_open_at, sales_close_at, status, idempotency_key, request_hash, occupied_until)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
          [operatorId, data.routeId, vehicle.id, vehicle.seat_layout_id, data.name, contactPhone,
            data.departAt, data.salesOpenAt, data.salesCloseAt, data.status, key ?? null, requestHash, occupiedUntil],
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
        return { ...publicTrip(trip), replayed: false };
      };
      return await (transaction ? execute(transaction) : this.db.tx(execute));
    } catch (e) {
      // Hai yêu cầu cùng khóa chạy song song: ràng buộc duy nhất chặn bản thứ hai → trả chuyến đã tạo.
      if (!transaction && key && isPgError(e, PG_UNIQUE_VIOLATION) && e.constraint === 'trips_operator_idempotency_key') {
        const existing = await this.findTripByKey(this.db, operatorId, key);
        if (existing) return this.replayTrip(existing, requestHash!);
      }
      throw e;
    }
  }

  async createBatch(operatorId:string,input:unknown,key:string) {
    if(!/^[\w-]{8,80}$/.test(key)) throw new DomainError('VALIDATION_FAILED','Thiếu khóa tạo chuyến hợp lệ.');
    const data=z.object({trips:z.array(createTripSchema).length(2)}).strict().parse(input);
    if(data.trips[0]!.vehicleId.toLowerCase()===data.trips[1]!.vehicleId.toLowerCase() || data.trips[0]!.routeId===data.trips[1]!.routeId)
      throw new DomainError('VALIDATION_FAILED','Hai chiều cần hai xe và hai tuyến riêng.');
    return this.db.tx(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[operatorId+':trip-batch:'+key]);
      const routes=(await c.query('SELECT origin,destination FROM routes WHERE operator_id=$1 AND id=ANY($2::uuid[])',[operatorId,data.trips.map(t=>t.routeId)])).rows;
      if(routes.length!==2) throw notFound('tuyến');
      const normalize=(v:string)=>v.trim().toLocaleLowerCase('vi');
      if(normalize(routes[0]!.origin)!==normalize(routes[1]!.destination)||normalize(routes[0]!.destination)!==normalize(routes[1]!.origin))
        throw new DomainError('VALIDATION_FAILED','Hai tuyến phải ngược chiều nhau.');
      await c.query('SELECT id FROM vehicles WHERE operator_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[operatorId,data.trips.map(t=>t.vehicleId)]);
      const result=[];
      for(let i=0;i<data.trips.length;i++) {
        const item=data.trips[i]!;
        const itemKey=`batch:${createHash('sha256').update(key).digest('hex')}:${i}`;
        if (item.departAt <= this.clock.now() && !await this.findTripByKey(c,operatorId,itemKey))
          throw new DomainError('CONFLICT','Giờ khởi hành phải ở tương lai.');
        result.push(await this.createTrip(operatorId,item,itemKey,c,{checkAllTrips:true}));
      }
      return {trips:result};
    });
  }

  private async findTripByKey(q: Queryable, operatorId: string, key: string): Promise<TripRow | undefined> {
    const { rows } = await q.query<TripRow>('SELECT * FROM trips WHERE operator_id = $1 AND idempotency_key = $2', [operatorId, key]);
    return rows[0];
  }

  private replayTrip(existing: TripRow, requestHash: string): CreateTripResult {
    if (existing.request_hash !== requestHash) {
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng cho một chuyến khác.');
    }
    return { ...publicTrip(existing), replayed: true };
  }

  async saveStops(operatorId: string, routeId: string, input: unknown) {
    const stops = stopsSchema.parse(input);
    if (!isUuid(routeId)) throw notFound('tuyến');
    const result = await this.db.query('UPDATE routes SET stops=$3::jsonb WHERE operator_id=$1 AND id=$2 RETURNING id',
      [operatorId, routeId, JSON.stringify(stops)]);
    if (!result.rows.length) throw notFound('tuyến');
    return stops;
  }

  async createRoutePair(operatorId:string,input:unknown) {
    const data=z.object({origin:z.string().trim().min(1).max(80),destination:z.string().trim().min(1).max(80),code:z.string().regex(/^[A-Z0-9-]{2,32}$/),reverseCode:z.string().regex(/^[A-Z0-9-]{2,32}$/)}).strict().parse(input);
    if(data.origin===data.destination||data.code===data.reverseCode) throw new DomainError('VALIDATION_FAILED','Hai chiều cần địa điểm và mã khác nhau.');
    return this.db.tx(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[operatorId+':route-pair']);
      const routes=[];
      for(const [code,origin,destination] of [[data.code,data.origin,data.destination],[data.reverseCode,data.destination,data.origin]]) {
        await c.query('INSERT INTO routes(operator_id,code,origin,destination) VALUES($1,$2,$3,$4) ON CONFLICT(operator_id,code) DO NOTHING',[operatorId,code,origin,destination]);
        const row=(await c.query('SELECT id,code,origin,destination FROM routes WHERE operator_id=$1 AND code=$2',[operatorId,code])).rows[0]!;
        if(row.origin!==origin||row.destination!==destination) throw new DomainError('CONFLICT','Mã tuyến đã được dùng cho địa điểm khác.');
        routes.push(row);
      }
      return {routes};
    });
  }

  async listRoutes(operatorId: string) {
    if (!isUuid(operatorId)) return [];
    const { rows } = await this.db.query(
      'SELECT id, code, origin, destination, stops FROM routes WHERE operator_id = $1 ORDER BY code',
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

  /** Bounded, keyset-paginated admin range; aggregate seats only for this page. */
  async listAdminRange(operatorId: string, input: unknown) {
    const q = adminTripRange(input);
    if (!isUuid(operatorId)) return { trips: [], nextCursor: null };
    const { rows } = await this.db.query<{ id: string; depart_at: Date; cursor_at: string; [key: string]: unknown }>(
      `WITH page AS MATERIALIZED (
         SELECT * FROM trips WHERE operator_id = $1 AND depart_at >= $3 AND depart_at < $4
           AND ($5::timestamptz IS NULL OR (depart_at, id) > ($5::timestamptz, $6::uuid))
         ORDER BY depart_at, id LIMIT $7
       )
       SELECT t.id, t.name, t.status, t.depart_at,
         to_char(t.depart_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at, t.sales_open_at, t.sales_close_at, t.contact_phone,
         r.code AS route_code, v.code AS vehicle_code, v.name AS vehicle_name,
         (SELECT COUNT(*)::int FROM trip_seats ts LEFT JOIN bookings b ON b.id = ts.booking_id
          WHERE ts.trip_id = t.id AND (${SEAT_STATUS_SQL}) = 'AVAILABLE') AS available,
         (SELECT COUNT(*)::int FROM trip_seats ts WHERE ts.trip_id = t.id) AS capacity
       FROM page t JOIN routes r ON r.id = t.route_id JOIN vehicles v ON v.id = t.vehicle_id
       ORDER BY t.depart_at, t.id`,
      [operatorId, this.clock.now(), q.start, q.end, q.after?.at ?? null, q.after?.id ?? null, q.limit + 1],
    );
    const last = rows[q.limit - 1];
    const trips = rows.slice(0,q.limit).map(({cursor_at: _cursor, ...trip}) => trip);
    return { trips, nextCursor: rows.length > q.limit && last ? `${last.cursor_at}|${last.id}` : null };
  }

  /**
   * Chi tiết một chuyến cho quản trị (mọi trạng thái, kể cả DRAFT), chỉ trong nhà xe của người gọi.
   * Sơ đồ là phiên bản đã chụp vào chuyến (`trips.seat_layout_id` + `trip_seats`), không phải sơ đồ hiện tại của xe.
   * Không trả tên/số điện thoại khách; chỉ mã đơn để đối chiếu.
   */
  async adminDetail(operatorId: string, tripId: string) {
    if (!isUuid(operatorId) || !isUuid(tripId)) throw notFound('chuyến');
    const now = this.clock.now();
    const { rows: trips } = await this.db.query<{
      id: string; name: string; status: TripRow['status']; depart_at: Date; sales_open_at: Date; sales_close_at: Date;
      contact_phone: string | null; created_at: Date; planned_arrive_at: Date | null;
      route_id: string; route_code: string; origin: string; destination: string; stops: z.output<typeof stopsSchema>;
      vehicle_id: string; vehicle_code: string; vehicle_name: string; vehicle_type: string; plate_number: string | null;
      vehicle_status: string; vehicle_layout_id: string;
      layout_id: string; layout_code: string; layout_version: number; layout_name: string; unit: string; kind: string;
      definition: { floors: { code: string; label: string; rows: string[] }[] };
    }>(
      `SELECT t.id, t.name, t.status, t.depart_at, t.sales_open_at, t.sales_close_at, t.contact_phone, t.created_at,
              r.id AS route_id, r.code AS route_code, r.origin, r.destination, COALESCE(t.stops_snapshot,r.stops) AS stops, t.planned_arrive_at,
              v.id AS vehicle_id, v.code AS vehicle_code, v.name AS vehicle_name, v.type AS vehicle_type,
              v.plate_number, v.status AS vehicle_status, v.seat_layout_id AS vehicle_layout_id,
              sl.id AS layout_id, sl.code AS layout_code, sl.version AS layout_version, sl.name AS layout_name,
              sl.unit, sl.kind, sl.definition
       FROM trips t JOIN routes r ON r.id = t.route_id JOIN vehicles v ON v.id = t.vehicle_id
       JOIN seat_layouts sl ON sl.id = t.seat_layout_id
       WHERE t.id = $1 AND t.operator_id = $2`,
      [tripId, operatorId],
    );
    const t = trips[0];
    if (!t) throw notFound('chuyến');
    const { rows: seats } = await this.db.query<{
      seat_code: string; floor: string; max_occupancy: number; sellable: boolean; row_idx: number | null; col_idx: number | null;
      status: AdminSeatStatus; booking_code: string | null; hold_expires_at: Date | null;
    }>(
      `SELECT ts.seat_code, ts.floor, ts.max_occupancy, ts.sellable, s.row_idx, s.col_idx, ${SEAT_STATUS_SQL} AS status,
              b.code AS booking_code, b.hold_expires_at
       FROM trip_seats ts
       JOIN trips t ON t.id = ts.trip_id
       LEFT JOIN seats s ON s.seat_layout_id = t.seat_layout_id AND s.code = ts.seat_code
       LEFT JOIN bookings b ON b.id = ts.booking_id
       WHERE ts.trip_id = $1
       ORDER BY ts.floor, substring(ts.seat_code from '^[A-Z]+'), substring(ts.seat_code from '[0-9]+$')::int`,
      [tripId, now],
    );
    const { rows: fares } = await this.db.query<{ floor: string; occupancy: number; price: number }>(
      'SELECT floor, occupancy, price FROM trip_fares WHERE trip_id = $1 ORDER BY floor, occupancy',
      [tripId],
    );
    const count = (st: AdminSeatStatus) => seats.filter((x) => x.status === st).length;
    const floorLabel = new Map(t.definition.floors.map((f) => [f.code, f.label]));
    return {
      trip: {
        id: t.id,
        name: t.name,
        status: t.status,
        departAt: t.depart_at.toISOString(),
        arriveAt: t.planned_arrive_at?.toISOString() ?? expectedArrival(t.depart_at, t.stops),
        salesOpenAt: t.sales_open_at.toISOString(),
        salesCloseAt: t.sales_close_at.toISOString(),
        contactPhone: t.contact_phone,
        createdAt: t.created_at.toISOString(),
        onSale: t.status === 'OPEN' && t.sales_open_at <= now && now < t.sales_close_at,
      },
      route: { id: t.route_id, code: t.route_code, origin: t.origin, destination: t.destination },
      vehicle: {
        id: t.vehicle_id, code: t.vehicle_code, name: t.vehicle_name, type: t.vehicle_type,
        plateNumber: t.plate_number, status: t.vehicle_status,
        /** Xe đã đổi sang sơ đồ khác sau khi tạo chuyến: chuyến vẫn giữ sơ đồ đã chụp. */
        layoutChangedSinceTrip: t.vehicle_layout_id !== t.layout_id,
      },
      layout: {
        id: t.layout_id, code: t.layout_code, version: t.layout_version, name: t.layout_name, unit: t.unit, kind: t.kind,
        floors: t.definition.floors.map((f) => ({ code: f.code, label: f.label, rows: f.rows })),
      },
      fares: fares.map((f) => ({ ...f, floorLabel: floorLabel.get(f.floor) ?? `Tầng ${f.floor}` })),
      seats: seats.map((x) => ({
        code: x.seat_code, floor: x.floor, row: x.row_idx, col: x.col_idx, maxOccupancy: x.max_occupancy,
        sellable: x.sellable, status: x.status,
        bookingCode: x.status === 'HELD' || x.status === 'BOOKED' ? x.booking_code : null,
        holdExpiresAt: x.status === 'HELD' && x.hold_expires_at ? x.hold_expires_at.toISOString() : null,
      })),
      summary: {
        capacity: seats.length, available: count('AVAILABLE'), held: count('HELD'), booked: count('BOOKED'), blocked: count('BLOCKED'),
      },
      fetchedAt: now.toISOString(),
    };
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
      if (t.status === status) return publicTrip(t);
      if (!allowed[t.status]!.includes(status)) {
        throw new DomainError('CONFLICT', `Không thể chuyển chuyến từ ${t.status} sang ${status}.`);
      }
      const { rows: updated } = await c.query<TripRow>('UPDATE trips SET status = $2 WHERE id = $1 RETURNING *', [tripId, status]);
      return publicTrip(updated[0]!);
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

  /** One row per bookable route. Pick a departure that actually offers the displayed fare. */
  async discover(operatorCode: string) {
    const op = await this.operators.getByCode(operatorCode);
    const { rows } = await this.db.query<{
      code: string; origin: string; destination: string; depart_at: Date; from_price: number | null; count: number;
    }>(
      `WITH bookable AS (
         SELECT r.code, r.origin, r.destination, t.depart_at,
                (SELECT MIN(f.price) FROM trip_fares f WHERE f.trip_id = t.id AND f.occupancy = 1) AS price
           FROM trips t JOIN routes r ON r.id = t.route_id
          WHERE t.operator_id = $1 AND t.status = 'OPEN' AND t.depart_at > $2
            AND t.sales_open_at <= $2 AND t.sales_close_at > $2
            AND EXISTS (SELECT 1 FROM trip_seats ts LEFT JOIN bookings b ON b.id = ts.booking_id
                         WHERE ts.trip_id = t.id AND (${SEAT_STATUS_SQL}) = 'AVAILABLE')
       )
       SELECT code, origin, destination, MIN(price)::int AS from_price, COUNT(*)::int AS count,
              (array_agg(depart_at ORDER BY price NULLS LAST, depart_at))[1] AS depart_at
         FROM bookable GROUP BY code, origin, destination ORDER BY from_price NULLS LAST, code`,
      [op.id, this.clock.now()],
    );
    return rows.map(r => ({ code: r.code, origin: r.origin, destination: r.destination,
      fromPrice: r.from_price, tripCount: r.count, departAt: r.depart_at.toISOString() }));
  }

  /** Sơ đồ chỗ công khai: chỉ mã chỗ, trạng thái, sức chứa và giá — không có dữ liệu khách. */
  async seatMap(tripId: string) {
    if (!isUuid(tripId)) throw notFound('chuyến');
    const now = this.clock.now();
    const { rows: trips } = await this.db.query<{
      id: string; operator_id: string; name: string; depart_at: Date; status: string; sales_open_at: Date; sales_close_at: Date;
      definition: { floors: { code: string; label: string; rows: string[] }[] }; layout_name: string; unit: string; kind: string;
      stops: z.output<typeof stopsSchema>; vehicle_name: string; vehicle_code: string;
    }>(
      `SELECT COALESCE(t.stops_snapshot,r.stops) AS stops, t.id, t.operator_id, t.name, t.depart_at, t.status, t.sales_open_at, t.sales_close_at,
              sl.definition, sl.name AS layout_name, sl.unit, sl.kind,
              v.name AS vehicle_name, v.code AS vehicle_code
       FROM trips t JOIN routes r ON r.id=t.route_id JOIN seat_layouts sl ON sl.id = t.seat_layout_id JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.id = $1 AND t.status <> 'DRAFT'`,
      [tripId],
    );
    const t = trips[0];
    if (!t) throw notFound('chuyến');
    const { rows: seats } = await this.db.query<{ seat_code: string; floor: string; max_occupancy: number; status: PublicSeatStatus }>(
      `SELECT ts.seat_code, ts.floor, ts.max_occupancy, ${SEAT_STATUS_SQL} AS status
       FROM trip_seats ts LEFT JOIN bookings b ON b.id = ts.booking_id
       WHERE ts.trip_id = $1
       ORDER BY ts.floor, substring(ts.seat_code from '^[A-Z]+'), substring(ts.seat_code from '[0-9]+$')::int`,
      [tripId, now],
    );
    const { rows: fares } = await this.db.query<{ floor: string; occupancy: number; price: number }>(
      'SELECT floor, occupancy, price FROM trip_fares WHERE trip_id = $1 ORDER BY floor, occupancy',
      [tripId],
    );
    const onSale = t.status === 'OPEN' && t.sales_open_at <= now && now < t.sales_close_at;
    const policy = await this.operators.currentPolicy(t.operator_id);
    return {
      stops: t.stops,
      trip: { id: t.id, name: t.name, departAt: t.depart_at.toISOString(), onSale },
      /** Cho giao diện biết cần làm bước OTP trước khi giữ chỗ hay không, và giới hạn mỗi đơn. */
      booking: {
        requiresPhoneOtp: policy.requirePhoneOtp,
        maxUnitsPerBooking: policy.maxUnitsPerBooking,
        holdMinutes: policy.holdMinutes,
        /** Trẻ em đi kèm: chỉ áp dụng cho phòng/chỗ 1 người. */
        childPolicy: {
          freeUnderAge: policy.childPolicy.freeUnderAge,
          price: policy.childPolicy.price,
          maxPerUnit: policy.childPolicy.maxPerUnit,
          singleOccupancyOnly: true,
        },
      },
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
