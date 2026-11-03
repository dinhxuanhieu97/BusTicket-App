import type { LayoutDefinition, LayoutKind } from './layout-parser';

export interface LibraryLayout {
  code: string;
  name: string;
  unit: string;
  kind: LayoutKind;
  definition: LayoutDefinition;
}

/**
 * Thư viện mẫu sơ đồ dùng chung, dựng theo ảnh trong `Images/`:
 * - BED40: `Images/40-GIUONG.webp` — 3 dãy A/B/C × 5 hàng + dãy D cuối xe; số lẻ tầng dưới, số chẵn tầng trên.
 * - LIMO24: `Images/so-do-giường-mẫu-tham-khảo-2.jpeg` — A1–A12 tầng 1, B1–B12 tầng 2.
 * - SEAT29: mẫu minh họa (chưa có ảnh thật).
 * Nhà xe có cách đánh số khác thì tạo mẫu riêng của mình.
 */
export const LIBRARY_LAYOUTS: LibraryLayout[] = [
  {
    code: 'BED40',
    name: 'Giường nằm 40 chỗ',
    unit: 'giường',
    kind: 'bed',
    definition: {
      floors: [
        {
          code: '1',
          label: 'Tầng dưới',
          rows: ['TX . _ . CUA', 'A1 . B1 . C1', 'A3 . B3 . C3', 'A5 . B5 . C5', 'A7 . B7 . C7', 'A9 . B9 . C9', 'D1 D2 D3 D4 D5'],
        },
        {
          code: '2',
          label: 'Tầng trên',
          rows: ['A2 . B2 . C2', 'A4 . B4 . C4', 'A6 . B6 . C6', 'A8 . B8 . C8', 'A10 . B10 . C10', 'D6 D7 D8 D9 D10'],
        },
      ],
    },
  },
  {
    code: 'LIMO24',
    name: 'Limousine 24 phòng',
    unit: 'phòng',
    kind: 'room',
    definition: {
      defaultMaxOccupancy: 2,
      floors: [
        {
          code: '1',
          label: 'Tầng dưới',
          rows: ['TX . CUA', ...Array.from({ length: 6 }, (_, r) => `A${2 * r + 1} . A${2 * r + 2}`)],
        },
        { code: '2', label: 'Tầng trên', rows: Array.from({ length: 6 }, (_, r) => `B${2 * r + 1} . B${2 * r + 2}`) },
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
          code: '1',
          label: 'Khoang khách',
          rows: [
            'TX _ . _ CUA',
            ...Array.from({ length: 6 }, (_, r) => {
              const c = (i: number) => `A${r * 4 + i}`;
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
