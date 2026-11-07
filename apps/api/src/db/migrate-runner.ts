/**
 * Standalone migration runner — dùng cho Railway / Docker entrypoint.
 * Chạy: node dist/db/migrate-runner.js
 * Đọc DATABASE_URL từ env, áp dụng tất cả migration chưa chạy, rồi thoát.
 */
import { Pool } from 'pg';
import { migrate } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
migrate(pool)
  .then((applied) => {
    console.log(applied.length ? `Migration applied: ${applied.join(', ')}` : 'DB up to date');
    return pool.end();
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
