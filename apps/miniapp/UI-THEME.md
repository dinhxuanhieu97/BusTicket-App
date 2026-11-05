# UI khách hàng Phong Nhung

## Đổi màu và giao diện

Nguồn màu dùng chung: `src/css/theme.scss`.

- `--pn-primary-rgb: 11 99 206` là màu thương hiệu #0B63CE. Đổi một giá trị này để cập nhật header, nút, liên kết, giá, tab, màu nhạt và vòng focus.
- `--pn-on-primary`, `--pn-background`, `--pn-surface`, `--pn-text`, `--pn-muted`, `--pn-input-border`: chữ và nền.
- `--pn-success*`, `--pn-warning*`, `--pn-danger*`: trạng thái.
- `--pn-banner-wash`: lớp nền giúp đọc tiêu đề banner; màu trong ảnh minh họa không tự đổi khi đổi theme.
- `--pn-content-width`, `--pn-radius`, `--pn-control-radius`, `--pn-font`: chiều rộng, góc bo và font.

`src/tokens.js` ánh xạ primary/background/text sang CSS variables cho các component Tailwind hiện có. Các màn mới dùng chung `src/css/booking-ui.scss`; tránh đặt mã màu trực tiếp trong JSX.

## Nội dung và banner

Chữ trên UI tập trung trong `src/constants/copy.ts`. Banner nằm ở `src/components/home/banner-slider.tsx`, ảnh JPG đã tối ưu ở `public/images/` (tổng khoảng 407 KB), ảnh minh họa được tạo bằng imagegen. Hai chương trình cũng xuất hiện ở `/offers`.

Slider đổi sau 6,5 giây, tạm dừng khi hover/focus, hỗ trợ nút trước/sau và vuốt, không tự chạy khi người dùng chọn giảm chuyển động. Nội dung chữ được render bằng HTML, không nằm trong ảnh.

Hotline Phong Nhung là **0789893955**, có thể đổi qua `VITE_SUPPORT_PHONE`. Trang chương trình giải thích việc liên hệ trước hoặc ghi chú khi đặt vé, thanh toán bình thường và xuất trình giấy tờ cho phụ xe để được hoàn tiền. Ghi chú tối đa 500 ký tự được lưu cùng đơn qua migration `005_booking_note.sql`.

Khám phá lấy danh sách tuyến còn chỗ trong thời gian mở bán từ `GET /api/v1/operators/:operatorCode/open-routes`. Chọn một tuyến mở ngày có chuyến ở mức giá hiển thị.

## Các luồng đã nối

- `/`: tìm Một chiều/Khứ hồi, lọc tuyến từ chuyến mở bán theo ngày. Khứ hồi chọn chuyến đi rồi chuyến về, chọn ghế từng lượt và giữ chỗ cả hai trong một đơn. Giữ tiêu chí tìm trong phiên khi quay lại từ chọn chỗ/chi tiết đơn.
- `/my-bookings`: Tất cả/Chờ thanh toán; đơn đã xác nhận nhưng còn phải trả vẫn xuất hiện trong tab chờ. Lỗi tải trạng thái không khiến đơn biến mất.
- `/booking/:code`: hành trình, chỗ, tiền đã trả/còn phải trả, thời gian giữ chỗ, QR và sao chép thông tin chuyển khoản. QR được tải lại khi số tiền phải trả thay đổi. Lỗi tải QR vẫn giữ thông tin chuyển khoản.
- `/profile`: hồ sơ trên thiết bị; điền sẵn các trường còn trống ở checkout.
- `/passengers`: thêm/sửa/xóa người đi trên thiết bị; chọn người đã lưu trong checkout.
- `/offers`, `/offers/:slug`, `/support`: chương trình và liên hệ nhà xe.

Hồ sơ, sổ hành khách và danh sách vé lưu trong trình duyệt, chưa đồng bộ theo tài khoản Zalo. Không có API coupon; không mô phỏng giảm giá hay xác nhận miễn phí trong checkout.

## Kiểm tra

Từ thư mục miniapp: `pnpm typecheck`, `pnpm test`, `pnpm build`. Khi pnpm shim không khởi động được, dùng các entrypoint Node tương ứng trong node_modules. Có test cho điều kiện thanh toán, đảo tuyến khứ hồi, ngày về và lưu/sửa hồ sơ/hành khách.
