/** Việt Nam không có giờ mùa hè: UTC+7 cố định (giống apps/api/src/common/vn-time.ts). */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Ngày lịch `YYYY-MM-DD` theo giờ Việt Nam, bất kể múi giờ của máy khách. */
export function vnDate(at: Date): string {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export interface DayOption {
  date: string;
  label: string;
  sub: string;
}

/** `count` ngày liên tiếp kể từ hôm nay (giờ VN) cho thanh chọn ngày. */
export function upcomingDays(now: Date, count: number): DayOption[] {
  return Array.from({ length: count }, (_, i) => {
    const shifted = new Date(now.getTime() + VN_OFFSET_MS + i * DAY_MS);
    const date = shifted.toISOString().slice(0, 10);
    const label = i === 0 ? "Hôm nay" : i === 1 ? "Ngày mai" : WEEKDAYS[shifted.getUTCDay()];
    return { date, label, sub: `${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}` };
  });
}

/** "18:00" theo giờ VN. */
export function formatVnTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + VN_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "T4, 05/11/2026" theo giờ VN. */
export function formatVnDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + VN_OFFSET_MS);
  return `${WEEKDAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** Số giây còn lại đến `expiresAt` (không âm). Đồng hồ đếm ngược lấy mốc từ máy chủ, không tự tính. */
export function secondsLeft(expiresAt: string | null, now: Date): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000));
}

/** "09:05" (phút:giây). */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
