import { DynamicModule, Module } from '@nestjs/common';
import { AbuseConfig } from './abuse/abuse-config';
import { PhoneVerificationService } from './abuse/phone-verification.service';
import { RateLimiter } from './abuse/rate-limiter';
import { NotConfiguredSmsSender, SmsSender } from './abuse/sms-sender';
import { HttpZaloPhoneResolver, ZaloPhoneResolver } from './abuse/zalo-phone';
import { ZaloPhoneService } from './abuse/zalo-phone.service';
import { AdminController } from './admin/admin.controller';
import { PaymentsService } from './payments/payments.service';
import { HttpSepayTransactionsClient, SepayTransactionsClient } from './payments/sepay';
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
  abuse?: Partial<AbuseConfig>;
  smsSender?: SmsSender;
  sepayClient?: SepayTransactionsClient;
  /** Secret Key Mini App theo mã nhà xe (env `ZALO_APP_SECRET_KEYS`). */
  zaloSecretKeys?: Record<string, string>;
  zaloPhoneResolver?: ZaloPhoneResolver;
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
        { provide: AbuseConfig, useValue: new AbuseConfig(opts.abuse) },
        { provide: SmsSender, useValue: opts.smsSender ?? new NotConfiguredSmsSender() },
        RateLimiter,
        { provide: SepayTransactionsClient, useValue: opts.sepayClient ?? new HttpSepayTransactionsClient() },
        PaymentsService,
        PhoneVerificationService,
        {
          provide: ZaloPhoneResolver,
          useValue: opts.zaloPhoneResolver ?? new HttpZaloPhoneResolver(opts.zaloSecretKeys ?? {}),
        },
        ZaloPhoneService,
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
