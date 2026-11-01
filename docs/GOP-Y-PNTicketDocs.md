# Góp ý cho PNTicketDocs v0.1

> Ngày: 01/11/2026 · Tài liệu gốc: [PNTicketDocs.md](PNTicketDocs.md)

`PNTicketDocs.md` là **tài liệu đặc tả chính** của dự án. File này chỉ ghi lại các điểm rủi ro, chỗ còn thiếu và đề xuất bổ sung sau khi rà soát. Mục nào được chấp nhận thì đưa vào phiên bản tiếp theo của PNTicketDocs, rồi xóa khỏi đây.

## 1. Rủi ro lớn nhất: tiến độ so với Tết Đinh Mùi 2027

- Mùng 1 Tết là **thứ Bảy, 06/02/2027**. Các nhà xe thường mở bán vé Tết từ tháng 12 hoặc đầu tháng 1.
- Theo mục 14.1, cần **8–12 tuần** tính từ 01/11/2026, tức là xong khoảng **cuối 12/2026 – cuối 01/2027**. Thời điểm đó trùng ngay với đợt bán vé Tết.
- Đưa một hệ thống tiền và kho chỗ mới vào dùng giữa đợt cao điểm là rủi ro cao nhất của dự án.

**Đề xuất (chọn một):**

| Phương án | Mô tả | Khi nào hợp lý |
|---|---|---|
| **A. Chạy thử có giới hạn dịp Tết** (khuyến nghị) | Chỉ mở 1 tuyến, vài chuyến, cấp một phần chỗ cho kênh online (VD 30%). Phần còn lại vẫn bán theo cách cũ, nhưng chia kho chỗ trước, đúng như mục 12. | Muốn có dữ liệu thật mùa Tết mà không mạo hiểm toàn bộ doanh thu |
| B. Chỉ dùng nội bộ dịp Tết | Nhân viên đặt hộ trên hệ thống để chống trùng chỗ và theo dõi tiền cọc. Khách chưa tự đặt. | Thanh toán tự động chưa nghiệm thu kịp |
| C. Mở bán rộng từ dịp 30/4/2027 | Tết dùng để chạy thử nội bộ, Lễ 30/4 mới mở bán rộng. | Tiến độ trễ hoặc chưa chọn xong nhà cung cấp |

Dù chọn phương án nào, các đầu việc **cần nhiều thời gian chờ** nên làm ngay tuần này: mở tài khoản nhận tiền riêng, đăng ký SePay hoặc payOS, đăng ký tên người gửi SMS, mua tên miền và cấu hình SPF/DKIM/DMARC.

## 2. Những điểm còn thiếu trong đặc tả

### 2.1. Kiểm tra lên xe khi mất sóng
Trên đường quốc lộ và đèo, sóng điện thoại thường chập chờn, nhưng mục 7.1 và AC-16 đang ngầm định thiết bị luôn có mạng.
- Trước giờ chạy, máy của phụ xe tải sẵn danh sách khách của chuyến được giao (đã mã hóa, có hạn dùng).
- Quét QR và ghi nhận lên xe được khi mất mạng; có mạng lại thì đồng bộ. Chống lặp bằng mã sự kiện sinh trên thiết bị.
- Đề xuất thêm tiêu chí: **AC-18: Kiểm tra lên xe khi mất mạng rồi đồng bộ lại, không ghi trùng và không mất bản ghi.**

### 2.2. Bàn giao tiền mặt cuối chuyến
Mục 6.4 có tiền mặt nhưng chưa có quy trình **phụ xe nộp tiền**.
- Mỗi chuyến có một "phiếu bàn giao": tổng phần còn phải thu theo danh sách, số thực thu từng vé, số đã nộp, chênh lệch.
- Kế toán xác nhận nhận tiền thì phiếu mới đóng. Khoản chênh lệch được ghi điều chỉnh, không sửa bản ghi gốc.
- Bổ sung thực thể `cash_handovers` vào mục 10.

### 2.3. Đơn vị bán: phòng hay chỗ
Xe 24 phòng limousine có thể bán **theo phòng** (1–2 người) chứ không phải từng giường. Mục 15 đã nêu "quy tắc số người mỗi phòng", nhưng mô hình `trip_seats` và `booking_items` cần xác định rõ:
- Giá tính theo phòng hay theo người? Phòng 2 người có được bán cho 1 người không, và có phụ thu không?
- Một phòng có thể gồm nhiều `booking_items` (mỗi hành khách một vé) nhưng chỉ có **một quyền chiếm chỗ**.

### 2.4. Nội dung chuyển khoản
- Một số app ngân hàng cắt bớt, đổi hoặc bỏ dấu nội dung chuyển khoản. Mã thanh toán nên **ngắn (6–8 ký tự), chữ in hoa và số, bỏ các ký tự dễ nhầm** (0/O, 1/I/L), có tiền tố cố định (VD `PN`), và khi so khớp thì không phân biệt chữ hoa/thường hay khoảng trắng.
- Nếu dùng payOS, mã đơn và nội dung do payOS quản lý. Nếu dùng SePay, hệ thống tự nhận diện mã trong nội dung. Hai cách khác nhau nên cần chốt nhà cung cấp trước khi thiết kế `payment_requests`.

### 2.5. Chuẩn hóa số điện thoại
Số điện thoại là khóa chính để liên hệ và tra cứu. Cần chuẩn hóa về một dạng (VD `+84…`) khi lưu, chấp nhận khách nhập `0…`, `84…`, có khoảng trắng hoặc dấu chấm, và kiểm tra đầu số di động Việt Nam.

## 3. Đề xuất bổ sung cho giai đoạn tiếp theo (mục 2.2)

| Đề xuất | Lý do |
|---|---|
| **Gửi vé qua Zalo** (Zalo Official Account + ZNS) | Đa số khách là người lao động dùng Zalo hằng ngày. Mẫu tin cần được duyệt nên không nên đưa vào MVP, nhưng nên đăng ký OA sớm. |
| **Tin SMS kèm liên kết tra cứu có token** | Khách bấm từ SMS là mở được vé ngay, không cần OTP, nên đỡ chi phí OTP vào mùa cao điểm (khớp với mục 12: token khó đoán, có thể thu hồi). |
| **PWA cho phụ xe** | Cài lên màn hình điện thoại như app, chạy được khi mất mạng (mục 2.1), không phải làm ứng dụng riêng (đúng với giới hạn ở mục 2.2). |
| **Báo cáo nhu cầu chưa đáp ứng** | Thống kê lượt tìm không còn chỗ và danh sách chờ theo ngày/giờ để nhà xe quyết định tăng chuyến (mục 1.1). |

## 4. Về kiến trúc (mục 9)

Lựa chọn Next.js + NestJS + PostgreSQL là hợp lý. Có một cân nhắc cho nhóm 1–2 người:

- **Hai ứng dụng** (Next.js web + NestJS API/worker): tách biệt rõ, worker và webhook không phụ thuộc vào web, dễ mở rộng về sau. Đổi lại phải triển khai và theo dõi 2 ứng dụng.
- **Đề xuất:** giữ NestJS cho nghiệp vụ, webhook và worker như đặc tả, nhưng đặt chung một monorepo (pnpm workspaces) với Next.js để dùng chung kiểu dữ liệu TypeScript, mã lỗi và thư viện kiểm tra dữ liệu. Worker chạy cùng codebase NestJS nhưng là **tiến trình riêng**, để webhook và outbox không bị ảnh hưởng khi web chịu tải.
- Trong giai đoạn đầu, outbox và tác vụ nền có thể chạy bằng **PostgreSQL** (bảng outbox + `SELECT … FOR UPDATE SKIP LOCKED`) để chưa cần Redis. Cách này khớp với mục 9.1: Redis chỉ thêm vào khi cần.

## 5. Các điểm cần chủ xe trả lời sớm nhất

Đây là một phần của mục 15, chọn theo mức ảnh hưởng đến thiết kế dữ liệu và lịch triển khai:

1. Dịp Tết 2027 chọn phương án A, B hay C (mục 1)?
2. Ngân hàng nhận tiền là ngân hàng nào, và dùng **SePay hay payOS**?
3. Bán theo phòng hay theo người? Sơ đồ 24 phòng thực tế (tầng, ký hiệu)?
4. Tỷ lệ cọc dịp Tết, và hạn trả phần còn lại?
5. Ai được duyệt hoàn tiền và cấp lại chỗ cho tiền đến muộn?
