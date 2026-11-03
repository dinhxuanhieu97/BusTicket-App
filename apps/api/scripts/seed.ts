/**
 * Dữ liệu dev: nhà xe Phong Nhung (PN), tuyến TP.HCM → Hoài Ân, 2 chuyến ngày mai.
 * Chạy: DATABASE_URL=... pnpm --filter api seed
 */
import 'reflect-metadata';
import { Db, DbConfig } from '../src/db/db';
import { migrate } from '../src/db/migrate';
import { OperatorsService } from '../src/operators/operators.service';
import { SeatLayoutsService } from '../src/seat-layouts/seat-layouts.service';
import { TripsService } from '../src/trips/trips.service';
import { VehiclesService } from '../src/vehicles/vehicles.service';
import { SystemClock } from '../src/common/clock';
import { NotConfiguredSmsSender } from '../src/abuse/sms-sender';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Missing DATABASE_URL');
  const db = new Db(new DbConfig(url));
  try {
    await migrate(db.pool);
    const layouts = new SeatLayoutsService(db);
    const operators = new OperatorsService(db, layouts, new NotConfiguredSmsSender());
    const vehicles = new VehiclesService(db, layouts);
    const trips = new TripsService(db, operators, new SystemClock());
    const op = await operators.create({ code: 'PN', name: 'Nhà xe Phong Nhung' });
    const [limo, bed] = await vehicles.list(op.id);
    const route = await trips.createRoute(op.id, { code: 'HCM-HA', origin: 'TP.HCM', destination: 'Hoài Ân' });
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    const at = (hourVn: number, minute = 0) => {
      const d = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), hourVn - 7, minute));
      return d;
    };
    const now = new Date();
    await trips.createTrip(op.id, {
      routeId: route.id, vehicleId: limo!.id, name: 'TP.HCM → Hoài Ân 18:00',
      departAt: at(18), salesOpenAt: now, salesCloseAt: at(17),
      fares: [
        { floor: 'A', occupancy: 1, price: 450_000 }, { floor: 'A', occupancy: 2, price: 700_000 },
        { floor: 'B', occupancy: 1, price: 420_000 }, { floor: 'B', occupancy: 2, price: 650_000 },
      ],
    });
    await trips.createTrip(op.id, {
      routeId: route.id, vehicleId: bed!.id, name: 'TP.HCM → Hoài Ân 19:30',
      departAt: at(19, 30), salesOpenAt: now, salesCloseAt: at(18, 30),
      fares: [{ floor: 'A', occupancy: 1, price: 380_000 }, { floor: 'B', occupancy: 1, price: 350_000 }],
    });
    console.log(`Seeded operator ${op.code} with 2 trips tomorrow.`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
