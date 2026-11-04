import { useEffect, useState } from "react";

/** Thời điểm hiện tại, cập nhật mỗi `intervalMs` khi `active` (dùng cho đồng hồ đếm ngược giữ chỗ). */
export function useNow(active: boolean, intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return undefined;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
