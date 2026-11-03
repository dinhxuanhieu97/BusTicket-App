import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
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
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
