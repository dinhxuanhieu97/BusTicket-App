import { vnDate } from "./time";

const DAY_MS = 24 * 60 * 60 * 1000;

interface DepartingTrip {
  departAt: string;
  route: { origin: string; destination: string };
}

/**
 * Ngày đi sớm nhất được chọn (giờ VN): hôm nay nếu còn chuyến hôm nay chưa xuất bến
 * (khớp điểm đi/đến nếu đã chọn), ngược lại là ngày mai. Ngày trước đó luôn bị khóa.
 * `todayTrips` chưa tải xong thì tạm cho chọn hôm nay; trang kết quả vẫn chỉ hiện chuyến còn bán.
 */
export function earliestTravelDate(
  now: Date,
  todayTrips: DepartingTrip[] | undefined,
  origin = "",
  destination = "",
): string {
  const today = vnDate(now);
  if (!todayTrips) return today;
  const left = todayTrips.some(
    (t) =>
      Date.parse(t.departAt) > now.getTime() &&
      (!origin || t.route.origin === origin) &&
      (!destination || t.route.destination === destination),
  );
  return left ? today : vnDate(new Date(now.getTime() + DAY_MS));
}

/** `YYYY-MM-DD` của ô lịch (Date theo giờ máy, nửa đêm ngày đó). */
export function calendarYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Ngược lại của `calendarYmd`: Date nửa đêm theo giờ máy để đưa vào Calendar. */
export function ymdToCalendarDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "Tháng 11/2026": luôn dương lịch, không phụ thuộc lịch/ngôn ngữ của điện thoại. */
export function monthTitle(d: Date): string {
  return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
}
