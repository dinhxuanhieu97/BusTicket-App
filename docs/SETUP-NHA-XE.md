# Thu phí nền tảng, gửi vé miễn phí, chính sách trẻ em và checklist setup nhà xe

> Ngày: 03/11/2026 · Trạng thái: Đề xuất để rà soát · Liên quan: [NEN-TANG-DA-NHA-XE.md](NEN-TANG-DA-NHA-XE.md), [ZALO-MINI-APP.md](ZALO-MINI-APP.md), [PNTicketDocs.md](PNTicketDocs.md)

## Quyết định ghi nhận (03/11/2026)

| Nội dung | Quyết định |
|---|---|
| Thu phí nhà xe | **Thu một lần** hoặc **theo số vé** (chọn khi ký với từng nhà xe) |
| Gửi vé | **Email / SMS / Zalo chat**, **ưu tiên kênh miễn phí** |
| Trẻ em | Mặc định **dưới 2 tuổi nằm chung không tính tiền**; nhà xe có thể đổi, bạn cấu hình khi setup trước ngày hoạt động chính thức |

---

## 1. Thu phí các nhà xe

### 1.1. Hai gói

| Gói | Nhà xe trả | Hệ thống cần có |
|---|---|---|
| **Một lần** | Phí triển khai một lần | Ghi nhận ngày kích hoạt, phạm vi đã mua (số xe, kênh). Không cần đo lượng dùng |
| **Theo số vé** | Đơn giá × số vé tính phí mỗi kỳ (VD hằng tháng) | **Đếm vé tự động**, báo cáo theo kỳ, xuất bảng kê cho nhà xe đối chiếu |

**Lưu ý với gói một lần:** máy chủ, sao lưu, tên miền, SMS/email và việc sửa lỗi vẫn **phát sinh chi phí hằng tháng**. Nên ghi rõ trong hợp đồng ai trả chi phí vận hành (có thể là phí duy trì năm nhỏ, hoặc nhà xe tự thuê máy chủ). Nếu không, gói một lần dễ thành lỗ khi số nhà xe tăng.

### 1.2. Định nghĩa "vé tính phí" (gói theo số vé)

Cần thống nhất trước với nhà xe để không tranh cãi. Đề xuất:

- Đơn vị tính là **đơn vị bán**: một chỗ, một giường, hoặc **một phòng** (phòng đôi vẫn là 1 vé). Trẻ dưới 2 tuổi không tính.
- **Tính** khi đơn được xác nhận (CONFIRMED). Gồm cả vé online, vé nhân viên đặt hộ và vé tiền mặt, vì đều dùng hệ thống.
- **Không tính** nếu vé bị hủy **trước giờ khởi hành** (hoặc theo mốc trong hợp đồng). Chuyến bị nhà xe hủy cũng không tính.
- Vé đổi chuyến hoặc đổi chỗ **không tính thêm**.

Tháng đầu nên làm đối chiếu thử để hai bên cùng kiểm tra.

### 1.3. Dữ liệu cần thêm

```
platform_plans         (id, name, type: ONE_TIME | PER_TICKET, unit_price, notes)
operator_subscriptions (operator_id, plan_id, start_date, end_date, status)
billable_tickets       (operator_id, booking_item_id UNIQUE, period, counted_at, voided_at)
billing_statements     (operator_id, period, ticket_count, amount, status, issued_at)
```

`billable_tickets` ghi **một dòng cho mỗi đơn vị bán**, chống đếm trùng. Hủy hợp lệ thì đánh dấu `voided_at`, không xóa. Bảng kê lấy số liệu từ đây. Thu tiền nhà xe làm **ngoài hệ thống** (chuyển khoản, hóa đơn), vì nền tảng không giữ tiền vé của khách.

---

## 2. Gửi vé: ưu tiên kênh miễn phí

### 2.1. Thứ tự kênh

| Thứ tự | Kênh | Chi phí | Ghi chú |
|---|---|---|---|
| 1 | **Trang vé ngay sau thanh toán** + "Vé của tôi" trong Mini App | Miễn phí | Luôn có. Nút **lưu ảnh QR** và **chia sẻ vé qua Zalo** (khách tự bấm chia sẻ cho người thân) |
| 2 | **Email** | Miễn phí trong hạn mức gói free của dịch vụ email giao dịch | Gửi từ tên miền nhà xe, cấu hình SPF/DKIM/DMARC. Không dùng Gmail cá nhân cho mùa Tết vì giới hạn số thư/ngày |
| 3 | **Zalo chat từ OA** của nhà xe | Miễn phí/rẻ **tùy chính sách OA hiện hành** | Chỉ gửi được cho khách **đã quan tâm hoặc đã nhắn OA**, trong giới hạn tin của gói OA. **Cần kiểm tra chính sách hiện tại của Zalo khi tạo OA** |
| 4 | **ZNS** | Có phí theo tin (rẻ hơn SMS) | Gửi được theo số điện thoại kể cả khi khách chưa quan tâm OA. Nhà xe bật nếu chấp nhận phí |
| 5 | **SMS** | Có phí theo tin | Chỉ dùng làm **dự phòng**: khách không có email, không dùng Zalo, hoặc các kênh trên đều lỗi |

**Quy tắc gửi (worker/outbox):**
- Mỗi sự kiện (xác nhận vé, nhắc giờ, đổi chuyến) đi lần lượt theo danh sách kênh **nhà xe đã bật**. Gửi thành công ở một kênh miễn phí thì **không gửi kênh trả phí**, trừ khi nhà xe chọn "luôn gửi SMS".
- Riêng **thay đổi hoặc hủy chuyến** là tin quan trọng: nên cho phép gửi kênh trả phí ngay cả khi đã gửi kênh miễn phí.
- Mỗi nhà xe có **hạn mức chi phí tin nhắn/tháng** (VD tối đa N tin SMS). Vượt hạn mức thì chỉ dùng kênh miễn phí và báo cho chủ xe.
- Báo cáo số tin và chi phí ước tính theo kênh để chủ xe thấy tiền tin nhắn.

### 2.2. Gợi ý cho khách để nhận vé miễn phí

Trên trang thanh toán và trang vé:
- "**Quan tâm OA [Nhà xe]** để nhận vé và nhắc giờ xe qua Zalo".
- Ô **email (không bắt buộc)** với ghi chú "nhận vé qua email".
- Nút **"Lưu vé vào máy"**.

Nhờ vậy phần lớn vé đi qua kênh miễn phí, SMS chỉ còn cho số ít khách.

### 2.3. Nhắc giờ ra xe

Gửi qua kênh miễn phí trước (Zalo OA nếu khách đã quan tâm, email). Nếu nhà xe bật ZNS/SMS cho nhắc giờ thì gửi thêm, có tính vào hạn mức.

---

## 3. Chính sách trẻ em (cấu hình theo nhà xe)

### 3.1. Mặc định

| Thiết lập | Mặc định | Nhà xe đổi được |
|---|---|---|
| Tuổi được miễn phí khi nằm/ngồi chung | **Dưới 2 tuổi** | ✔ |
| Giá cho trẻ nằm chung | **0đ** | ✔ (VD thu 20% hoặc số tiền cố định) |
| Số trẻ nằm chung tối đa mỗi chỗ/phòng | **1** | ✔ |
| Tính vào sức chứa phòng (phòng đơn/đôi)? | **Không** | ✔ |
| Trẻ từ ngưỡng tuổi trở lên | Mua chỗ riêng hoặc tính là người thứ 2 của phòng đôi | ✔ |
| Bắt buộc khai báo khi đặt | **Có** (để phụ xe biết và đếm người) | — |

### 3.2. Hiển thị và lưu dữ liệu

- Khi chọn chỗ hoặc phòng, khách tích **"Kèm trẻ dưới 2 tuổi nằm chung (miễn phí)"**. Đã có trong [bản mẫu](../prototype/so-do-cho.html).
- Chính sách hiện **trước khi thanh toán** và được **chụp lại vào đơn** (PNTicketDocs mục 5.1, 5.4).
- Danh sách khách cho phụ xe có cột **"Trẻ <2 tuổi"** ([file Excel mẫu](../templates/mau-danh-sach-khach-theo-chuyen.xlsx)).
- Hệ thống **không đòi giấy tờ** chứng minh tuổi. Phụ xe kiểm tra thực tế khi lên xe theo quy định của nhà xe.

```
operator_policies.child_policy  -- JSON có phiên bản, ví dụ:
  { "free_under_age": 2, "price": 0, "max_per_unit": 1, "counts_toward_capacity": false }
booking_items.infant_count      -- số trẻ nằm chung đã khai báo
bookings.policy_snapshot        -- gồm child_policy tại thời điểm đặt
```

---

## 4. Checklist setup nhà xe trước khi hoạt động chính thức

Bạn làm cùng chủ xe cho **mỗi nhà xe mới**. Chỉ mở bán khi mọi mục bắt buộc (●) đã xong.

### A. Thông tin và hợp đồng
- [ ] ● Tên nhà xe, hình thức (hộ kinh doanh/doanh nghiệp), người đại diện, hotline
- [ ] ● **Tiền tố mã** (VD `PN`), duy nhất trên nền tảng
- [ ] ● Gói thu phí: **một lần** hoặc **theo số vé** (đơn giá, kỳ đối soát, định nghĩa vé tính phí)
- [ ] Logo, màu thương hiệu

### B. Xe, sơ đồ, tuyến
- [ ] ● Danh sách xe: tên, mã, loại, biển số (mặc định 2 xe)
- [ ] ● Sơ đồ chỗ thật của từng kiểu xe; kiểm tra mã chỗ khớp với nhãn dán trên xe
- [ ] ● Limousine: phòng nào cho phép phòng đôi (`capacity`)
- [ ] ● Tuyến, điểm đón/trả (tên, địa chỉ, tọa độ), thứ tự và giờ đón dự kiến
- [ ] ● Lịch chạy, thời điểm mở/đóng bán
- [ ] Mã thiết bị GPS từng xe (nếu đã biết hãng)

### C. Giá và chính sách
- [ ] ● Giá theo tuyến, tầng, loại chỗ; **giá phòng đơn và phòng đôi**
- [ ] ● Giá mùa Lễ/Tết (nếu có) và ngày áp dụng
- [ ] ● **Chính sách trẻ em** (mục 3)
- [ ] ● Cọc (% hoặc số tiền), hạn trả phần còn lại
- [ ] Chống giữ chỗ ảo: số đơn chưa thanh toán tối đa mỗi SĐT (mặc định 2); **chế độ cao điểm** (bắt buộc OTP SĐT) — chỉ bật được khi đã cấu hình SMS
- [ ] ● Thời gian giữ chỗ; giới hạn số chỗ mỗi đơn
- [ ] ● Chính sách đổi/hủy/hoàn, ai được duyệt hoàn

### D. Thanh toán (tiền vào tài khoản nhà xe)
- [ ] ● Tài khoản ngân hàng nhận tiền (khuyến nghị tài khoản riêng cho tiền vé)
- [ ] ● SePay: kết nối tài khoản ngân hàng; tạo webhook trỏ tới `https://<tên-miền>/api/v1/webhooks/payments/sepay`, chọn xác thực **API Key** (≥ 24 ký tự ngẫu nhiên), nhập cùng khóa đó khi cấu hình tài khoản nhận tiền trong trang quản trị
- [ ] Token API SePay (để đối soát định kỳ, bù webhook bị lỡ)
- [ ] ● Tỷ lệ cọc (`depositPercent`, mặc định 100% = trả đủ)
- [ ] ZaloPay/ví điện tử qua Checkout SDK (nếu nhà xe bật)
- [ ] ● Giao dịch thử ở môi trường thử nghiệm; giao dịch tiền thật nhỏ **có chủ tài khoản đồng ý**

### E. Kênh gửi vé và Zalo
- [ ] ● Tên miền/email gửi vé; SPF, DKIM, DMARC
- [ ] ● Zalo OA đã tạo và **đã xác thực**
- [ ] Mini App: đã đóng gói theo cấu hình nhà xe, đã qua kiểm duyệt
- [ ] Bật/tắt từng kênh: Zalo OA chat, ZNS (mẫu đã duyệt), SMS (tên người gửi); **hạn mức chi phí tin nhắn/tháng**
- [ ] ● Gửi thử vé, tin nhắc giờ đến số và email nội bộ

### F. Nhân sự và vận hành
- [ ] ● Tài khoản: chủ xe, kế toán, bán vé, điều hành, phụ xe; bật xác thực 2 lớp cho chủ xe và kế toán
- [ ] ● Số điện thoại liên hệ của từng chuyến (máy công ty cấp cho phụ xe)
- [ ] ● Phụ xe được hướng dẫn: danh sách khách, quét QR, xuất Excel, bàn giao tiền
- [ ] ● Chạy thử 1 chuyến với vé nội bộ trước ngày mở bán

---

## 5. Thay đổi cần đưa vào PNTicketDocs

| Mục | Thay đổi |
|---|---|
| 7.2 | Kênh gửi theo thứ tự ưu tiên miễn phí ở mục 2; hạn mức chi phí tin nhắn theo nhà xe |
| 5 | Thêm chính sách trẻ em có phiên bản, chụp vào đơn |
| 10 | `platform_plans`, `operator_subscriptions`, `billable_tickets`, `billing_statements`, `operator_policies.child_policy`, `booking_items.infant_count`, `notification_budgets` |
| 13 | AC: vé hủy trước giờ chạy không bị tính phí; gửi thành công qua kênh miễn phí thì không gửi SMS; vượt hạn mức tin nhắn chỉ dùng kênh miễn phí |
| 14 | Thêm checklist setup ở mục 4 vào quy trình triển khai mỗi nhà xe |
