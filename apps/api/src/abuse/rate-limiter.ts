import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { DomainError } from '../common/errors';
import { Db, Queryable } from '../db/db';

export interface RateResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

interface RateWindow {
  queryable?: Queryable;
  now?: Date;
}

/**
 * Giới hạn tần suất theo cửa sổ thời gian cố định, lưu trong PostgreSQL (đếm nguyên tử bằng
 * INSERT … ON CONFLICT nên an toàn khi chạy nhiều tiến trình API).
 */
@Injectable()
export class RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async hit(key: string, limit: number, windowSeconds: number, window: RateWindow = {}): Promise<RateResult> {
    const { queryable = this.db, now = this.clock.now() } = window;
    const nowMs = now.getTime();
    const windowMs = windowSeconds * 1000;
    const start = new Date(Math.floor(nowMs / windowMs) * windowMs);
    const { rows } = await queryable.query<{ count: number }>(
      `INSERT INTO rate_limit_counters (key, window_start, count) VALUES ($1, $2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_counters.count + 1
       RETURNING count`,
      [key, start],
    );
    const count = rows[0]!.count;
    const retryAfterSeconds = Math.max(1, Math.ceil((start.getTime() + windowMs - nowMs) / 1000));
    if (queryable === this.db && Math.random() < 0.01) void this.prune().catch(() => undefined);
    return { allowed: count <= limit, count, retryAfterSeconds };
  }

  /** Như `hit` nhưng ném TOO_MANY_ATTEMPTS (kèm thời gian chờ) khi vượt ngưỡng. */
  async consume(key: string, limit: number, windowSeconds: number, message: string, window?: RateWindow): Promise<void> {
    const r = await this.hit(key, limit, windowSeconds, window);
    if (!r.allowed) throw new DomainError('TOO_MANY_ATTEMPTS', message, { retryAfterSeconds: r.retryAfterSeconds });
  }

  /** Xóa bộ đếm cũ hơn 1 ngày. */
  async prune(): Promise<void> {
    await this.db.query('DELETE FROM rate_limit_counters WHERE window_start < $1', [
      new Date(this.clock.now().getTime() - 24 * 3600_000),
    ]);
  }
}
