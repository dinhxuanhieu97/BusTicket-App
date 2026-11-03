/**
 * Tạo tài khoản quản trị nền tảng đầu tiên (không có API HTTP cho việc này).
 * Chạy: DATABASE_URL=... ADMIN_PHONE=09... ADMIN_NAME="..." ADMIN_PASSWORD=... pnpm --filter api create-admin
 * Đăng nhập lần đầu sẽ yêu cầu bật xác thực 2 lớp.
 */
import 'reflect-metadata';
import { UsersService } from '../src/auth/users.service';
import { SystemClock } from '../src/common/clock';
import { Db, DbConfig } from '../src/db/db';
import { migrate } from '../src/db/migrate';

async function main(): Promise<void> {
  const env = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing ${k}`);
    return v;
  };
  const db = new Db(new DbConfig(env('DATABASE_URL')));
  try {
    await migrate(db.pool);
    const user = await new UsersService(db, new SystemClock()).createPlatformAdmin({
      fullName: env('ADMIN_NAME'),
      phone: env('ADMIN_PHONE'),
      password: env('ADMIN_PASSWORD'),
    });
    console.log(`Created platform admin ${user.fullName} (${user.phone}).`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
