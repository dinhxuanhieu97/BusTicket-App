import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseTrustProxy } from './abuse/client-ip';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/http-error.filter';

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(
    AppModule.forRoot({
      databaseUrl: requiredEnv('DATABASE_URL'),
      bookingTokenSecret: requiredEnv('BOOKING_TOKEN_SECRET'),
      authTokenSecret: requiredEnv('AUTH_TOKEN_SECRET'),
    }),
  );
  app.useGlobalFilters(new HttpErrorFilter());
  // Chỉ tin X-Forwarded-For khi chạy sau proxy/load balancer đã biết (vd. TRUST_PROXY=1 = một tầng proxy).
  // Không đặt thì dùng IP kết nối trực tiếp — client không thể giả IP để né giới hạn tần suất.
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  if (trustProxy !== undefined) app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
