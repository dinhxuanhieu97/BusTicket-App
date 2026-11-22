import { z } from 'zod';
import { vnDayRange } from '../common/vn-time';
import { DomainError } from '../common/errors';

export const adminTripQuerySchema = z
  .object({
    from: z.string(),
    to: z.string(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(150).optional(),
    /** Mã tuyến (routes.code) để lọc; tuyến không thuộc nhà xe → danh sách rỗng. */
    route: z.string().regex(/^[A-Z0-9-]{2,32}$/).optional(),
    /** T2: sắp xếp toàn khoảng theo một cột; mặc định giờ khởi hành tăng dần (phân trang con trỏ như cũ). */
    sort: z.enum(['depart', 'code', 'name', 'route', 'vehicle', 'available', 'capacity', 'status']).default('depart'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export type AdminTripSort = z.output<typeof adminTripQuerySchema>['sort'];
/** Vị trí tối đa khi phân trang theo thứ tự khác mặc định (khoảng 366 ngày không có quá số chuyến này). */
const MAX_OFFSET = 100_000;
export function adminTripRange(input: unknown) {
  const q = adminTripQuerySchema.parse(input);
  const start = vnDayRange(q.from).start;
  const end = vnDayRange(q.to).start;
  if (end <= start || end.getTime() - start.getTime() > 366 * 86400000)
    throw new DomainError('VALIDATION_FAILED', 'Khoảng xem phải từ 1 đến 366 ngày.');
  let after: { at: string; id: string } | null = null;
  let offset = 0;
  const keyset = q.sort === 'depart' && q.order === 'asc';
  if (q.cursor && !keyset) {
    // Thứ tự khác mặc định: con trỏ "o:<cột>:<chiều>:<vị trí>" phải khớp đúng cách sắp xếp đang xin.
    const m = /^o:([a-z]+):(asc|desc):(\d{1,6})$/.exec(q.cursor);
    if (!m || m[1] !== q.sort || m[2] !== q.order || Number(m[3]) > MAX_OFFSET)
      throw new DomainError('VALIDATION_FAILED', 'Vị trí phân trang không hợp lệ.');
    offset = Number(m[3]);
  } else if (q.cursor) {
    const [at, id, extra] = q.cursor.split('|');
    const parsed = z.object({ at: z.string().datetime(), id: z.string().uuid() }).safeParse({ at, id });
    if (extra !== undefined || !parsed.success || new Date(parsed.data.at) < start || new Date(parsed.data.at) >= end)
      throw new DomainError('VALIDATION_FAILED', 'Vị trí phân trang không hợp lệ.');
    after = parsed.data;
  }
  return { ...q, start, end, after, offset, keyset };
}
