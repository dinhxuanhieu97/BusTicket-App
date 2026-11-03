import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DomainError, notFound } from '../common/errors';
import { isUuid } from '../common/ids';
import { Db, isPgError, PG_UNIQUE_VIOLATION } from '../db/db';
import { VEHICLE_TYPE_KIND } from '../seat-layouts/library';
import { SeatLayoutsService } from '../seat-layouts/seat-layouts.service';

export interface VehicleRow {
  id: string;
  operator_id: string;
  code: string;
  name: string;
  type: keyof typeof VEHICLE_TYPE_KIND;
  plate_number: string | null;
  seat_layout_id: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';
}

export const createVehicleSchema = z
  .object({
    code: z.string().regex(/^[A-Z]{2,4}\d{2,3}$/, 'Mã xe = tiền tố nhà xe + 2–3 chữ số, ví dụ PN03'),
    name: z.string().trim().min(1).max(60).transform((v) => v.normalize('NFC')),
    type: z.enum(['LIMOUSINE', 'SLEEPER', 'SEATER']),
    seatLayoutId: z.string().uuid(),
    plateNumber: z.string().trim().max(20).optional(),
  })
  .strict();
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object({
    name: z.string().trim().min(1).max(60).transform((v) => v.normalize('NFC')).optional(),
    plateNumber: z.string().trim().max(20).nullable().optional(),
    status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']).optional(),
    seatLayoutId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Không có thay đổi nào');

/** Biển số: bỏ khoảng trắng thừa, viết hoa; rỗng → null. */
function normalizePlate(v: string | null | undefined): string | null {
  const t = (v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return t === '' ? null : t;
}

@Injectable()
export class VehiclesService {
  constructor(
    private readonly db: Db,
    private readonly layouts: SeatLayoutsService,
  ) {}

  async list(operatorId: string): Promise<VehicleRow[]> {
    if (!isUuid(operatorId)) return [];
    const { rows } = await this.db.query<VehicleRow>(
      'SELECT * FROM vehicles WHERE operator_id = $1 ORDER BY code',
      [operatorId],
    );
    return rows;
  }

  async get(operatorId: string, vehicleId: string): Promise<VehicleRow> {
    if (!isUuid(operatorId) || !isUuid(vehicleId)) throw notFound('xe');
    const { rows } = await this.db.query<VehicleRow>('SELECT * FROM vehicles WHERE id = $1 AND operator_id = $2', [
      vehicleId,
      operatorId,
    ]);
    if (!rows[0]) throw notFound('xe');
    return rows[0];
  }

  async create(operatorId: string, input: CreateVehicleInput): Promise<VehicleRow> {
    const data = createVehicleSchema.parse(input);
    if (!isUuid(operatorId)) throw notFound('nhà xe');
    const { rows: ops } = await this.db.query<{ code: string }>('SELECT code FROM operators WHERE id = $1', [operatorId]);
    if (!ops[0]) throw notFound('nhà xe');
    const prefix = ops[0].code;
    if (!data.code.startsWith(prefix) || !/^\d{2,3}$/.test(data.code.slice(prefix.length))) {
      throw new DomainError('VALIDATION_FAILED', `Mã xe phải bắt đầu bằng tiền tố ${prefix} và theo sau là 2–3 chữ số.`, {
        field: 'code',
      });
    }
    const layout = await this.layouts.getUsable(operatorId, data.seatLayoutId);
    this.layouts.assertKind(layout, VEHICLE_TYPE_KIND[data.type]);
    try {
      const { rows } = await this.db.query<VehicleRow>(
        `INSERT INTO vehicles (operator_id, code, name, type, plate_number, seat_layout_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [operatorId, data.code, data.name, data.type, normalizePlate(data.plateNumber), layout.id],
      );
      return rows[0]!;
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new DomainError('CONFLICT', 'Mã xe hoặc tên xe đã tồn tại.');
      throw e;
    }
  }

  /**
   * Sửa xe. Đổi mẫu sơ đồ chỉ ảnh hưởng chuyến tạo sau đó (chuyến cũ đã chụp sơ đồ).
   * Khóa hàng xe để không chạy đua với tạo chuyến (tạo chuyến khóa FOR SHARE).
   */
  async update(operatorId: string, vehicleId: string, input: z.input<typeof updateVehicleSchema>): Promise<VehicleRow> {
    const data = updateVehicleSchema.parse(input);
    if (!isUuid(operatorId) || !isUuid(vehicleId)) throw notFound('xe');
    try {
      return await this.db.tx(async (c) => {
        const { rows } = await c.query<VehicleRow>('SELECT * FROM vehicles WHERE id = $1 AND operator_id = $2 FOR UPDATE', [
          vehicleId, operatorId,
        ]);
        const v = rows[0];
        if (!v) throw notFound('xe');
        let layoutId = v.seat_layout_id;
        if (data.seatLayoutId) {
          const layout = await this.layouts.getUsable(operatorId, data.seatLayoutId, c);
          this.layouts.assertKind(layout, VEHICLE_TYPE_KIND[v.type]);
          layoutId = layout.id;
        }
        const plate = data.plateNumber === undefined ? v.plate_number : normalizePlate(data.plateNumber);
        const { rows: updated } = await c.query<VehicleRow>(
          `UPDATE vehicles SET name = $3, plate_number = $4, status = $5, seat_layout_id = $6
           WHERE id = $1 AND operator_id = $2 RETURNING *`,
          [vehicleId, operatorId, data.name ?? v.name, plate, data.status ?? v.status, layoutId],
        );
        return updated[0]!;
      });
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new DomainError('CONFLICT', 'Tên xe đã tồn tại.');
      throw e;
    }
  }
}
