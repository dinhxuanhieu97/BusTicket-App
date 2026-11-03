import { DomainError } from '../common/errors';
import type { ChildPolicy } from '../operators/policy';

export interface RequestedItem {
  seatCode: string;
  occupancy: number;
  infantCount: number;
}

export interface SeatInfo {
  seatCode: string;
  floor: string;
  maxOccupancy: number;
}

export interface Fare {
  floor: string;
  occupancy: number;
  price: number;
}

export interface PricedItem extends RequestedItem {
  unitPrice: number;
  infantPrice: number;
  lineTotal: number;
}

/**
 * Tính giá từng chỗ/phòng: giá theo (tầng, số người) + trẻ nằm chung theo chính sách.
 * Kiểm tra số người ≤ sức chứa và số trẻ ≤ giới hạn của chính sách.
 */
export function priceItems(
  items: RequestedItem[],
  seats: SeatInfo[],
  fares: Fare[],
  child: ChildPolicy,
): { items: PricedItem[]; total: number } {
  const seatBy = new Map(seats.map((s) => [s.seatCode, s]));
  const fareBy = new Map(fares.map((f) => [`${f.floor}:${f.occupancy}`, f.price]));
  const priced = items.map((it): PricedItem => {
    const seat = seatBy.get(it.seatCode);
    if (!seat) throw new DomainError('VALIDATION_FAILED', `Chuyến không có chỗ ${it.seatCode}.`, { seatCode: it.seatCode });
    if (it.occupancy < 1 || it.occupancy > seat.maxOccupancy) {
      throw new DomainError('VALIDATION_FAILED', `Chỗ ${it.seatCode} chỉ cho tối đa ${seat.maxOccupancy} người.`, {
        seatCode: it.seatCode,
      });
    }
    if (it.infantCount < 0 || it.infantCount > child.maxPerUnit) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `Mỗi chỗ chỉ được kèm tối đa ${child.maxPerUnit} trẻ dưới ${child.freeUnderAge} tuổi.`,
        { seatCode: it.seatCode },
      );
    }
    if (child.countsTowardCapacity && it.occupancy + it.infantCount > seat.maxOccupancy) {
      throw new DomainError('VALIDATION_FAILED', `Chỗ ${it.seatCode} vượt sức chứa khi tính cả trẻ em.`, {
        seatCode: it.seatCode,
      });
    }
    const unitPrice = fareBy.get(`${seat.floor}:${it.occupancy}`);
    if (unitPrice === undefined) {
      throw new DomainError('FARE_NOT_CONFIGURED', `Chưa có giá cho chỗ ${it.seatCode} với ${it.occupancy} người.`, {
        seatCode: it.seatCode,
      });
    }
    const infantPrice = child.price * it.infantCount;
    return { ...it, unitPrice, infantPrice, lineTotal: unitPrice + infantPrice };
  });
  return { items: priced, total: priced.reduce((s, i) => s + i.lineTotal, 0) };
}
