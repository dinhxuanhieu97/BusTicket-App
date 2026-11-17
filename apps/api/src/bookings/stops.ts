import { DomainError } from '../common/errors';

/** Một điểm đón/trả của chuyến (giờ theo ngày khởi hành + `day`, giờ Việt Nam). */
export interface StopPoint {
  name: string;
  time: string;
  day: number;
}
export interface TripStops {
  pickup: StopPoint[];
  dropoff: StopPoint[];
}

const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');

/**
 * Tìm điểm đón/trả theo tên trong danh sách điểm của chuyến (không phân biệt hoa thường/khoảng trắng thừa)
 * và trả bản chụp `{name, time, day}` để lưu vào đơn. Tên rỗng/không gửi → null.
 */
export function resolveStop(stops: TripStops | null | undefined, kind: 'pickup' | 'dropoff', name: string | null | undefined): StopPoint | null {
  const wanted = name ? norm(name) : '';
  if (!wanted) return null;
  const list = stops?.[kind] ?? [];
  const found = list.find((s) => norm(s.name) === wanted);
  if (!found) {
    const label = kind === 'pickup' ? 'Điểm đón' : 'Điểm trả';
    throw new DomainError(
      'VALIDATION_FAILED',
      list.length ? `${label} "${name!.trim()}" không có trong tuyến của chuyến.` : `Tuyến của chuyến chưa có danh sách ${label.toLowerCase()}.`,
      { field: kind === 'pickup' ? 'pickupStop' : 'dropoffStop' },
    );
  }
  return { name: found.name, time: found.time, day: found.day };
}
