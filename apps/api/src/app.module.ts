import { DynamicModule, Module } from '@nestjs/common';
import { AbuseConfig } from './abuse/abuse-config';
import { PhoneVerificationService } from './abuse/phone-verification.service';
import { RateLimiter } from './abuse/rate-limiter';
import { NotConfiguredSmsSender, SmsSender } from './abuse/sms-sender';
import { HttpZaloPhoneResolver, ZaloPhoneResolver } from './abuse/zalo-phone';
import { ZaloPhoneService } from './abuse/zalo-phone.service';
import { ReportsService } from './reports/reports.service';
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
import { StaffBookingsService } from './bookings/staff-bookings.service';
import { PaymentProofsService } from './bookings/payment-proofs.service';
import { PassengerOpsService } from './bookings/passenger-ops.service';
import { HoldSweepConfig, HoldSweeper } from './bookings/hold-sweeper';
import { Clock, SystemClock } from './common/clock';
import { Db, DbConfig } from './db/db';
import { OperatorsService } from './operators/operators.service';
import { PublicController } from './public.controller';
import { SeatLayoutsService } from './seat-layouts/seat-layouts.service';
import { TripsService } from './trips/trips.service';
import { TripSchedulesService } from './trips/trip-schedules.service';
import { TripAssistantsService } from './trips/trip-assistants.service';
import { ScheduleRunner, ScheduleRunnerConfig } from './trips/schedule-runner';
import { VehiclesService } from './vehicles/vehicles.service';
import { MailSender, SmtpMailSender } from './alerts/mail-sender';
import { StaffAlertConfig, StaffAlertsService } from './alerts/staff-alerts.service';
import { StaffAlertDispatcher } from './alerts/staff-alert-dispatcher';

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
  /** Chu kỳ dọn đơn giữ chỗ quá hạn (ms). Bỏ trống/0 = tắt; production đặt qua env `HOLD_SWEEP_INTERVAL_MS`. */
  holdSweepIntervalMs?: number;
  /** Hạn access token quản trị (giây). Bỏ trống = 12 giờ (test); production đặt qua env `AUTH_ACCESS_TTL_SECONDS`. */
  authAccessTtlSeconds?: number;
  /** Bắt buộc 2FA cho OWNER/ACCOUNTANT/PLATFORM_ADMIN. Bỏ trống = tùy chọn; production đặt qua env `AUTH_REQUIRE_MFA`. */
  authRequireMfa?: boolean;
  scheduleIntervalMs?: number;
  /** Chu kỳ gửi email báo nhà xe từ outbox (ms). Bỏ trống/0 = tắt; production đặt qua env `STAFF_ALERT_INTERVAL_MS`. */
  staffAlertIntervalMs?: number;
  /** Địa chỉ Dashboard (env `DASHBOARD_URL`) để gắn link vào thư báo. */
  dashboardUrl?: string;
  mailSender?: MailSender;
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
        { provide: AuthConfig, useValue: new AuthConfig(opts.authTokenSecret, { accessTtlSeconds: opts.authAccessTtlSeconds, requireMfa: opts.authRequireMfa }) },
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
        TripSchedulesService,
        TripAssistantsService,
        ScheduleRunner,
        { provide: ScheduleRunnerConfig, useValue: new ScheduleRunnerConfig(opts.scheduleIntervalMs ?? 0) },
        BookingsService,
        StaffBookingsService,
        PassengerOpsService,
        PaymentProofsService,
        ReportsService,
        { provide: HoldSweepConfig, useValue: new HoldSweepConfig(opts.holdSweepIntervalMs ?? 0) },
        HoldSweeper,
        { provide: MailSender, useValue: opts.mailSender ?? new SmtpMailSender() },
        { provide: StaffAlertConfig, useValue: new StaffAlertConfig(opts.staffAlertIntervalMs ?? 0, opts.dashboardUrl) },
        StaffAlertsService,
        StaffAlertDispatcher,
        AuditService,
        AuthService,
        UsersService,
        AuthGuard,
      ],
      exports: [StaffAlertsService, StaffAlertDispatcher, Db, SeatLayoutsService, OperatorsService, VehiclesService, TripsService, BookingsService, HoldSweeper, AuthService, UsersService],
    };
  }
}
