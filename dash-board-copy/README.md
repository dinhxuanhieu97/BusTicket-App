# dash-board-copy: bản mẫu trang quản trị nhà xe

Bản mẫu giao diện tĩnh (HTML/CSS/JS thuần, dữ liệu giả) để duyệt bố cục trước khi làm trang quản trị thật (task T12).
Bố cục lấy cảm hứng từ dashboard kiểu nền tối kính mờ (thanh bên, thẻ số liệu có biểu đồ nhỏ, thao tác nhanh); toàn bộ mã trong thư mục này được viết mới, không chứa mã hay hình ảnh của template bên thứ ba.

## Chạy local
Mở thẳng `index.html` bằng trình duyệt, hoặc chạy một server tĩnh:

```bash
npx serve dash-board-copy
```

## Các trang
Tổng quan · Chuyến xe · Sơ đồ chỗ · Tuyến & điểm đón · Xe · Doanh thu · Thanh toán · Nhân viên · Nhật ký · Cài đặt · Trợ giúp

Có giao diện sáng/tối (nút mặt trời), thu gọn thanh bên, phím tắt ⌘K / Ctrl+K để tìm kiếm, và bố cục điện thoại với thanh điều hướng dưới.
Các nút thao tác chỉ hiện thông báo minh họa, chưa gọi API.
