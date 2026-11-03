import type { LayoutDefinition, LayoutKind } from './layout-parser';

export interface LibraryLayout {
  code: string;
  name: string;
  unit: string;
  kind: LayoutKind;
  definition: LayoutDefinition;
}

const rows = (floor: string, perRow: number, count: number, aisle = true): string[] => {
  const out: string[] = [];
  let n = 1;
  for (let r = 0; r < count; r++) {
    const cells: string[] = [];
    for (let c = 0; c < perRow; c++) {
      cells.push(`${floor}${String(n++).padStart(2, '0')}`);
      if (aisle && c < perRow - 1) cells.push('.');
    }
    out.push(cells.join(' '));
  }
  return out;
};

/**
 * Thư viện mẫu sơ đồ dùng chung (dữ liệu minh họa — sơ đồ thật thay khi có ảnh trong `Images/`).
 * Giống bản mẫu `prototype/so-do-cho.html`.
 */
export const LIBRARY_LAYOUTS: LibraryLayout[] = [
  {
    code: 'LIMO24',
    name: 'Limousine 24 phòng',
    unit: 'phòng',
    kind: 'room',
    definition: {
      defaultMaxOccupancy: 2,
      floors: [
        { code: 'A', label: 'Tầng dưới', rows: rows('A', 2, 6) },
        { code: 'B', label: 'Tầng trên', rows: rows('B', 2, 6) },
      ],
    },
  },
  {
    code: 'BED36',
    name: 'Giường nằm 36 chỗ',
    unit: 'giường',
    kind: 'bed',
    definition: {
      floors: [
        { code: 'A', label: 'Tầng dưới', rows: rows('A', 3, 6) },
        { code: 'B', label: 'Tầng trên', rows: rows('B', 3, 6) },
      ],
    },
  },
  {
    code: 'SEAT29',
    name: 'Ghế ngồi 29 chỗ',
    unit: 'ghế',
    kind: 'seat',
    definition: {
      floors: [
        {
          code: 'A',
          label: 'Khoang khách',
          rows: [
            ...Array.from({ length: 6 }, (_, r) => {
              const b = r * 4;
              const c = (i: number) => `A${String(b + i).padStart(2, '0')}`;
              return `${c(1)} ${c(2)} . ${c(3)} ${c(4)}`;
            }),
            'A25 A26 A27 A28 A29',
          ],
        },
      ],
    },
  },
];

/** Loại xe ↔ kiểu sơ đồ phải khớp. */
export const VEHICLE_TYPE_KIND = { LIMOUSINE: 'room', SLEEPER: 'bed', SEATER: 'seat' } as const;
export type VehicleType = keyof typeof VEHICLE_TYPE_KIND;
