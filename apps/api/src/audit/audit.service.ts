import { Injectable } from '@nestjs/common';
import { isUuid } from '../common/ids';
import { Db, Queryable } from '../db/db';

export interface AuditEntry {
  operatorId: string | null;
  actorUserId: string | null;
  action: string; // ví dụ "vehicle.create"
  entity: string;
  entityId?: string | null;
  /** Không bao giờ chứa mật khẩu, token, bí mật 2FA. */
  data?: Record<string, unknown>;
}

const SECRET_KEYS = /pass|token|secret|otp|mfa|hash|key|cred/i;

/** Bỏ các trường nhạy cảm (ở mọi tầng lồng nhau) trước khi ghi nhật ký. */
export function redact(data: Record<string, unknown> = {}): Record<string, unknown> {
  const clean = (v: unknown, depth: number): unknown => {
    if (depth > 5) return '[truncated]';
    if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k]) => !SECRET_KEYS.test(k))
          .map(([k, x]) => [k, clean(x, depth + 1)]),
      );
    }
    return v;
  };
  return clean(data, 0) as Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: Db) {}

  async record(e: AuditEntry, q: Queryable = this.db): Promise<void> {
    await q.query(
      `INSERT INTO audit_logs (operator_id, actor_user_id, action, entity, entity_id, data) VALUES ($1, $2, $3, $4, $5, $6)`,
      [e.operatorId, e.actorUserId, e.action, e.entity, e.entityId ?? null, JSON.stringify(redact(e.data))],
    );
  }

  /** `excludeActionPrefixes`: ẩn bớt loại nhật ký (vd. quản trị nền tảng không xem các thao tác tiền `payment.`). */
  async list(operatorId: string, limit = 100, excludeActionPrefixes: string[] = []) {
    if (!isUuid(operatorId)) return [];
    const { rows } = await this.db.query(
      `SELECT a.id::text, a.action, a.entity, a.entity_id, a.data, a.at, u.full_name AS actor_name, u.role AS actor_role
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.operator_id = $1 AND NOT (a.action LIKE ANY ($3::text[]))
       ORDER BY a.at DESC, a.id DESC LIMIT $2`,
      [operatorId, Math.min(Math.max(limit, 1), 500), excludeActionPrefixes.map((p) => `${p.replace(/[%_\\]/g, '\\$&')}%`)],
    );
    return rows;
  }
}
