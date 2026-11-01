# Đề xuất phát triển Web App đặt vé xe khách — PNTicket (Nhà xe Phong Nhung)

> Phiên bản: 0.1 · Ngày: 01/11/2026 · Trạng thái: Bản đề xuất để thảo luận

---

## 1. Bối cảnh và vấn đề

Mỗi dịp Lễ, Tết Nguyên đán, lượng người lao động từ TP.HCM về quê tăng gấp nhiều lần ngày thường. Với nhà xe vừa và nhỏ như Phong Nhung, việc bán vé hiện nay thường dựa vào **điện thoại, Zalo, Facebook và sổ tay/Excel**, dẫn tới:

| Phía khách hàng | Phía nhà xe |
|---|---|
| Gọi hotline liên tục không được, nhắn Zalo chờ lâu | Nhân viên quá tải, ghi chép nhầm, **trùng ghế** |
| Không biết còn ghế nào, tầng trên hay tầng dưới | Khó kiểm soát **tiền cọc**: ai đã chuyển, chuyển bao nhiêu, nội dung gì |
| Chuyển khoản cọc xong không có gì xác nhận, lo bị mất vé | Đối soát sao kê ngân hàng thủ công, mất hàng giờ mỗi ngày |
| Mất ảnh chụp/tin nhắn xác nhận là "mất vé" | Khách "giữ chỗ ảo" rồi không đi, ghế trống khi xe chạy |

**Mục tiêu:** một web app (dùng tốt trên điện thoại) giúp khách **tự chọn ghế – chuyển khoản – nhận vé tự động trong vài phút**, còn nhà xe **quản lý vé, tiền cọc và chuyến xe tập trung, cập nhật theo thời gian thực**.

## 2. Đối tượng sử dụng

| Vai trò | Nhu cầu chính |
|---|---|
| **Khách hàng** | Tìm chuyến, chọn ghế giường nằm, thanh toán, nhận vé qua Email/SMS/Zalo, tra cứu/đổi/hủy vé |
| **Nhân viên bán vé (quầy/hotline)** | Đặt vé hộ khách gọi điện, xác nhận thanh toán tiền mặt, in vé |
| **Phụ xe / Tài xế** | Xem danh sách hành khách theo chuyến, quét QR check-in, ghi nhận thu tiền còn lại |
| **Chủ nhà xe (Admin)** | Quản lý tuyến, xe, lịch chạy, giá vé theo mùa, đối soát tiền cọc, báo cáo doanh thu |

## 3. Tham khảo từ FUTA Bus (futabus.vn) — học gì, làm khác gì

**Nên học (đây là chuẩn mà khách đã quen dùng):**
- Ô tìm kiếm ngay trang chủ: *Điểm đi – Điểm đến – Ngày đi – (Ngày về) – Số vé*.
- Danh sách chuyến có giờ khởi hành, giờ đến dự kiến, loại xe, giá, số ghế trống.
- **Sơ đồ ghế 2 tầng** (tầng dưới/tầng trên), màu sắc rõ ràng: trống / đang chọn / đã bán.
- Chọn **điểm đón, điểm trả** cụ thể.
- Trang **tra cứu vé** bằng số điện thoại + mã vé.

**Nên làm khác/tốt hơn (lợi thế của nhà xe nhỏ):**
- **Chuyển khoản VietQR + tự động xác nhận** thay vì phải tích hợp cổng thanh toán phức tạp, phí cao.
- **Đặt cọc** thay vì bắt buộc trả 100% — phù hợp thói quen khách đi Tết.
- **Gửi vé qua Zalo** (kênh khách dùng nhiều nhất), không chỉ Email/SMS.
- Đón/trả linh hoạt dọc đường, ghi chú "đón tại nhà trọ, KCN…" — điều mà nhà xe địa phương làm tốt hơn hãng lớn.
- Giao diện đơn giản, chữ to, ít bước — phù hợp người lao động, người lớn tuổi.

> Lưu ý: chỉ tham khảo luồng nghiệp vụ, **không sao chép** giao diện, logo, nội dung của FUTA.

## 4. Tính năng đề xuất

### 4.1. Phía khách hàng (Website công khai)

1. **Tìm chuyến**: chọn tuyến (VD: TP.HCM ⇄ quê), ngày, số vé.
2. **Chọn ghế trên sơ đồ xe giường nằm** (tầng trên/dưới, hàng đầu/cuối, ghế đôi…).
3. **Giữ chỗ tạm thời 10–15 phút** khi khách đang thanh toán; hết giờ tự nhả ghế.
4. **Nhập thông tin**: họ tên, SĐT (bắt buộc), email (tuỳ chọn), điểm đón/trả, ghi chú.
5. **Xác thực SĐT bằng OTP** (bật trong mùa cao điểm để chống đặt ảo).
6. **Thanh toán chuyển khoản**:
   - Hiển thị **mã VietQR** đã điền sẵn số tiền + nội dung `PN<mã đặt vé>` (VD: `PN8K3D2Q`).
   - Khách quét bằng bất kỳ app ngân hàng nào → **hệ thống tự nhận biết trong vài giây** (xem mục 6).
   - Chọn **cọc X%** hoặc **trả đủ 100%**.
7. **Nhận vé điện tử** gồm mã vé, mã QR, thông tin chuyến, ghế, điểm đón, số tiền đã cọc/còn lại — qua **Email, SMS, Zalo ZNS**.
8. **Tra cứu vé**: SĐT + mã vé; xem trạng thái, tải lại vé.
9. **Yêu cầu đổi chuyến / hủy vé** theo chính sách (VD: hủy trước 48h hoàn cọc 70%…).
10. **Thông báo nhắc trước giờ xe chạy** (trước 1 ngày và 2 giờ).

### 4.2. Phía nhà xe (Trang quản trị)

| Nhóm | Chức năng |
|---|---|
| **Danh mục** | Tuyến, điểm đón/trả, xe (biển số, loại xe), **mẫu sơ đồ ghế** (34/40/44 giường, limousine…), tài xế, phụ xe |
| **Lịch chạy** | Tạo chuyến hàng loạt (VD: mỗi ngày 18h, 19h, 20h), gán xe/tài xế, tăng chuyến cao điểm |
| **Giá vé** | Giá theo tuyến, theo vị trí ghế, **giá theo mùa** (Tết, 30/4, 2/9), giảm giá khứ hồi |
| **Mở bán** | Hẹn giờ mở bán vé Tết (VD: 8h00 ngày 15/11), giới hạn số vé/SĐT |
| **Bán vé tại quầy** | Đặt vé hộ, thu tiền mặt, in vé nhiệt |
| **Quản lý vé** | Tìm theo SĐT/mã/chuyến, đổi ghế, đổi chuyến, hủy, hoàn tiền |
| **Đối soát cọc** | Danh sách giao dịch ngân hàng ↔ vé, tự khớp; giao dịch lệch (thiếu/thừa/sai nội dung) để xử lý tay |
| **Danh sách hành khách** | Xuất danh sách theo chuyến (in/Excel) cho phụ xe, kèm số tiền cần thu thêm |
| **Check-in** | Phụ xe quét QR trên điện thoại khi khách lên xe |
| **Báo cáo** | Doanh thu theo ngày/chuyến/tuyến, tỷ lệ lấp đầy, tiền cọc đang giữ, vé hủy, kênh bán |
| **Phân quyền** | Admin / Kế toán / Bán vé / Phụ xe |
| **Nhật ký** | Ai sửa vé nào, lúc nào (chống gian lận) |

## 5. Luồng đặt vé và trạng thái vé

```
Khách chọn ghế
      │
      ▼
[HOLD] giữ ghế 15 phút ──hết giờ──► [EXPIRED] (nhả ghế)
      │ khách xác nhận thông tin
      ▼
[PENDING_PAYMENT] hiện QR chuyển khoản
      │ webhook ngân hàng báo tiền về
      ├── đủ tiền cọc ─────► [DEPOSIT_PAID] ── gửi vé Email/SMS/Zalo
      └── đủ 100% ─────────► [PAID]          ── gửi vé Email/SMS/Zalo
                                   │
                    phụ xe quét QR │ (thu nốt tiền còn lại nếu cọc)
                                   ▼
                             [CHECKED_IN] ─► [COMPLETED]

Bất kỳ lúc nào trước giờ chạy: ─► [CANCELLED] ─► [REFUNDED] (nếu có hoàn tiền)
Khách không lên xe:            ─► [NO_SHOW]
```

**Quy tắc quan trọng:**
- Một ghế trên một chuyến chỉ có tối đa **một vé ở trạng thái còn hiệu lực** (ràng buộc ở cơ sở dữ liệu, không chỉ ở giao diện) → **không bao giờ trùng ghế**.
- Tiền về **sau khi** vé đã hết hạn giữ chỗ: nếu ghế còn trống thì tự khôi phục vé; nếu ghế đã bị người khác lấy thì chuyển vào danh sách "cần hoàn tiền/đổi ghế" cho nhân viên xử lý.

## 6. Thanh toán chuyển khoản & tự động đối soát tiền cọc

Đây là **tính năng cốt lõi**, giải quyết đúng "nỗi đau" lớn nhất của nhà xe.

### Cách hoạt động
1. Nhà xe dùng tài khoản ngân hàng sẵn có (khuyến nghị **mở 1 tài khoản riêng chỉ để nhận tiền vé**).
2. Hệ thống tạo **mã VietQR** (chuẩn NAPAS, mọi app ngân hàng đều quét được) với số tiền và nội dung `PN8K3D2Q`.
3. Kết nối tài khoản ngân hàng với một **dịch vụ báo biến động số dư qua webhook** tại Việt Nam, ví dụ: **SePay, Casso, PayOS** (chọn một; so sánh phí và ngân hàng hỗ trợ khi triển khai).
4. Khi có tiền vào, dịch vụ gọi webhook đến hệ thống → hệ thống đọc nội dung, tìm mã `PN...`, so khớp số tiền → cập nhật vé → gửi vé cho khách. **Tổng thời gian thường dưới 1 phút.**

### Xử lý các tình huống lệch
| Tình huống | Xử lý |
|---|---|
| Chuyển đúng mã, đúng tiền | Tự động xác nhận |
| Chuyển **thiếu** tiền cọc | Ghi nhận số đã trả, nhắn khách chuyển bổ sung, giữ ghế thêm thời gian ngắn |
| Chuyển **thừa** | Xác nhận vé, ghi chú "thừa X đồng" để trừ khi lên xe hoặc hoàn |
| **Sai/thiếu nội dung** | Đưa vào hàng chờ "Giao dịch chưa khớp", nhân viên ghép tay với vé (gợi ý theo số tiền + thời gian) |
| Chuyển trùng 2 lần | Phát hiện theo mã giao dịch ngân hàng, đánh dấu cần hoàn |

### Màn hình "Kiểm kê tiền cọc" cho chủ xe
- Tổng tiền cọc đang giữ theo từng chuyến/ngày.
- Số tiền **còn phải thu** trên xe (để phụ xe nộp lại cuối chuyến).
- Đối chiếu: tổng tiền ngân hàng nhận = tổng tiền vé đã xác nhận + giao dịch chưa khớp.

## 7. Gửi thông tin vé tự động

| Kênh | Ưu điểm | Gợi ý nhà cung cấp | Ghi chú |
|---|---|---|---|
| **Zalo ZNS** | Khách Việt dùng Zalo nhiều nhất, tỷ lệ đọc cao, chi phí thấp hơn SMS | Zalo Official Account + ZNS | Cần tạo OA cho nhà xe và đăng ký mẫu tin |
| **SMS Brandname** | Tin hiển thị tên "PHONGNHUNG", đáng tin cậy, không cần internet | eSMS, SpeedSMS, VNPT, Viettel… | Đăng ký brandname mất vài tuần, cần làm sớm trước Tết |
| **Email** | Gần như miễn phí, đính kèm vé PDF có QR | Resend, Amazon SES, hoặc Gmail/Google Workspace SMTP | Gmail cá nhân giới hạn số thư/ngày → không phù hợp mùa Tết |

**Chiến lược khuyến nghị:** gửi Zalo ZNS trước → nếu thất bại (khách không dùng Zalo) thì gửi SMS → luôn gửi kèm Email nếu khách có nhập. Tất cả đi qua **hàng đợi gửi tin** để thử lại khi lỗi, không làm chậm việc đặt vé.

## 8. Chịu tải mùa cao điểm (Lễ, Tết)

Ngày mở bán vé Tết có thể có hàng nghìn người truy cập cùng lúc trong vài phút. Các biện pháp:

1. **Khóa ghế nguyên tử** (database transaction + ràng buộc duy nhất, hoặc Redis lock) → 2 người bấm cùng 1 ghế thì chỉ 1 người thành công, người còn lại được báo ngay "ghế vừa có người chọn".
2. **Cập nhật sơ đồ ghế thời gian thực** (WebSocket/SSE) để khách thấy ghế đã bán mà không cần tải lại trang.
3. **Phòng chờ ảo** (virtual waiting room) khi lượng truy cập vượt ngưỡng: xếp hàng công bằng, hiển thị "Bạn đang ở vị trí thứ 235".
4. **Hẹn giờ mở bán** công khai từ trước → tránh dồn dập điện thoại.
5. **Giới hạn** số vé/SĐT/chuyến, **OTP** xác thực SĐT, **CAPTCHA** khi nghi ngờ bot.
6. **Thời gian giữ chỗ ngắn hơn** trong mùa Tết (VD: 10 phút) để ghế quay vòng nhanh.
7. **CDN + cache** cho trang tĩnh; chỉ phần chọn ghế/thanh toán đi vào máy chủ.
8. **Thử tải** (load test) trước mỗi đợt mở bán Tết.

## 9. Kiến trúc & công nghệ đề xuất

Ưu tiên: **ít thành phần, dễ vận hành bởi 1–2 lập trình viên, chi phí thấp, mở rộng được khi cần.**

```
   Khách (điện thoại)         Nhân viên / Phụ xe / Admin
          │                              │
          ▼                              ▼
  ┌────────────────────────────────────────────────┐
  │  Next.js (React + TypeScript)                  │
  │  • Website đặt vé (SSR, chuẩn SEO, PWA)        │
  │  • Trang quản trị                              │
  │  • API routes / Server Actions                 │
  └───────┬──────────────┬───────────────┬─────────┘
          │              │               │
     PostgreSQL        Redis        Hàng đợi tác vụ
     (dữ liệu chính)  (giữ ghế,     (gửi Zalo/SMS/Email,
                       rate limit,   hết hạn giữ chỗ,
                       realtime)     nhắc lịch)
          ▲
          │ webhook biến động số dư
   SePay / Casso / PayOS  ◄── Tài khoản ngân hàng nhà xe
```

| Thành phần | Lựa chọn đề xuất | Lý do |
|---|---|---|
| Frontend + Backend | **Next.js + TypeScript** | Một codebase cho cả web khách và admin, tốt cho SEO ("xe Phong Nhung", "vé xe Tết đi …") |
| UI | Tailwind CSS + shadcn/ui | Nhanh, đẹp, dễ tùy biến cho di động |
| CSDL | **PostgreSQL** + Prisma ORM | Giao dịch an toàn, ràng buộc chống trùng ghế |
| Cache/Lock/Queue | **Redis** + BullMQ | Giữ ghế, giới hạn truy cập, hàng đợi gửi tin |
| Đăng nhập admin | Auth.js (NextAuth) | Phân quyền theo vai trò |
| Realtime | Server-Sent Events hoặc Socket.IO | Cập nhật sơ đồ ghế |
| Hosting | **VPS tại Việt Nam** (Viettel IDC, VNPT, FPT, BizFly…) hoặc Vercel + Neon/Supabase giai đoạn đầu | VPS trong nước: độ trễ thấp, thuận lợi cho yêu cầu lưu trữ dữ liệu cá nhân tại VN |
| Giám sát | Sentry + Uptime Kuma | Báo lỗi, báo sập ngay khi có sự cố |

> Có thể làm thêm **ứng dụng PWA** (cài lên màn hình điện thoại như app) cho phụ xe quét QR — không cần làm app Android/iOS riêng ở giai đoạn đầu.

## 10. Mô hình dữ liệu chính (rút gọn)

```
routes            (id, from_city, to_city, distance_km, duration_min)
stops             (id, route_id, name, address, type: pickup|dropoff, order, offset_min)
seat_layouts      (id, name, floors, layout_json)           -- sơ đồ ghế mẫu
vehicles          (id, plate_number, seat_layout_id, type)
trips             (id, route_id, vehicle_id, depart_at, status, driver_id, assistant_id)
fare_rules        (id, route_id, seat_type, season_from, season_to, price)
bookings          (id, code, trip_id, customer_name, phone, email,
                   pickup_stop_id, dropoff_stop_id, total_amount, deposit_amount,
                   paid_amount, status, hold_expires_at, channel, created_by)
booking_seats     (booking_id, trip_id, seat_code, price)
                   -- UNIQUE(trip_id, seat_code) cho vé còn hiệu lực
payments          (id, booking_id, provider, bank_txn_id UNIQUE, amount,
                   content, received_at, match_status: matched|partial|unmatched)
notifications     (id, booking_id, channel: zalo|sms|email, status, sent_at, error)
users             (id, name, phone, role: admin|accountant|seller|assistant)
audit_logs        (id, user_id, action, entity, entity_id, before, after, at)
```

## 11. Lộ trình triển khai

Giả định: 1–2 lập trình viên. Nên **bắt đầu ngay** để kịp chạy thử trước Tết.

| Giai đoạn | Thời gian | Nội dung | Kết quả |
|---|---|---|---|
| **0. Chuẩn bị** | 1 tuần | Chốt tuyến, sơ đồ xe, chính sách cọc/hủy; đăng ký tên miền, Zalo OA, SMS brandname, tài khoản SePay/Casso/PayOS | Thủ tục sẵn sàng (brandname/ZNS cần thời gian duyệt) |
| **1. MVP** | 4–6 tuần | Tìm chuyến, sơ đồ ghế, giữ chỗ, VietQR + tự xác nhận, gửi vé Email + SMS, tra cứu vé; Admin: tuyến/xe/chuyến/vé, danh sách hành khách | **Bán vé online được** |
| **2. Vận hành** | 3–4 tuần | Đối soát cọc nâng cao, Zalo ZNS, bán vé tại quầy, check-in QR, phân quyền, báo cáo, nhắc lịch | Nhà xe bỏ được sổ tay/Excel |
| **3. Cao điểm** | 2–3 tuần | Phòng chờ ảo, hẹn giờ mở bán, OTP, giới hạn vé, load test, giá theo mùa | **Sẵn sàng cho đợt bán vé Tết** |
| **4. Mở rộng** | Liên tục | Vé khứ hồi, mã giảm giá, khách hàng thân thiết, gửi hàng/ký gửi, hóa đơn điện tử, theo dõi vị trí xe (GPS), đa nhà xe (SaaS) | Tăng doanh thu, có thể bán phần mềm cho nhà xe khác |

## 12. Chi phí vận hành ước tính (tham khảo)

| Hạng mục | Ước tính | Ghi chú |
|---|---|---|
| Tên miền `.vn` / `.com` | ~300.000 – 800.000 đ/năm | |
| VPS (2–4 vCPU, 4–8GB RAM) | ~300.000 – 1.000.000 đ/tháng | Tăng cấu hình tạm thời vào tháng Tết |
| Dịch vụ webhook ngân hàng | Miễn phí – vài trăm nghìn đ/tháng | Tùy gói và số giao dịch |
| SMS brandname | ~vài trăm đồng/tin | Tùy nhà mạng, nhà cung cấp |
| Zalo ZNS | ~vài trăm đồng/tin | Thường rẻ hơn SMS |
| Email | Gần như miễn phí ở quy mô nhà xe | |

> Các con số chỉ mang tính định hướng, cần báo giá thực tế từ nhà cung cấp tại thời điểm triển khai.

## 13. Pháp lý & bảo mật cần lưu ý

- **Bảo vệ dữ liệu cá nhân** (Nghị định 13/2023/NĐ-CP và các quy định liên quan): có chính sách quyền riêng tư, chỉ thu thập thông tin cần thiết (tên, SĐT, email), cho phép khách yêu cầu xóa dữ liệu.
- **Hóa đơn điện tử**: nếu nhà xe đã dùng hóa đơn điện tử, có thể tích hợp xuất hóa đơn cho vé (giai đoạn 4). Nên hỏi kế toán/cơ quan thuế về yêu cầu cụ thể.
- **Chính sách vé** công khai trên web: cọc, hủy, đổi, hoàn tiền, hành lý.
- Bảo mật: HTTPS, xác thực chữ ký webhook ngân hàng, mật khẩu admin mạnh + 2FA, sao lưu CSDL hằng ngày, nhật ký thao tác.

## 14. Rủi ro và cách giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Khách lớn tuổi không quen đặt online | Giữ hotline; nhân viên đặt hộ trên cùng hệ thống → vẫn không trùng ghế |
| Webhook ngân hàng chậm/lỗi | Có nút "Tôi đã chuyển khoản" + nhân viên xác nhận tay; đồng bộ lại định kỳ |
| Sập web ngày mở bán Tết | Phòng chờ ảo, load test, tăng cấu hình máy chủ trước đợt bán |
| Brandname/ZNS chưa được duyệt kịp | Đăng ký ngay từ giai đoạn 0; tạm thời dùng Email + SMS thường |
| Phụ thuộc 1 lập trình viên | Code rõ ràng, tài liệu đầy đủ, dùng công nghệ phổ biến |

## 15. Chỉ số đo lường thành công

- ≥ 50% vé bán qua kênh online sau mùa Tết đầu tiên.
- Thời gian từ lúc chuyển khoản đến lúc nhận vé: **< 1 phút** (trung bình).
- **0** trường hợp trùng ghế.
- Giảm ≥ 70% thời gian đối soát tiền cọc của kế toán.
- Tỷ lệ lấp đầy ghế, tỷ lệ khách không lên xe (no-show) giảm.

## 16. Bước tiếp theo đề xuất

1. Chủ nhà xe xác nhận: danh sách tuyến, điểm đón/trả, sơ đồ từng loại xe, chính sách cọc/hủy.
2. Chọn dịch vụ webhook ngân hàng và mở tài khoản nhận tiền riêng.
3. Đăng ký Zalo OA + ZNS và SMS brandname (làm sớm vì cần thời gian duyệt).
4. Khởi tạo dự án Next.js + PostgreSQL và làm **MVP (Giai đoạn 1)**.
