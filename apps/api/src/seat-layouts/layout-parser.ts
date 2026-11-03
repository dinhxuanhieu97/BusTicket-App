import { z } from 'zod';
import { DomainError } from '../common/errors';

export type LayoutKind = 'room' | 'bed' | 'seat';

/**
 * Định nghĩa sơ đồ: mỗi tầng (`1` = tầng dưới, `2` = tầng trên) là các hàng chuỗi, ô cách nhau bằng dấu cách,
 * liệt kê từ đầu xe về cuối xe, trái sang phải khi nhìn theo hướng xe chạy.
 * - Chỗ: mã theo cách nhà xe đang dán trên xe, 1–2 chữ cái + 1–2 chữ số (A1, B10, D6…). Tầng của chỗ là tầng chứa nó,
 *   không suy ra từ mã (xe 40 giường đánh theo dãy: A1 tầng dưới, A2 tầng trên — xem Images/40-GIUONG.webp).
 * - Ô không phải chỗ: `.` lối đi, `_` ô trống, `TX` tài xế, `CUA` cửa lên xuống, `WC` nhà vệ sinh.
 * Xem docs/DOI-XE-SO-DO-CHO.md mục 3.
 */
export const layoutDefinitionSchema = z
  .object({
    floors: z
      .array(
        z
          .object({
            code: z.string().regex(/^[1-3]$/, 'Mã tầng là 1 (dưới), 2 (trên) hoặc 3'),
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

/** 1–2 chữ cái + số 1–99, không có số 0 đứng đầu (để "A01" và "A1" không thể cùng tồn tại). */
export const SEAT_CODE = /^[A-Z]{1,2}[1-9]\d?$/;
/** Ô đánh dấu, không bán: lối đi, ô trống, tài xế, cửa, nhà vệ sinh. */
export const MARKER_TOKENS: ReadonlySet<string> = new Set(['.', '_', 'TX', 'CUA', 'WC']);
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
        if (MARKER_TOKENS.has(token)) return;
        if (!SEAT_CODE.test(token)) {
          throw invalid(`Ô "${token}" không hợp lệ (mã chỗ như A1/B10, hoặc ".", "_", "TX", "CUA", "WC").`, {
            floor: floor.code,
            row: row + 1,
          });
        }
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
