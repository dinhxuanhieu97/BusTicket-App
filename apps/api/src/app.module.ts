import { DynamicModule, Module } from '@nestjs/common';
import { BookingsService, TokenSecret } from './bookings/bookings.service';
import { Clock, SystemClock } from './common/clock';
import { Db, DbConfig } from './db/db';
import { OperatorsService } from './operators/operators.service';
import { PublicController } from './public.controller';
import { SeatLayoutsService } from './seat-layouts/seat-layouts.service';
import { TripsService } from './trips/trips.service';
import { VehiclesService } from './vehicles/vehicles.service';

export interface AppOptions {
  databaseUrl: string;
  bookingTokenSecret: string;
  clock?: Clock;
}

@Module({})
export class AppModule {
  static forRoot(opts: AppOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [PublicController],
      providers: [
        { provide: DbConfig, useValue: new DbConfig(opts.databaseUrl) },
        { provide: Clock, useValue: opts.clock ?? new SystemClock() },
        { provide: TokenSecret, useValue: new TokenSecret(opts.bookingTokenSecret) },
        Db,
        SeatLayoutsService,
        OperatorsService,
        VehiclesService,
        TripsService,
        BookingsService,
      ],
      exports: [Db, SeatLayoutsService, OperatorsService, VehiclesService, TripsService, BookingsService],
    };
  }
}
