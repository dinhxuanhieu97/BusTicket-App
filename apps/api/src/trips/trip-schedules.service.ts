import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../db/db';
import { Clock } from '../common/clock';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { vnDayRange } from '../common/vn-time';
import { assertVehicleAvailable, TripsService } from './trips.service';
import { AuditService } from '../audit/audit.service';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const fare = z
  .object({
    floor: z.string().min(1),
    occupancy: z.union([z.literal(1), z.literal(2)]),
    price: z.number().int().min(0).max(20000000),
  })
  .strict();
const assignment = z.object({ vehicleId: z.string().uuid(), fares: z.array(fare).min(1).max(50) }).strict();
export const scheduleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startDate: z.string(),
    departTime: time,
    arrivalTime: time.default('07:00'),
    turnaroundMinutes: z.number().int().min(0).max(720).default(60),
    legs: z
      .array(
        z
          .object({
            routeId: z.string().uuid(),
            name: z.string().trim().max(120).optional(),
            vehicles: z.array(assignment).length(2),
          })
          .strict(),
      )
      .length(2),
  })
  .strict()
  .superRefine((v, ctx) => {
    try {
      vnDayRange(v.startDate);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Ngày bắt đầu không hợp lệ.' });
    }
    if (v.legs[0]!.routeId === v.legs[1]!.routeId)
      ctx.addIssue({ code: 'custom', message: 'Hai chiều phải là hai tuyến riêng.' });
    if (
      v.legs[0]!.vehicles[0]!.vehicleId !== v.legs[1]!.vehicles[1]!.vehicleId ||
      v.legs[0]!.vehicles[1]!.vehicleId !== v.legs[1]!.vehicles[0]!.vehicleId ||
      v.legs[0]!.vehicles[0]!.vehicleId === v.legs[0]!.vehicles[1]!.vehicleId
    )
      ctx.addIssue({ code: 'custom', message: 'Hai xe phải luân phiên ngược chiều qua hai ngày.' });
  });
type Config = z.infer<typeof scheduleSchema>;
interface Schedule {
  id: string;
  operator_id: string;
  name: string;
  config: Config;
  enabled: boolean;
  next_run_at: Date;
  last_error: string | null;
  last_success_at: Date | null;
}
export const exceptionSchema = z
  .object({
    date: z.string(),
    leg: z.number().int().min(0).max(1),
    skipped: z.boolean(),
    departTime: time.optional(),
    repositionConfirmed: z.boolean().optional(),
  })
  .strict()
  .refine((ex) => !ex.skipped || ex.repositionConfirmed === true, {
    message: 'Xác nhận xe được điều chuyển về đúng đầu tuyến cho ngày kế tiếp.',
  });
const dayMs = 86400000;
function windowDates(now: Date) {
  const first = today(now);
  const start = vnDayRange(first).start.getTime() + 7 * 3600000;
  return Array.from({ length: 30 }, (_, i) => new Date(start + i * dayMs).toISOString().slice(0, 10));
}
const today = (now: Date) => new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const instant = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
function occurrence(config: Config, date: string, leg: number, override?: string) {
  const offset = Math.round((vnDayRange(date).start.getTime() - vnDayRange(config.startDate).start.getTime()) / dayMs);
  const assignment = config.legs[leg]!.vehicles[((offset % 2) + 2) % 2]!;
  const depart = instant(date, override ?? config.departTime);
  const delta = depart.getTime() - instant(date, config.departTime).getTime();
  const arrival = new Date(instant(date, config.arrivalTime).getTime() + dayMs + delta);
  const until = new Date(arrival.getTime() + config.turnaroundMinutes * 60000);
  return { assignment, depart, until, arrival, delta };
}
type Stops = {
  pickup: { name: string; time: string; day: number }[];
  dropoff: { name: string; time: string; day: number }[];
};
function shiftStops(stops: Stops, deltaMs: number): Stops {
  const shift = (list: Stops['pickup']) =>
    list.map((stop) => {
      const [h, m] = stop.time.split(':').map(Number);
      const minutes = stop.day * 1440 + h! * 60 + m! + deltaMs / 60000;
      const day = Math.floor(minutes / 1440);
      if (day < 0 || day > 7)
        throw new DomainError('VALIDATION_FAILED', 'Đổi giờ đưa điểm đón/trả ra ngoài ngày chuyến.');
      const minute = minutes % 1440;
      const time = [Math.floor(minute / 60), minute % 60].map((n) => String(n).padStart(2, '0')).join(':');
      return { ...stop, time, day };
    });
  return { pickup: shift(stops.pickup), dropoff: shift(stops.dropoff) };
}
@Injectable()
export class TripSchedulesService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly trips: TripsService,
    private readonly audit: AuditService,
  ) {}

  async list(operatorId: string) {
    return (
      await this.db.query<Schedule>(
        'SELECT * FROM trip_schedules WHERE operator_id=$1 ORDER BY created_at DESC LIMIT 100',
        [operatorId],
      )
    ).rows;
  }

  async create(operatorId: string, input: unknown, actor: string | null, requestKey?: string) {
    const key = z.string().uuid().optional().parse(requestKey);
    const config = scheduleSchema.parse(input);
    return this.db.tx(async (c) => {
      // Validate tenant ownership and distinct reverse endpoints before persisting a template.
      const routes = (
        await c.query('SELECT id,origin,destination FROM routes WHERE operator_id=$1 AND id=ANY($2::uuid[])', [
          operatorId,
          config.legs.map((l) => l.routeId),
        ])
      ).rows;
      if (routes.length !== 2) throw notFound('tuyến');
      const a = routes.find((r) => r.id === config.legs[0]!.routeId)!,
        b = routes.find((r) => r.id === config.legs[1]!.routeId)!;
      const norm = (s: string) => s.trim().toLocaleLowerCase('vi');
      if (norm(a.origin) !== norm(b.destination) || norm(a.destination) !== norm(b.origin))
        throw new DomainError('VALIDATION_FAILED', 'Hai tuyến phải ngược chiều nhau.');
      const ids = config.legs[0]!.vehicles.map((v) => v.vehicleId);
      const vehicles = (
        await c.query("SELECT id FROM vehicles WHERE operator_id=$1 AND status='ACTIVE' AND id=ANY($2::uuid[])", [
          operatorId,
          ids,
        ])
      ).rows;
      if (vehicles.length !== 2) throw notFound('xe hoạt động');
      const row = (
        await c.query<Schedule>(
          'INSERT INTO trip_schedules(operator_id,name,config,create_key) VALUES($1,$2,$3,$4) ON CONFLICT(operator_id,create_key) DO NOTHING RETURNING *',
          [operatorId, config.name, JSON.stringify(config), key ?? null],
        )
      ).rows[0];
      if (!row) {
        const replay = (
          await c.query<Schedule>(
            'SELECT * FROM trip_schedules WHERE operator_id=$1 AND create_key=$2 AND config=$3::jsonb',
            [operatorId, key, JSON.stringify(config)],
          )
        ).rows[0];
        if (!replay) throw new DomainError('CONFLICT', 'Yêu cầu này đã được dùng cho lịch khác.');
        return replay;
      }
      await this.audit.record(
        {
          operatorId,
          actorUserId: actor,
          action: 'schedule.create',
          entity: 'trip_schedule',
          entityId: row.id,
          data: {},
        },
        c,
      );
      return row;
    });
  }

  async setEnabled(operatorId: string, id: string, enabled: boolean, actor: string | null) {
    if (!isUuid(id)) throw notFound('lịch');
    return this.db.tx(async (c) => {
      const row = (
        await c.query<Schedule>(
          'UPDATE trip_schedules SET enabled=$3,next_run_at=$4 WHERE id=$1 AND operator_id=$2 RETURNING *',
          [id, operatorId, enabled, this.clock.now()],
        )
      ).rows[0];
      if (!row) throw notFound('lịch');
      await this.audit.record(
        {
          operatorId,
          actorUserId: actor,
          action: enabled ? 'schedule.enable' : 'schedule.pause',
          entity: 'trip_schedule',
          entityId: id,
          data: {},
        },
        c,
      );
      return row;
    });
  }

  /** Preview is bounded, side-effect free and shares the generation calendar. */
  async preview(operatorId: string, id: string) {
    if (!isUuid(id)) throw notFound('lịch');
    const row = (
      await this.db.query<Schedule>('SELECT * FROM trip_schedules WHERE id=$1 AND operator_id=$2', [id, operatorId])
    ).rows[0];
    if (!row) throw notFound('lịch');
    const config = scheduleSchema.parse(row.config),
      now = this.clock.now();
    const dates = windowDates(now);
    const exceptions = (
      await this.db.query<{ service_date: string; leg: number; skipped: boolean; depart_time: string | null }>(
        'SELECT service_date::text,leg,skipped,depart_time FROM trip_schedule_exceptions WHERE schedule_id=$1 AND service_date BETWEEN $2 AND $3',
        [id, dates[0], dates.at(-1)],
      )
    ).rows;
    const existing = new Set(
      (
        await this.db.query<{ service_date: string; schedule_leg: number }>(
          'SELECT service_date::text,schedule_leg FROM trips WHERE schedule_id=$1 AND service_date BETWEEN $2 AND $3',
          [id, dates[0], dates.at(-1)],
        )
      ).rows.map((t) => t.service_date + ':' + t.schedule_leg),
    );
    const result = [];
    for (const date of dates) {
      if (date < config.startDate) continue;
      for (let leg = 0; leg < 2; leg++) {
        const ex = exceptions.find((e) => e.service_date === date && e.leg === leg);
        const item = occurrence(config, date, leg, ex?.depart_time ?? undefined);
        if (item.depart <= now) continue;
        result.push({
          date,
          leg,
          vehicleId: item.assignment.vehicleId,
          routeId: config.legs[leg]!.routeId,
          departAt: item.depart.toISOString(),
          skipped: ex?.skipped ?? false,
          existing: existing.has(date + ':' + leg),
        });
      }
    }
    return result;
  }

  async saveException(operatorId: string, id: string, input: unknown, actor: string | null) {
    if (!isUuid(id)) throw notFound('lịch');
    const ex = exceptionSchema.parse(input);
    vnDayRange(ex.date);
    return this.db.tx(async (c) => {
      const schedule = (
        await c.query<Schedule>('SELECT * FROM trip_schedules WHERE id=$1 AND operator_id=$2 FOR UPDATE', [
          id,
          operatorId,
        ])
      ).rows[0];
      if (!schedule) throw notFound('lịch');
      if (ex.date < schedule.config.startDate)
        throw new DomainError('VALIDATION_FAILED', 'Ngày nằm trước khi bắt đầu lịch.');
      if (ex.date < today(this.clock.now())) throw new DomainError('CONFLICT', 'Không sửa ngày đã qua.');
      const config = scheduleSchema.parse(schedule.config);
      const item = occurrence(config, ex.date, ex.leg, ex.departTime);
      // Lock vehicle before trip, matching generation/manual creation.
      const vehicle = (
        await c.query('SELECT status FROM vehicles WHERE id=$1 AND operator_id=$2 FOR UPDATE', [
          item.assignment.vehicleId,
          operatorId,
        ])
      ).rows[0];
      if (!vehicle || (!ex.skipped && vehicle.status !== 'ACTIVE'))
        throw new DomainError('CONFLICT', 'Xe không còn hoạt động.');
      const trip = (
        await c.query(
          'SELECT id,depart_at,status,stops_snapshot FROM trips WHERE schedule_id=$1 AND service_date=$2 AND schedule_leg=$3 FOR NO KEY UPDATE',
          [id, ex.date, ex.leg],
        )
      ).rows[0];
      if (!ex.skipped && item.depart <= this.clock.now())
        throw new DomainError('CONFLICT', 'Giờ khởi hành phải ở tương lai.');
      if (trip) {
        const booking = (await c.query('SELECT 1 FROM booking_items WHERE trip_id=$1 LIMIT 1', [trip.id])).rows[0];
        if (booking || new Date(trip.depart_at) <= this.clock.now())
          throw new DomainError('CONFLICT', 'Chuyến đã có đơn hoặc đã khởi hành; cần xử lý điều hành riêng.');
        if (!ex.skipped)
          await assertVehicleAvailable(c, operatorId, item.assignment.vehicleId, item.depart, item.until, {
            exclude: trip.id,
          });
        if (ex.skipped) await c.query("UPDATE trips SET status='CANCELLED' WHERE id=$1", [trip.id]);
        else {
          const stops = trip.stops_snapshot
            ? shiftStops(trip.stops_snapshot, item.depart.getTime() - new Date(trip.depart_at).getTime())
            : null;
          await c.query(
            `UPDATE trips SET depart_at=$2,sales_close_at=$2,sales_open_at=LEAST(sales_open_at,$2::timestamptz-interval '1 second'),occupied_until=$3,status=$4,planned_arrive_at=$5,stops_snapshot=$6 WHERE id=$1`,
            [
              trip.id,
              item.depart,
              item.until,
              trip.status === 'CANCELLED' ? (schedule.enabled ? 'OPEN' : 'DRAFT') : trip.status,
              item.arrival,
              stops ? JSON.stringify(stops) : null,
            ],
          );
        }
      }
      await c.query(
        `INSERT INTO trip_schedule_exceptions(schedule_id,service_date,leg,skipped,depart_time) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(schedule_id,service_date,leg) DO UPDATE SET skipped=EXCLUDED.skipped,depart_time=EXCLUDED.depart_time`,
        [id, ex.date, ex.leg, ex.skipped, ex.departTime ?? null],
      );
      if (!trip && !ex.skipped)
        await c.query('UPDATE trip_schedules SET next_run_at=$2 WHERE id=$1', [id, this.clock.now()]);
      await this.audit.record(
        {
          operatorId,
          actorUserId: actor,
          action: 'schedule.exception',
          entity: 'trip_schedule',
          entityId: id,
          data: ex,
        },
        c,
      );
      return ex;
    });
  }

  async generate(operatorId: string, id: string, dueOnly = false) {
    if (!isUuid(id)) throw notFound('lịch');
    const outcome = await this.db.tx(async (c) => {
      const schedule = (
        await c.query<Schedule>('SELECT * FROM trip_schedules WHERE id=$1 AND operator_id=$2 FOR UPDATE', [
          id,
          operatorId,
        ])
      ).rows[0];
      if (!schedule) throw notFound('lịch');
      if (!schedule.enabled || (dueOnly && schedule.next_run_at > this.clock.now())) return { result: { created: 0 } };
      await c.query('SAVEPOINT schedule_work');
      try {
        const config = scheduleSchema.parse(schedule.config);
        // Fixed lock order prevents opposite-direction schedules deadlocking on two vehicles.
        await c.query('SELECT id FROM vehicles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
          config.legs[0]!.vehicles.map((v) => v.vehicleId),
        ]);
        const now = this.clock.now();
        const dates = windowDates(now);
        const exceptions = (
          await c.query<{ service_date: string; leg: number; skipped: boolean; depart_time: string | null }>(
            'SELECT service_date::text,leg,skipped,depart_time FROM trip_schedule_exceptions WHERE schedule_id=$1 AND service_date BETWEEN $2 AND $3',
            [id, dates[0], dates.at(-1)],
          )
        ).rows;
        const existing = new Set(
          (
            await c.query<{ service_date: string; schedule_leg: number }>(
              'SELECT service_date::text,schedule_leg FROM trips WHERE schedule_id=$1 AND service_date BETWEEN $2 AND $3',
              [id, dates[0], dates.at(-1)],
            )
          ).rows.map((t) => t.service_date + ':' + t.schedule_leg),
        );
        const routes = (
          await c.query('SELECT id,origin,destination,stops FROM routes WHERE operator_id=$1 AND id=ANY($2::uuid[])', [
            operatorId,
            config.legs.map((l) => l.routeId),
          ])
        ).rows;
        let created = 0;
        for (const date of dates) {
          if (date < config.startDate) continue;
          for (let leg = 0; leg < 2; leg++) {
            const ex = exceptions.find((e) => e.service_date === date && e.leg === leg);
            if (ex?.skipped) continue;
            const item = occurrence(config, date, leg, ex?.depart_time ?? undefined);
            const salesOpenAt = this.clock.now();
            if (item.depart <= salesOpenAt) continue;
            if (existing.has(date + ':' + leg)) continue;
            const route = routes.find((r) => r.id === config.legs[leg]!.routeId);
            if (!route) throw notFound('tuyến');
            const trip = await this.trips.createTrip(
              operatorId,
              {
                routeId: config.legs[leg]!.routeId,
                vehicleId: item.assignment.vehicleId,
                name: config.legs[leg]!.name || `Chuyến ${route.origin} → ${route.destination}`,
                departAt: item.depart,
                salesOpenAt,
                salesCloseAt: item.depart,
                fares: item.assignment.fares,
                status: 'OPEN',
              },
              undefined,
              c,
              { until: item.until, checkAllTrips: true },
            );
            await c.query(
              'UPDATE trips SET schedule_id=$2,service_date=$3,schedule_leg=$4,occupied_until=$5,planned_arrive_at=$6,stops_snapshot=$7 WHERE id=$1',
              [trip.id, id, date, leg, item.until, item.arrival, JSON.stringify(shiftStops(route.stops, item.delta))],
            );
            created++;
          }
        }
        const next = new Date(vnDayRange(today(now)).end.getTime() + 5 * 60000);
        await c.query('UPDATE trip_schedules SET last_success_at=$2,last_error=NULL,next_run_at=$3 WHERE id=$1', [
          id,
          now,
          next,
        ]);
        if (created)
          await this.audit.record(
            {
              operatorId,
              actorUserId: null,
              action: 'schedule.generate',
              entity: 'trip_schedule',
              entityId: id,
              data: { created },
            },
            c,
          );
        return { result: { created } };
      } catch (error) {
        // Keep the schedule row locked while persisting failure. Do not overwrite a later exception edit.
        await c.query('ROLLBACK TO SAVEPOINT schedule_work');
        await c.query('UPDATE trip_schedules SET last_error=$2,next_run_at=$3 WHERE id=$1', [
          id,
          error instanceof DomainError ? error.message : 'Không tạo được lịch; thử lại sau.',
          new Date(this.clock.now().getTime() + 3600000),
        ]);
        return { error };
      }
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.result;
  }

  async runDue() {
    const due = (
      await this.db.query<{ id: string; operator_id: string }>(
        'SELECT id,operator_id FROM trip_schedules WHERE enabled AND next_run_at<=$1 ORDER BY next_run_at LIMIT 10',
        [this.clock.now()],
      )
    ).rows;
    for (const row of due) {
      try {
        await this.generate(row.operator_id, row.id, true);
      } catch {
        /* Error is persisted per schedule; continue other tenants. */
      }
    }
    return due.length;
  }
}
