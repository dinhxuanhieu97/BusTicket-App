import { DynamicModule, Module } from '@nestjs/common';
import { AdminController } from './admin/admin.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthConfig, AuthService } from './auth/auth.service';
import { SecretBox } from './auth/totp';
import { UsersService } from './auth/users.service';
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
  authTokenSecret: string;
  clock?: Clock;
}

@Module({})
export class AppModule {
  static forRoot(opts: AppOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [PublicController, AuthController, AdminController],
      providers: [
        { provide: DbConfig, useValue: new DbConfig(opts.databaseUrl) },
        { provide: Clock, useValue: opts.clock ?? new SystemClock() },
        { provide: TokenSecret, useValue: new TokenSecret(opts.bookingTokenSecret) },
        { provide: AuthConfig, useValue: new AuthConfig(opts.authTokenSecret) },
        { provide: SecretBox, useValue: new SecretBox(opts.authTokenSecret) },
        Db,
        SeatLayoutsService,
        OperatorsService,
        VehiclesService,
        TripsService,
        BookingsService,
        AuditService,
        AuthService,
        UsersService,
        AuthGuard,
      ],
      exports: [Db, SeatLayoutsService, OperatorsService, VehiclesService, TripsService, BookingsService, AuthService, UsersService],
    };
  }
}
