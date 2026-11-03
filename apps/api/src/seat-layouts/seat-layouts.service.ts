import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { Db, Queryable } from '../db/db';
import { LayoutKind, parseLayout } from './layout-parser';
import { LIBRARY_LAYOUTS } from './library';

export interface SeatLayoutRow {
  id: string;
  operator_id: string | null;
  code: string;
  version: number;
  name: string;
  unit: string;
  kind: LayoutKind;
  definition: unknown;
  capacity: number;
}

export const createLayoutSchema = z
  .object({
    code: z.string().regex(/^[A-Z0-9_]{2,32}$/),
    name: z.string().trim().min(1).max(80),
    unit: z.string().trim().min(1).max(20),
    kind: z.enum(['room', 'bed', 'seat']),
    definition: z.unknown(),
  })
  .strict();
export type CreateLayoutInput = z.infer<typeof createLayoutSchema>;

@Injectable()
export class SeatLayoutsService {
  constructor(private readonly db: Db) {}

  /** Tạo mẫu sơ đồ (operatorId = null: thư viện dùng chung). Mỗi lần tạo cùng `code` là một phiên bản mới. */
  async create(operatorId: string | null, input: CreateLayoutInput, q: Queryable = this.db): Promise<SeatLayoutRow> {
    const data = createLayoutSchema.parse(input);
    const parsed = parseLayout(data.definition, data.kind);
    const exec = async (c: Queryable) => {
      // Khóa theo (nhà xe, mã) để hai lần tạo cùng lúc không sinh trùng phiên bản.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`layout:${operatorId ?? '-'}:${data.code}`]);
      const { rows: vr } = await c.query<{ next: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM seat_layouts
         WHERE operator_id IS NOT DISTINCT FROM $1 AND code = $2`,
        [operatorId, data.code],
      );
      const { rows } = await c.query<SeatLayoutRow>(
        `INSERT INTO seat_layouts (operator_id, code, version, name, unit, kind, definition, capacity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [operatorId, data.code, vr[0]!.next, data.name, data.unit, data.kind, JSON.stringify(data.definition), parsed.capacity],
      );
      const layout = rows[0]!;
      await c.query(
        `INSERT INTO seats (seat_layout_id, code, floor, row_idx, col_idx, max_occupancy, sellable)
         SELECT $1, s.code, s.floor, s.row_idx, s.col_idx, s.max_occupancy, s.sellable
         FROM jsonb_to_recordset($2::jsonb)
           AS s(code text, floor text, row_idx int, col_idx int, max_occupancy int, sellable boolean)`,
        [
          layout.id,
          JSON.stringify(
            parsed.seats.map((s) => ({
              code: s.code,
              floor: s.floor,
              row_idx: s.row,
              col_idx: s.col,
              max_occupancy: s.maxOccupancy,
              sellable: s.sellable,
            })),
          ),
        ],
      );
      return layout;
    };
    return q === this.db ? this.db.tx(exec) : exec(q);
  }

  /** Bảo đảm thư viện mẫu dùng chung có ít nhất phiên bản 1. Trả về map code → bản mới nhất. */
  async ensureLibrary(q: Queryable = this.db): Promise<Map<string, SeatLayoutRow>> {
    if (q === this.db) return this.db.tx((c) => this.ensureLibrary(c));
    // Khóa trước khi kiểm tra để hai nhà xe tạo cùng lúc không sinh thêm phiên bản thư viện.
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['layout-library']);
    const result = new Map<string, SeatLayoutRow>();
    for (const lib of LIBRARY_LAYOUTS) {
      let row = await this.latest(null, lib.code, q);
      if (!row) row = await this.create(null, { ...lib, definition: lib.definition }, q);
      result.set(lib.code, row);
    }
    return result;
  }

  async latest(operatorId: string | null, code: string, q: Queryable = this.db): Promise<SeatLayoutRow | null> {
    const { rows } = await q.query<SeatLayoutRow>(
      `SELECT * FROM seat_layouts WHERE operator_id IS NOT DISTINCT FROM $1 AND code = $2
       ORDER BY version DESC LIMIT 1`,
      [operatorId, code],
    );
    return rows[0] ?? null;
  }

  /** Lấy sơ đồ mà nhà xe được dùng: của chính nhà xe đó hoặc thư viện dùng chung. */
  async getUsable(operatorId: string, layoutId: string, q: Queryable = this.db): Promise<SeatLayoutRow> {
    if (!isUuid(operatorId) || !isUuid(layoutId)) throw notFound('mẫu sơ đồ');
    const { rows } = await q.query<SeatLayoutRow>(
      `SELECT * FROM seat_layouts WHERE id = $1 AND (operator_id = $2 OR operator_id IS NULL)`,
      [layoutId, operatorId],
    );
    if (!rows[0]) throw notFound('mẫu sơ đồ');
    return rows[0];
  }

  assertKind(layout: SeatLayoutRow, kind: LayoutKind): void {
    if (layout.kind !== kind) {
      throw new DomainError('VALIDATION_FAILED', `Mẫu sơ đồ "${layout.name}" không khớp loại xe.`, {
        layoutKind: layout.kind,
        expected: kind,
      });
    }
  }
}
