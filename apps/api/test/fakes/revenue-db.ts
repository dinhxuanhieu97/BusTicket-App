import type { Db } from '../../src/db/db';

type Amount = { date: string; amount: number; count: number };
type RouteRow = { id: string; code: string; origin: string; destination: string; amount: number; bookings: number };

/**
 * DB giả cho `ReportsService.revenue` (unit test): nhận diện 7 truy vấn theo nội dung SQL và trả hàng đã cho.
 * Ghi lại mọi truy vấn để kiểm tham số (nhà xe, khoảng ngày).
 */
export function fakeRevenueDb(data: {
  days?: Amount[];
  methods?: { method: string; amount: number; count: number }[];
  hours?: { hour: number; amount: number; count: number }[];
  refunds?: Amount[];
  routes?: RouteRow[];
  routeRefunds?: RouteRow[];
  allocated?: number;
}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const pick = (sql: string) => {
    if (/payment_allocations/.test(sql) && /ROUTE|legs|shares/i.test(sql) && /payments p/.test(sql)) return data.routes ?? [];
    if (/refund_obligations/.test(sql) && /shares/i.test(sql)) return data.routeRefunds ?? [];
    if (/COALESCE\(SUM\(pa\.amount\)/.test(sql)) return [{ amount: data.allocated ?? 0 }];
    if (/FROM refund_obligations/.test(sql)) return data.refunds ?? [];
    if (/AS hour/.test(sql)) return data.hours ?? [];
    if (/SELECT method/.test(sql)) return data.methods ?? [];
    return data.days ?? [];
  };
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const rows = pick(sql);
      return { rows, rowCount: rows.length };
    }),
  };
  return { db: db as unknown as Db, calls };
}
