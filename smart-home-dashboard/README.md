# Hearth: template dashboard nhà thông minh

Template quản trị nhà thông minh viết bằng **React 19 + Vite + Tailwind CSS 4 + TypeScript**, có giao diện sáng/tối, kính mờ và dùng tốt trên điện thoại. Toàn bộ mã, nội dung và dữ liệu mẫu đều tự viết, có thể dùng và sửa tự do.

## Chạy local

```bash
cd smart-home-dashboard
npm install
npm run dev        # http://localhost:5173
```

Build bản tĩnh (thư mục `dist/`, mở được ở bất kỳ host tĩnh nào vì dùng hash router):

```bash
npm run build
npm run preview
```

## Các trang

| Đường dẫn | Nội dung |
|---|---|
| `#/` | Tổng quan: lời chào, trạng thái nhà, ngữ cảnh, vòng nhiệt độ, 4 thẻ số liệu, dải phòng |
| `#/rooms`, `#/rooms/:id` | Danh sách phòng, bật/tắt cả phòng, chi tiết phòng |
| `#/devices` | Lọc theo loại / phòng / trạng thái, tìm kiếm, xem dạng lưới hoặc bảng, thanh trượt mức |
| `#/climate` | Điều hòa chính, nhiệt độ theo phòng, lịch trong ngày |
| `#/energy` | Biểu đồ ngày/tuần/tháng có tooltip, thiết bị tốn điện nhất |
| `#/security` | Bật/tắt bảo vệ, camera, khóa cửa, nhật ký |
| `#/automations` | Quy tắc theo giờ / cảm biến / có người |
| `#/notifications`, `#/settings`, `#/help` | Thông báo, cài đặt, trợ giúp |

## Cấu trúc

```
src/
  index.css               màu sắc (CSS variables) cho sáng/tối + tiện ích glass
  data/mock.ts            dữ liệu mẫu: thay bằng API thật ở đây
  lib/home-store.tsx      trạng thái dùng chung (thiết bị, nhiệt độ, ngữ cảnh…)
  lib/theme.tsx, toast.tsx
  components/ui/          Card, Button, Toggle, Segmented, StatCard, Sparkline, AreaChart, Dial, Modal, RangeSlider, PageHeader
  components/layout/      Sidebar, Topbar, MobileNav, Layout, nav.ts (menu)
  pages/                  mỗi trang một file
```

## Tùy biến nhanh

- **Màu chủ đạo:** sửa `--accent` trong `src/index.css` (một giá trị cho sáng, một cho tối).
- **Menu:** sửa `src/components/layout/nav.ts`.
- **Dữ liệu thật:** thay các mảng trong `src/data/mock.ts` bằng lời gọi API, giữ nguyên kiểu `Room`, `Device`…
- **Phông chữ:** Manrope từ Google Fonts trong `index.html`.

Phím tắt: `⌘K` / `Ctrl+K` để tìm kiếm, `Esc` để đóng menu trên điện thoại. Các thông số trên giao diện đều là dữ liệu mẫu.
