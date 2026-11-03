# Phương án triển khai bằng Zalo Mini App

> Ngày: 03/11/2026 · Trạng thái: Đề xuất để rà soát · Liên quan: [PNTicketDocs.md](PNTicketDocs.md), [GOP-Y-PNTicketDocs.md](GOP-Y-PNTicketDocs.md)

Tài liệu này đánh giá đề xuất **dùng Zalo Mini App làm kênh đặt vé chính cho khách**, và nêu những thay đổi cần đưa vào PNTicketDocs nếu đề xuất được chấp nhận. Mọi điều kiện, phí và quy trình duyệt của Zalo, ZaloPay, ZNS ghi ở đây cần **kiểm tra lại trên tài liệu chính thức và với Zalo** tại thời điểm đăng ký.

## 1. Kết luận ngắn

**Nên làm.** Khách của Phong Nhung là người lao động dùng Zalo hằng ngày. Mini App bỏ được bước cài app hay nhớ địa chỉ web, lấy được số điện thoại khi khách đồng ý, và kết nối tự nhiên với OA và ZNS để gửi vé, nhắc giờ xe.

Có ba điều kiện để làm đúng cách:

1. **Mini App chỉ là giao diện cho khách.** Kho chỗ, tiền, vé và đối soát vẫn nằm ở máy chủ (NestJS + PostgreSQL) như PNTicketDocs mục 9. Mọi nguyên tắc chống bán trùng, giữ chỗ, outbox và đối soát giữ nguyên.
2. **Trang quản trị và công cụ của phụ xe vẫn là web/PWA**, không làm trong Mini App. Nhân viên cần màn hình lớn, phân quyền chặt, và phụ xe phải kiểm tra vé được khi mất sóng.
3. **Kết quả thanh toán ở phía Mini App không phải bằng chứng đã nhận tiền.** Chỉ thông báo từ máy chủ nhà cung cấp, đã được xác thực, mới được dùng để xác nhận vé (PNTicketDocs mục 6.1).

## 2. Kiến trúc khi có Mini App

```
 Khách (trong Zalo)              Nhân viên / Kế toán / Chủ xe       Phụ xe
 ┌───────────────────┐           ┌────────────────────────┐        ┌───────────────┐
 │ Zalo Mini App     │           │ Web quản trị (Next.js) │        │ PWA kiểm tra  │
 │ React + ZMP SDK   │           │                        │        │ lên xe (offline)│
 └─────────┬─────────┘           └───────────┬────────────┘        └───────┬───────┘
           │ HTTPS (API công khai)            │ API nội bộ                  │
           ▼                                  ▼                             ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ NestJS API: chuyến, kho chỗ, đơn, vé, thanh toán, đối soát, phân quyền         │
 │ Worker (tiến trình riêng): outbox, ZNS/SMS, hết hạn giữ chỗ, nhắc giờ, đối soát│
 └───────┬──────────────────┬──────────────────────┬────────────────────────────┘
         │                  │                      │
    PostgreSQL     Zalo Open API / ZNS     Thanh toán: Checkout SDK (ZaloPay, thẻ…)
                   (đổi token SĐT, gửi tin)          + SePay/payOS (VietQR chuyển khoản)
```

**Thêm:** Mini App (React + ZMP SDK/ZMP UI) và tích hợp Zalo Open API.
**Giữ nguyên:** NestJS, PostgreSQL, worker, web quản trị.
**Thu hẹp:** website đặt vé công khai, ở MVP chỉ cần **trang tra cứu vé** cho khách không dùng Zalo hoặc mở link từ SMS. Website đặt vé đầy đủ chuyển sang giai đoạn sau nếu thật sự cần.

## 3. Đánh giá từng tính năng đề xuất

### 3.1. Tìm kiếm & giữ chỗ theo thời gian thực — **Làm trong MVP**

- Luồng giữ nguyên PNTicketDocs mục 4–5: chọn điểm đi/đến, ngày đi → sơ đồ tầng trên/dưới → giữ chỗ trên máy chủ, có hạn.
- "Thời gian thực" nghĩa là cập nhật trạng thái chỗ định kỳ (vài giây/lần) hoặc dùng SSE/WebSocket nếu chạy ổn trong Mini App. Dù vậy, **chỉ phản hồi của máy chủ khi giữ chỗ mới là kết quả cuối cùng**. Nếu giữ chỗ thất bại (`SEAT_UNAVAILABLE`), giao diện tải lại sơ đồ và báo rõ cho khách.
- Đồng hồ đếm ngược giữ chỗ lấy theo `hold_expires_at` máy chủ trả về.

### 3.2. Định vị & điểm đón — **Chia hai giai đoạn**

| Phần | Giai đoạn | Ghi chú |
|---|---|---|
| Bản đồ điểm đón/trả cố định | MVP | Mỗi điểm lưu tọa độ, địa chỉ, ảnh, ghi chú ("trước cổng KCN…"). Có nút **"Chỉ đường"** mở ứng dụng bản đồ trên máy, đơn giản và ổn định hơn nhúng bản đồ đầy đủ. |
| Gợi ý điểm đón gần nhất | MVP+ | Dùng API vị trí của Mini App **khi khách đồng ý**. Không bắt buộc, khách vẫn chọn tay được. |
| Vị trí xe đang chạy | Giai đoạn sau | Xe kinh doanh vận tải hành khách thường đã lắp thiết bị giám sát hành trình (GPS). Nên **lấy dữ liệu từ nhà cung cấp thiết bị đó** (nếu họ có API), không dùng điện thoại tài xế. Chỉ hiện cho khách có vé của chuyến, chỉ trong khoảng trước giờ đón đến khi lên xe. |

> Đón tận nơi theo vị trí khách (trung chuyển) là bài toán điều phối riêng, thuộc giai đoạn "Quản lý trung chuyển" của PNTicketDocs mục 2.2.

### 3.3. Thanh toán trực tuyến — **Làm trong MVP, nhưng chọn kênh cẩn thận**

Zalo Mini App có **Checkout SDK**, hỗ trợ nhiều phương thức như ZaloPay, thẻ, ví điện tử, chuyển khoản ngân hàng và COD, tùy cấu hình được duyệt. Hai điểm quan trọng từ tài liệu Checkout SDK:

- Với ZaloPay, thẻ và ví, máy chủ Checkout gọi **Callback URL** của nhà xe. Nhà xe **phải xác thực dữ liệu bằng khóa bí mật** rồi mới ghi nhận tiền. Sự kiện `PaymentDone` hay `checkTransaction` phía Mini App chỉ dùng để cập nhật giao diện.
- Với **chuyển khoản ngân hàng và COD qua Checkout**, Zalo chỉ **báo rằng khách đã chọn phương thức đó**. Nhà xe phải tự xác nhận đã nhận tiền rồi gọi `updateOrderStatus`. Nghĩa là **vẫn cần SePay/payOS** (hoặc đối soát tương đương) để biết tiền đã về tài khoản.

**Đề xuất cấu hình:**

| Phương thức | Vai trò | Lý do |
|---|---|---|
| **VietQR chuyển khoản qua SePay hoặc payOS** | Mặc định | Phí thấp, khách quen dùng, đối soát tự động đã thiết kế ở PNTicketDocs mục 6 |
| **ZaloPay / thẻ ATM / Visa qua Checkout SDK** | Tùy chọn | Tiện cho khách có ZaloPay hoặc thẻ, nhưng phí giao dịch cao hơn. Cần chốt **ai chịu phí** |
| COD (trả khi lên xe) | Không mở cho khách tự đặt | Dễ bị giữ chỗ ảo mùa Tết. Chỉ nhân viên đặt hộ cho khách quen |

**Đặt cọc:** yêu cầu thanh toán tạo theo **số tiền cần trả lúc này** (VD 50% cọc). Phần còn lại tạo yêu cầu thanh toán thứ hai, hoặc thu khi lên xe. Mỗi giao dịch, dù qua Checkout hay SePay/payOS, đều đi vào cùng `payments` → `payment_allocations` theo PNTicketDocs mục 6.4.

**Xuất vé QR ngay lập tức:** vé được phát hành **ngay khi máy chủ nhận thông báo thanh toán hợp lệ**, thường trong vài giây. Mini App hiện trạng thái "Đang xác nhận thanh toán…" và tự cập nhật. Không hiện vé hợp lệ chỉ vì khách vừa bấm xong trên màn hình thanh toán.

### 3.4. Chăm sóc khách hàng qua ZNS — **Làm trong MVP (nếu kịp duyệt)**

| Tin | Thời điểm | Nội dung chính |
|---|---|---|
| Xác nhận đặt vé | Ngay khi vé được phát hành | Mã đơn, tuyến, giờ đi, chỗ, điểm đón, đã trả/còn lại, nút mở vé trong Mini App |
| Xác nhận thanh toán bổ sung | Khi nhận thêm tiền | Số đã trả, còn lại |
| Nhắc giờ ra xe | Trước giờ đón 1–2 tiếng (cấu hình được) | Giờ và điểm đón, lưu ý mang vé |
| Thông tin liên hệ chuyến | Khi đã phân công xe và tài xế | Biển số xe, **số điện thoại liên hệ của chuyến** |
| Thay đổi/hủy chuyến | Khi điều hành thay đổi | Nội dung thay đổi, hướng xử lý |

**Lưu ý:**
- ZNS cần **OA đã xác thực**, **mẫu tin được Zalo duyệt trước**, và tính phí theo tin. Nội dung phải đúng mẫu đã duyệt.
- **Số điện thoại tài xế:** nên dùng **một số điện thoại cố định của chuyến/nhà xe** (máy công ty cấp cho phụ xe) thay vì số cá nhân của tài xế, để bảo vệ thông tin cá nhân và giữ liên lạc khi đổi tài xế. Nếu bắt buộc gửi số cá nhân, cần tài xế đồng ý.
- Tin nhắc giờ được lên lịch bởi worker **dựa trên giờ chạy hiện tại** của chuyến. Đổi giờ chạy thì lịch nhắc cũng đổi; hủy vé thì hủy tin nhắc.
- **Dự phòng:** ZNS gửi lỗi (số không dùng Zalo, quá hạn mức…) thì chuyển sang **SMS**. Lỗi gửi tin không làm vé mất hiệu lực (PNTicketDocs mục 7.2).

## 4. Tính năng Mini App nên bổ sung thêm

| Tính năng | Lý do |
|---|---|
| **Lấy số điện thoại từ Zalo** (`getPhoneNumber`) | Khách bấm đồng ý là xong, không phải gõ hay nhận OTP. Mini App nhận **token**, máy chủ đổi token lấy số qua Zalo Open API. Chỉ hỏi ở bước đặt vé, không hỏi ngay khi mở app. |
| **"Vé của tôi"** | Gắn đơn với Zalo user ID của khách trong Mini App. Khách mở lại là thấy vé, không cần tra cứu bằng OTP. |
| **Quan tâm OA** | Gợi ý (không ép) khách quan tâm OA Phong Nhung để nhận thông báo và chat hỗ trợ. |
| **Chat với nhà xe** | Mở khung chat OA từ trang vé để hỏi đổi/hủy, hành lý. |
| **Chia sẻ vé** | Người đặt hộ (con đặt cho bố mẹ) gửi vé cho hành khách qua Zalo. |
| **Danh sách chờ khi hết chỗ** | Báo qua ZNS khi có chỗ trống hoặc tăng chuyến (PNTicketDocs mục 2.2). |

## 5. Hạn chế của Mini App và cách xử lý

| Hạn chế | Ảnh hưởng | Cách xử lý |
|---|---|---|
| **Mỗi bản phát hành phải qua kiểm duyệt của Zalo** | Sửa lỗi gấp giữa mùa Tết có thể chậm | Đưa **giá, chính sách, thông báo, bật/tắt tính năng** về cấu hình phía máy chủ để không phải phát hành lại. Phát hành bản ổn định **trước** đợt mở bán, "đóng băng" thay đổi Mini App trong cao điểm. |
| Chỉ dùng được trong Zalo | Khách không dùng Zalo (ít) không đặt được | Nhân viên đặt hộ qua hotline, khách nhận vé qua SMS và trang tra cứu web. |
| Không có SEO | Khách tìm "xe Phong Nhung" trên Google không ra Mini App | Một trang web giới thiệu đơn giản có liên kết/QR mở Mini App, và quảng bá qua OA, mã QR dán trên xe, tại quầy. |
| Phụ thuộc nền tảng Zalo | Zalo thay đổi chính sách hoặc gián đoạn | Máy chủ và dữ liệu là của nhà xe. Mini App chỉ là một kênh, có thể thêm web hoặc kênh khác mà không đổi nghiệp vụ. |
| Thủ tục pháp lý, đăng ký | Cần pháp nhân, OA xác thực, duyệt mẫu ZNS, duyệt phương thức thanh toán | Bắt đầu thủ tục **ngay** (xem mục 7). |

## 6. Thay đổi đề xuất cho PNTicketDocs

Nếu chấp nhận phương án này, cập nhật PNTicketDocs như sau:

| Mục | Thay đổi |
|---|---|
| 2.1 MVP | Kênh khách hàng: **Zalo Mini App**. Thông báo: **ZNS + SMS dự phòng** (Email thành tùy chọn). Thêm trang tra cứu vé trên web. |
| 2.2 | Bỏ "ứng dụng di động riêng" khỏi danh sách loại trừ vì Mini App thay thế. Vị trí xe theo GPS và gợi ý điểm đón đưa vào giai đoạn sau. |
| 3 | Khách được nhận diện bằng Zalo user ID (của Mini App) + số điện thoại được chia sẻ. |
| 6.1 | Thêm adapter **Zalo Checkout SDK** bên cạnh SePay/payOS. Chuyển khoản qua Checkout vẫn cần nguồn xác nhận tiền về. |
| 7.2 | Bảng kênh gửi: ZNS (chính), SMS (dự phòng), Email (tùy chọn), trang vé trong Mini App. Thêm tin nhắc giờ và thông tin liên hệ chuyến. |
| 9.1 | Thêm Mini App (React + ZMP SDK). Next.js chỉ dùng cho web quản trị và trang tra cứu. |
| 10 | `customers` (zalo_user_id, phone, consent), `stops` thêm tọa độ, `zns_templates`, `scheduled_notifications`, `payment_requests.provider` có `zalo_checkout`. |
| 11 | Thêm `POST /api/v1/auth/zalo` (xác thực phiên Mini App), `POST /api/v1/me/phone` (đổi token lấy SĐT), `GET /api/v1/me/tickets`, `POST /api/v1/webhooks/payments/zalo-checkout`. |
| 13 | Thêm tiêu chí: callback Checkout giả hoặc trùng; ZNS lỗi → SMS; khách từ chối chia sẻ SĐT vẫn đặt được bằng cách nhập tay. |

## 7. Tác động đến lộ trình (Tết 2027)

Mini App **thêm các bước chờ duyệt từ phía Zalo**, nên phải làm song song ngay từ tuần này:

| Việc | Ghi chú |
|---|---|
| Xác nhận pháp nhân (hộ kinh doanh/doanh nghiệp) đứng tên OA, Mini App, nhận tiền | Kiểm tra điều kiện hiện hành của Zalo |
| Tạo và **xác thực Zalo OA** "Phong Nhung" | Hồ sơ theo yêu cầu của Zalo, có thể cần bổ sung giấy tờ |
| Đăng ký Mini App, xin quyền lấy số điện thoại, vị trí | Mỗi quyền cần được cấp trong trang quản lý ứng dụng |
| Đăng ký **mẫu tin ZNS** | Soạn sớm 4–5 mẫu ở mục 3.4 |
| Cấu hình **Checkout SDK** (nếu dùng ZaloPay/thẻ) và **SePay/payOS** | Môi trường thử trước, tiền thật sau |
| Nộp Mini App kiểm duyệt | Dự trù thời gian duyệt và sửa theo góp ý **trước** ngày mở bán |

Phương án chạy thử có giới hạn dịp Tết (GOP-Y mục 1) vẫn được khuyến nghị. Nếu OA, ZNS hoặc Mini App chưa được duyệt kịp, đợt Tết dùng **web quản trị để nhân viên đặt hộ + SMS**, rồi mở Mini App cho khách từ dịp 30/4/2027.

## 8. Câu hỏi cần chốt

1. Nhà xe đăng ký kinh doanh dưới hình thức nào, và ai đứng tên OA, Mini App?
2. Đã có Zalo OA chưa? Đã xác thực chưa?
3. Ngoài VietQR, có mở ZaloPay/thẻ không? Phí giao dịch do nhà xe hay khách chịu?
4. Xe đang dùng thiết bị giám sát hành trình của nhà cung cấp nào? Họ có API không?
5. Mỗi chuyến có số điện thoại công ty cấp cho phụ xe không?

## 9. Nguồn tham khảo

Tra cứu ngày 03/11/2026. Cần đối chiếu lại tài liệu gốc khi tích hợp.

- [Zalo Mini App — Thanh toán (Checkout SDK)](https://miniapp.zaloplatforms.com/documents/payment)
- [Checkout SDK — Cấu hình](https://miniapp.zaloplatforms.com/documents/checkout-sdk/integration-process/overview/setting)
- [Checkout SDK — Xử lý kết quả phía máy chủ](https://miniapp.zaloplatforms.com/documents/checkout-sdk/integration-process/overview/process-results-server)
- [Checkout SDK — Nhận giao dịch](https://miniapp.zaloplatforms.com/documents/checkout-sdk/integration-process/overview/receive-transaction-ma)
- [Zalo Mini App — getPhoneNumber](https://miniapp.zaloplatforms.com/documents/api/getPhoneNumber)
- [eSMS — Quy trình tạo Zalo OA](https://helpcenter.esms.vn/thong-tin-dich-vu/tra-cuu-thong-tin-ho-so/zalo/zalo-oa/quy-trinh-tao-zalo-oa)
