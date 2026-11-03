import { z } from 'zod';
import { DomainError } from '../common/errors';

export type LayoutKind = 'room' | 'bed' | 'seat';

/**
 * Định nghĩa sơ đồ: mỗi tầng là các hàng chuỗi, ô cách nhau bằng dấu cách.
 * `A01` = chỗ (chữ cái đầu = mã tầng), `.` = lối đi, `_` = ô trống. Xem docs/DOI-XE-SO-DO-CHO.md mục 3.
 */
export const layoutDefinitionSchema = z
  .object({
    floors: z
      .array(
        z
          .object({
            code: z.string().regex(/^[A-Z]$/, 'Mã tầng là một chữ cái in hoa'),
            label: z.string().trim().min(1).max(40),
            rows: z.array(z.string().max(200)).min(1).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    defaultMaxOccupancy: z.union([z.literal(1), z.literal(2)]).optional(),
    seatOverrides: z
      .record(
        z.string(),
        z
          .object({ maxOccupancy: z.union([z.literal(1), z.literal(2)]).optional(), sellable: z.boolean().optional() })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type LayoutDefinition = z.infer<typeof layoutDefinitionSchema>;

export interface ParsedSeat {
  code: string;
  floor: string;
  row: number;
  col: number;
  maxOccupancy: 1 | 2;
  sellable: boolean;
}

export interface ParsedLayout {
  seats: ParsedSeat[];
  /** Số chỗ/phòng (kể cả chỗ không bán). */
  capacity: number;
}

const SEAT_TOKEN = /^[A-Z]\d{2}$/;
const MAX_COLS = 12;

function invalid(message: string, details?: unknown): DomainError {
  return new DomainError('INVALID_LAYOUT', message, details);
}

/** Đọc và kiểm tra sơ đồ; ném `INVALID_LAYOUT` kèm chi tiết khi sai. */
export function parseLayout(input: unknown, kind: LayoutKind): ParsedLayout {
  const parsed = layoutDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw invalid(
      'Sơ đồ không đúng định dạng.',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const def = parsed.data;
  const defaultOcc = def.defaultMaxOccupancy ?? 1;
  if (kind !== 'room' && defaultOcc !== 1) throw invalid('Chỉ sơ đồ phòng (Limousine) mới cho phép 2 người một chỗ.');

  const floorCodes = def.floors.map((f) => f.code);
  if (new Set(floorCodes).size !== floorCodes.length) throw invalid('Mã tầng bị trùng.', { floors: floorCodes });

  const seats: ParsedSeat[] = [];
  const seen = new Set<string>();
  def.floors.forEach((floor) => {
    floor.rows.forEach((rowText, row) => {
      const tokens = rowText.trim().split(/\s+/);
      if (tokens.length > MAX_COLS) throw invalid(`Hàng ${row + 1} tầng ${floor.code} có quá ${MAX_COLS} ô.`);
      tokens.forEach((token, col) => {
        if (token === '.' || token === '_') return;
        if (!SEAT_TOKEN.test(token)) {
          throw invalid(`Ô "${token}" không hợp lệ (dạng A01, "." hoặc "_").`, { floor: floor.code, row: row + 1 });
        }
        if (token[0] !== floor.code) throw invalid(`Chỗ ${token} không thuộc tầng ${floor.code}.`, { seat: token });
        if (seen.has(token)) throw invalid(`Mã chỗ ${token} bị trùng.`, { seat: token });
        seen.add(token);
        seats.push({ code: token, floor: floor.code, row, col, maxOccupancy: defaultOcc, sellable: true });
      });
    });
  });
  if (seats.length === 0) throw invalid('Sơ đồ phải có ít nhất một chỗ.');

  for (const [code, o] of Object.entries(def.seatOverrides ?? {})) {
    const seat = seats.find((s) => s.code === code);
    if (!seat) throw invalid(`Thiết lập riêng cho chỗ ${code} nhưng sơ đồ không có chỗ này.`, { seat: code });
    if (o.maxOccupancy !== undefined) {
      if (kind !== 'room' && o.maxOccupancy !== 1) throw invalid(`Chỗ ${code}: chỉ phòng mới cho phép 2 người.`);
      seat.maxOccupancy = o.maxOccupancy;
    }
    if (o.sellable !== undefined) seat.sellable = o.sellable;
  }
  if (!seats.some((s) => s.sellable)) throw invalid('Sơ đồ phải có ít nhất một chỗ bán được.');

  return { seats, capacity: seats.length };
}
