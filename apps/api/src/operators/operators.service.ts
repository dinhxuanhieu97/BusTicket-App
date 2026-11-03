import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { OPERATOR_CODE } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { Db, isPgError, PG_UNIQUE_VIOLATION, Queryable } from '../db/db';
import { SeatLayoutsService } from '../seat-layouts/seat-layouts.service';
import { DEFAULT_POLICY, OperatorPolicy, PolicyInput, policyInputSchema } from './policy';

export interface OperatorRow {
  id: string;
  code: string;
  name: string;
}

export const createOperatorSchema = z
  .object({
    code: z.string().regex(OPERATOR_CODE, 'Tiền tố mã là 2–4 chữ cái in hoa'),
    name: z.string().trim().min(1).max(120),
  })
  .strict();
export type CreateOperatorInput = z.infer<typeof createOperatorSchema>;

/** Xe tạo sẵn khi thêm nhà xe mới (docs/NEN-TANG-DA-NHA-XE.md mục 1.4). */
const DEFAULT_VEHICLES = [
  { suffix: '01', name: 'Xe 01', type: 'LIMOUSINE', layout: 'LIMO24' },
  { suffix: '02', name: 'Xe 02', type: 'SLEEPER', layout: 'BED36' },
] as const;

@Injectable()
export class OperatorsService {
  constructor(
    private readonly db: Db,
    private readonly layouts: SeatLayoutsService,
  ) {}

  /** Tạo nhà xe + chính sách mặc định (phiên bản 1) + 2 xe mặc định, trong một transaction. */
  async create(input: CreateOperatorInput): Promise<OperatorRow> {
    const data = createOperatorSchema.parse(input);
    try {
      return await this.db.tx(async (c) => {
        const { rows } = await c.query<OperatorRow>(
          'INSERT INTO operators (code, name) VALUES ($1, $2) RETURNING id, code, name',
          [data.code, data.name],
        );
        const op = rows[0]!;
        await this.insertPolicy(c, op.id, 1, DEFAULT_POLICY);
        const library = await this.layouts.ensureLibrary(c);
        for (const v of DEFAULT_VEHICLES) {
          await c.query(
            `INSERT INTO vehicles (operator_id, code, name, type, seat_layout_id) VALUES ($1, $2, $3, $4, $5)`,
            [op.id, op.code + v.suffix, v.name, v.type, library.get(v.layout)!.id],
          );
        }
        return op;
      });
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) {
        throw new DomainError('CONFLICT', `Tiền tố mã ${data.code} đã được dùng hoặc mã xe bị trùng.`, { code: data.code });
      }
      throw e;
    }
  }

  async list(): Promise<(OperatorRow & { created_at: Date })[]> {
    const { rows } = await this.db.query<OperatorRow & { created_at: Date }>(
      'SELECT id, code, name, created_at FROM operators ORDER BY code',
    );
    return rows;
  }

  async getByCode(code: string, q: Queryable = this.db): Promise<OperatorRow> {
    const { rows } = await q.query<OperatorRow>('SELECT id, code, name FROM operators WHERE code = $1', [code]);
    if (!rows[0]) throw notFound('nhà xe');
    return rows[0];
  }

  async getById(id: string, q: Queryable = this.db): Promise<OperatorRow> {
    if (!isUuid(id)) throw notFound('nhà xe');
    const { rows } = await q.query<OperatorRow>('SELECT id, code, name FROM operators WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('nhà xe');
    return rows[0];
  }

  /** Chính sách đang áp dụng = phiên bản mới nhất. */
  async currentPolicy(operatorId: string, q: Queryable = this.db): Promise<OperatorPolicy> {
    if (!isUuid(operatorId)) throw notFound('chính sách của nhà xe');
    const { rows } = await q.query<{
      version: number;
      hold_minutes: number;
      max_units_per_booking: number;
      child_policy: OperatorPolicy['childPolicy'];
    }>(
      `SELECT version, hold_minutes, max_units_per_booking, child_policy FROM operator_policies
       WHERE operator_id = $1 ORDER BY version DESC LIMIT 1`,
      [operatorId],
    );
    const r = rows[0];
    if (!r) throw notFound('chính sách của nhà xe');
    return {
      operatorId,
      version: r.version,
      holdMinutes: r.hold_minutes,
      maxUnitsPerBooking: r.max_units_per_booking,
      childPolicy: r.child_policy,
    };
  }

  /** Cập nhật chính sách = thêm phiên bản mới; đơn cũ giữ bản đã chụp. */
  async updatePolicy(operatorId: string, input: PolicyInput): Promise<OperatorPolicy> {
    const data = policyInputSchema.parse(input);
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    return this.db.tx(async (c) => {
      // NO KEY UPDATE: tuần tự hóa các lần cập nhật chính sách mà không chặn các bản ghi có FK tới nhà xe.
      const { rows } = await c.query<{ id: string }>(
        'SELECT id FROM operators WHERE id = $1 FOR NO KEY UPDATE',
        [operatorId],
      );
      if (!rows[0]) throw notFound('nhà xe');
      const current = await this.currentPolicy(operatorId, c);
      await this.insertPolicy(c, operatorId, current.version + 1, data);
      return this.currentPolicy(operatorId, c);
    });
  }

  private async insertPolicy(c: Queryable, operatorId: string, version: number, p: PolicyInput): Promise<void> {
    await c.query(
      `INSERT INTO operator_policies (operator_id, version, hold_minutes, max_units_per_booking, child_policy)
       VALUES ($1, $2, $3, $4, $5)`,
      [operatorId, version, p.holdMinutes, p.maxUnitsPerBooking, JSON.stringify(p.childPolicy)],
    );
  }
}
