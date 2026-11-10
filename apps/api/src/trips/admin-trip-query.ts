import { z } from 'zod';
import { vnDayRange } from '../common/vn-time';
import { DomainError } from '../common/errors';

export const adminTripQuerySchema = z
  .object({
    from: z.string(),
    to: z.string(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(150).optional(),
  })
  .strict();
export function adminTripRange(input: unknown) {
  const q = adminTripQuerySchema.parse(input);
  const start = vnDayRange(q.from).start;
  const end = vnDayRange(q.to).start;
  if (end <= start || end.getTime() - start.getTime() > 366 * 86400000)
    throw new DomainError('VALIDATION_FAILED', 'Khoảng xem phải từ 1 đến 366 ngày.');
  let after: { at: string; id: string } | null = null;
  if (q.cursor) {
    const [at, id, extra] = q.cursor.split('|');
    const parsed = z.object({ at: z.string().datetime(), id: z.string().uuid() }).safeParse({ at, id });
    if (extra !== undefined || !parsed.success || new Date(parsed.data.at) < start || new Date(parsed.data.at) >= end)
      throw new DomainError('VALIDATION_FAILED', 'Vị trí phân trang không hợp lệ.');
    after = parsed.data;
  }
  return { ...q, start, end, after };
}
