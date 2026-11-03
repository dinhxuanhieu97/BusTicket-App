import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';

/** Bất cứ thứ gì chạy được SQL: Pool hoặc client trong một transaction. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

export class DbConfig {
  constructor(readonly connectionString: string, readonly maxConnections = 20) {}
}

@Injectable()
export class Db implements OnModuleDestroy, Queryable {
  readonly pool: Pool;
  private closed = false;

  constructor(config: DbConfig) {
    this.pool = new Pool({ connectionString: config.connectionString, max: config.maxConnections });
  }

  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
    return this.pool.query<R>(text, params);
  }

  /** Chạy `fn` trong một transaction; lỗi thì ROLLBACK và ném lại. */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }

  onModuleDestroy(): Promise<void> {
    return this.close();
  }
}

/** Mã lỗi PostgreSQL vi phạm ràng buộc duy nhất. */
export const PG_UNIQUE_VIOLATION = '23505';

export function isPgError(e: unknown, code: string): e is { code: string; constraint?: string } {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === code;
}
