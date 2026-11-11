import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseTrustProxy } from './abuse/client-ip';
import { parseZaloSecretKeys } from './abuse/zalo-phone';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/http-error.filter';

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/**
 * Phân tích CORS_ORIGINS: danh sách origin cách nhau bởi dấu phẩy, hoặc "*" để cho phép tất cả.
 * Ví dụ: "https://miniapp.zalo.me,https://h5.zdn.vn"
 * Nếu không đặt, CORS bị tắt (chỉ dùng khi Mini App và API cùng origin hoặc qua Vite proxy).
 */
function parseCorsOrigins(raw: string | undefined): string | string[] | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '*') return '*';
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(
    AppModule.forRoot({
      databaseUrl: requiredEnv('DATABASE_URL'),
      bookingTokenSecret: requiredEnv('BOOKING_TOKEN_SECRET'),
      authTokenSecret: requiredEnv('AUTH_TOKEN_SECRET'),
      zaloSecretKeys: parseZaloSecretKeys(process.env.ZALO_APP_SECRET_KEYS),
      // Dọn đơn giữ chỗ quá hạn mỗi phút (đặt 0 để tắt).
      scheduleIntervalMs: Number(process.env.TRIP_SCHEDULE_INTERVAL_MS ?? 60000),
      holdSweepIntervalMs: Number(process.env.HOLD_SWEEP_INTERVAL_MS ?? 60_000),
      // Access token quản trị ngắn hạn (mặc định 15 phút); dashboard tự đổi refresh token lấy token mới.
      authAccessTtlSeconds: Number(process.env.AUTH_ACCESS_TTL_SECONDS ?? 900),
    }),
  );
  app.useGlobalFilters(new HttpErrorFilter());

  // CORS: cho phép Mini App / Web gọi API từ origin khác.
  // Đặt CORS_ORIGINS=* để bật cho mọi origin (chỉ dùng khi phát triển hoặc đứng sau Caddy đã lọc).
  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
  if (corsOrigins) {
    app.enableCors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Booking-Token', 'X-Phone-Token', 'Idempotency-Key'],
      credentials: true,
    });
  }

  // Chỉ tin X-Forwarded-For khi chạy sau proxy/load balancer đã biết (vd. TRUST_PROXY=1 = một tầng proxy).
  // Không đặt thì dùng IP kết nối trực tiếp — client không thể giả IP để né giới hạn tần suất.
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  if (trustProxy !== undefined) app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
