# Nền tảng nhiều nhà xe, thanh toán tiết kiệm, phòng đơn/đôi và danh sách khách theo chuyến

> Ngày: 03/11/2026 · Trạng thái: Đề xuất để rà soát · Liên quan: [PNTicketDocs.md](PNTicketDocs.md), [ZALO-MINI-APP.md](ZALO-MINI-APP.md), [DOI-XE-SO-DO-CHO.md](DOI-XE-SO-DO-CHO.md)

## Quyết định ghi nhận (03/11/2026)

| Nội dung | Quyết định |
|---|---|
| Khách hàng của sản phẩm | **Chủ các nhà xe** (nhiều nhà xe). Phong Nhung là nhà xe đầu tiên |
| Số xe | Mặc định **2 xe** mỗi nhà xe; chủ xe tự thêm/bớt |
| Phí giao dịch | **Nhà xe chịu** → ưu tiên phương thức miễn phí hoặc rẻ nhất |
| Limousine | **Bán theo phòng**: phòng đơn (1 người), phòng đôi (2 người), **giá phòng đôi cao hơn** |
| Mỗi chuyến | Công ty cấp cho phụ xe giám sát danh sách: **tên, số điện thoại, điểm đón, điểm trả** của khách; quản lý được bằng **file Excel** |

---

## 1. Từ "web app cho một nhà xe" thành nền tảng nhiều nhà xe

PNTicketDocs mục 2.1 ghi "MVP phục vụ một nhà xe". Nay sản phẩm bán cho nhiều chủ xe, nên **thiết kế nhiều nhà xe (multi-tenant) ngay từ đầu**. Thêm sau sẽ rất tốn công vì phải sửa mọi bảng và mọi truy vấn.

### 1.1. Nguyên tắc

- Mỗi nhà xe là một **tenant** (`operators`). **Mọi** bảng nghiệp vụ (xe, tuyến, chuyến, đơn, tiền, nhân viên…) có cột `operator_id`.
- Máy chủ **luôn lọc theo nhà xe** của người đang đăng nhập. Không tin `operator_id` do giao diện gửi lên. Có kiểm thử tự động: nhân viên nhà xe A không đọc được dữ liệu nhà xe B (bổ sung AC-16).
- Mã do hệ thống sinh có **tiền tố của nhà xe** để không trùng và dễ nhận biết: mã xe `PN01`, mã đơn/mã thanh toán `PN7K3D2Q`. Tiền tố 2–4 ký tự, duy nhất trên toàn nền tảng.
- **Tiền đi thẳng vào tài khoản ngân hàng của từng nhà xe.** Nền tảng **không giữ hộ tiền** của khách, vì làm trung gian giữ tiền có thể phải xin giấy phép dịch vụ trung gian thanh toán. Mỗi nhà xe tự kết nối SePay/payOS, Checkout SDK bằng tài khoản của mình.
- Mỗi nhà xe có **cấu hình riêng**: logo, màu, tên hiển thị, hotline, chính sách cọc/hủy, thời gian giữ chỗ, mẫu tin nhắn.

### 1.2. Vai trò thêm

| Vai trò | Quyền |
|---|---|
| **Quản trị nền tảng** (bạn) | Tạo nhà xe mới, xem tình trạng hệ thống, hỗ trợ kỹ thuật. **Không** tự sửa đơn hay tiền của nhà xe; khi cần truy cập để hỗ trợ thì ghi nhật ký |
| Chủ nhà xe | Toàn quyền trong nhà xe của mình (như "Chủ xe/quản trị" ở PNTicketDocs mục 3) |
| Các vai trò khác | Như PNTicketDocs mục 3, nhưng chỉ trong phạm vi nhà xe được gán |

### 1.3. Kênh Zalo khi có nhiều nhà xe

| Cách | Mô tả | Ưu | Nhược |
|---|---|---|---|
| **A. Mỗi nhà xe một OA + một Mini App** (khuyến nghị) | Cùng một mã nguồn Mini App, đóng gói theo cấu hình từng nhà xe | Khách thấy đúng thương hiệu nhà xe; tin ZNS gửi từ OA của nhà xe; tiền và trách nhiệm rõ ràng | Mỗi nhà xe phải tự tạo, xác thực OA và qua kiểm duyệt Mini App |
| B. Một Mini App chung của nền tảng | Khách chọn nhà xe trong một Mini App | Chỉ một lần kiểm duyệt | Thương hiệu nhà xe mờ đi; khó gửi ZNS thay mặt từng nhà xe; thành "sàn vé" với trách nhiệm pháp lý khác |

**Đề xuất:** dùng cách A. Viết Mini App một lần, mỗi nhà xe chỉ khác **file cấu hình** (`operator_code`, OA ID, App ID, màu, logo). Cách B để sau nếu bạn muốn làm sàn vé.

### 1.4. Gói mặc định khi tạo nhà xe mới

- 2 xe mẫu (`Xe 01`, `Xe 02`) với mã theo tiền tố nhà xe, chủ xe sửa loại xe, sơ đồ và biển số.
- Thư viện mẫu sơ đồ dùng chung (Limousine 24 phòng, giường nằm, ghế ngồi…), chủ xe chọn hoặc nhân bản rồi chỉnh.
- Chính sách mặc định (giữ chỗ 10 phút, cọc 50%…) ở trạng thái **nháp**. Chủ xe phải xác nhận trước khi mở bán.

---

## 2. Thanh toán tiết kiệm nhất (nhà xe chịu phí)

### 2.1. Thứ tự ưu tiên

| Mức | Phương thức | Chi phí cho nhà xe | Xác nhận tiền | Khi dùng |
|---|---|---|---|---|
| **0 — Miễn phí** | **VietQR chuyển khoản thẳng vào tài khoản nhà xe**, kế toán **xác nhận trong trang quản trị** sau khi thấy tiền trong app ngân hàng | Thường **0đ** (nhận chuyển khoản liên ngân hàng thường không mất phí, cần kiểm tra với ngân hàng của nhà xe) | Thủ công, có nhật ký người xác nhận | Nhà xe mới, ít vé, ngày thường |
| **1 — Rẻ, tự động** (khuyến nghị mặc định) | VietQR + **SePay hoặc payOS** báo tiền về tự động | Gói miễn phí/thấp nhất của nhà cung cấp, tùy số giao dịch mỗi tháng (**cần xem bảng giá hiện hành**) | Tự động, vài giây | Mùa Lễ, Tết, khi lượng vé lớn |
| 2 — Tiện, có phí | **ZaloPay, ví điện tử, thẻ** qua Checkout SDK | Phí theo % giao dịch do cổng thanh toán quy định | Tự động qua callback | Khi khách không muốn chuyển khoản. Nhà xe **bật/tắt được** |

**Lưu ý về mức 0:**
- Xác nhận thủ công phải là **thao tác có quyền** (vai trò Kế toán/Chủ xe), ghi rõ số tiền, thời điểm và mã giao dịch ngân hàng, và lưu nhật ký (PNTicketDocs mục 6.4). Đây **không** phải nút "Tôi đã chuyển khoản" của khách; ảnh chụp biên lai không được coi là tiền đã về.
- Giữ chỗ phải đủ dài để kế toán kịp xác nhận, hoặc cho phép "Chờ xác nhận thanh toán" kéo dài thêm. Vì vậy mức 0 **không phù hợp mùa Tết**.

### 2.2. Gợi ý cấu hình mặc định

- **Ngày thường:** VietQR + SePay/payOS (mức 1). Mức 0 làm dự phòng khi nhà cung cấp gián đoạn.
- **ZaloPay/ví điện tử:** bật nhưng **hiển thị sau** VietQR, kèm dòng "Khuyên dùng: chuyển khoản QR — xác nhận nhanh". Nhà xe chịu phí nên không cần thu thêm phí của khách.
- **Báo cáo:** mỗi giao dịch lưu thêm `fee_amount` (phí cổng thanh toán, nếu có) để chủ xe thấy **tiền thực nhận** và tổng phí phải trả theo từng phương thức.
- Ghi chú: phí của SePay, payOS, ZaloPay và điều kiện cho **hộ kinh doanh** phải lấy **báo giá thực tế** khi đăng ký; tài liệu này không ghi con số cố định (PNTicketDocs mục 14.2).

---

## 3. Limousine bán theo phòng: phòng đơn / phòng đôi

### 3.1. Quy tắc

- **Đơn vị bán là phòng.** Một phòng chỉ có **một quyền chiếm chỗ** trên mỗi chuyến, dù 1 hay 2 người nằm.
- Khi chọn phòng, khách chọn **Phòng đơn (1 người)** hoặc **Phòng đôi (2 người)**. Mặc định là phòng đơn.
- **Giá phòng đôi > giá phòng đơn**, cấu hình theo tầng/vị trí và theo mùa. Ví dụ minh họa trong bản mẫu: tầng dưới 450.000đ / 700.000đ, tầng trên 420.000đ / 650.000đ.
- Phòng có `capacity` (sức chứa tối đa). Phòng chỉ cho 1 người (`capacity = 1`) thì không hiện lựa chọn phòng đôi.
- **Phòng đôi:** người đặt nhập tên người thứ hai (có thể để "khách đi cùng"). Trẻ **dưới 2 tuổi** nằm chung mặc định **miễn phí, không tính vào số người của phòng**; nhà xe đổi được khi setup ([SETUP-NHA-XE.md](SETUP-NHA-XE.md) mục 3).
- **Đổi đơn → đôi sau khi đặt:** tính chênh lệch và tạo yêu cầu thanh toán bổ sung. **Đôi → đơn:** khoản chênh lệch xử lý theo chính sách hoàn (PNTicketDocs mục 5.4).
- Giá và số người được **chụp lại vào đơn** lúc đặt (PNTicketDocs mục 5.1).

### 3.2. Vé và kiểm tra lên xe

- **Một vé cho một phòng**, ghi số người và tên từng người. Khác với PNTicketDocs mục 7.1 ("mã vé riêng cho từng hành khách"): với phòng đôi, một QR chung thuận tiện hơn vì hai người luôn đi cùng nhau. Đề xuất sửa mục 7.1 theo hướng: *vé theo đơn vị bán (chỗ hoặc phòng)*.
- Khi kiểm tra lên xe, phụ xe xác nhận **số người thực tế** lên xe (1/2). Lệch với số đã đặt thì ghi chú để xử lý.

### 3.3. Thay đổi dữ liệu

```
seats.capacity             -- 1 hoặc 2 cho phòng limousine; 1 cho giường/ghế
fare_rules                 (operator_id, route_id, seat_type, floor, occupancy, season, price)
                           -- occupancy = 1 (phòng đơn) | 2 (phòng đôi)
booking_items.occupancy    -- số người đã đặt cho phòng/chỗ
booking_items.unit_price   -- giá đã chụp theo occupancy
booking_passengers         (booking_item_id, full_name, phone NULL, is_child)
check_ins.boarded_count    -- số người thực tế lên xe
```

---

## 4. Danh sách khách theo chuyến cho phụ xe (Excel)

### 4.1. Thông tin chuyến

| Trường | Ghi chú |
|---|---|
| Mã chuyến | Duy nhất, VD `PN-20270201-1800-HCM-HA` |
| Tên chuyến | VD "TP.HCM → Hoài Ân 18:00" |
| Xe, biển số | Từ xe được gán |
| Tài xế, **phụ xe giám sát** | Nhân viên được phân công |
| **Số điện thoại liên hệ của chuyến** | Số máy công ty cấp cho phụ xe. Dùng trong ZNS "thông tin chuyến" thay cho số cá nhân |

### 4.2. Danh sách khách

Mỗi dòng là một phòng/chỗ đã xác nhận: **mã vé, phòng/chỗ, loại (đơn/đôi), số người, họ tên, số điện thoại, điểm đón, giờ đón dự kiến, điểm trả, tổng tiền, đã trả, còn phải thu, ghi chú**, cùng hai cột phụ xe điền: **đã lên xe, thực thu trên xe**. Danh sách được **sắp theo thứ tự điểm đón** để phụ xe gọi khách lần lượt.

File mẫu: [templates/mau-danh-sach-khach-theo-chuyen.xlsx](../templates/mau-danh-sach-khach-theo-chuyen.xlsx) gồm 3 sheet: thông tin chuyến, danh sách khách (có dòng tổng và công thức "còn phải thu"), hướng dẫn. Dữ liệu trong file là minh họa.

### 4.3. Xuất Excel (MVP)

- Điều hành bấm "Xuất danh sách" cho từng chuyến, hoặc hệ thống **tự gửi** cho phụ xe trước giờ chạy (VD trước 3 giờ). File ghi rõ **thời điểm xuất**, vì danh sách có thể thay đổi sau đó.
- Phụ xe vẫn nên dùng **trang danh sách trên điện thoại (PWA)** để luôn có bản mới nhất và quét QR. Excel là bản **dự phòng và để in**.
- File chứa số điện thoại khách nên phải: chỉ gửi cho phụ xe được phân công chuyến, liên kết tải có hạn, và ghi nhật ký ai đã xuất.

### 4.4. Nhập Excel (giai đoạn sau, có kiểm soát)

| Loại nhập | Cho phép? | Cách làm |
|---|---|---|
| Danh mục: xe, điểm đón/trả, lịch chuyến | ✔ | Tải file mẫu → điền → tải lên → **xem trước** → hệ thống báo lỗi từng dòng → xác nhận mới ghi |
| Kết quả chuyến: đã lên xe, thực thu | ✔ | Đối chiếu theo **mã vé**; không cho sửa giá hay đổi chỗ qua file; tạo bản ghi thu tiền mặt có chống ghi trùng |
| **Đơn đặt vé** (nhà xe chuyển từ sổ tay/Excel cũ sang) | ⚠ Chỉ một lần khi chuyển đổi | Mỗi dòng đi qua **đúng luồng giữ chỗ** như đặt vé thường. Chỗ đã có người thì báo lỗi, không ghi đè |
| Bán vé hằng ngày bằng Excel | ✘ | Bán ngoài hệ thống gây trùng chỗ (PNTicketDocs mục 12) |

---

## 5. Thay đổi cần đưa vào PNTicketDocs

| Mục | Thay đổi |
|---|---|
| 2.1 | "MVP phục vụ một nhà xe" → **nền tảng nhiều nhà xe**, Phong Nhung là nhà xe đầu tiên |
| 3 | Thêm vai trò **Quản trị nền tảng**; mọi vai trò khác giới hạn theo nhà xe |
| 5.1 | Limousine: đơn vị bán là **phòng**, có phòng đơn/đôi |
| 6.1 | Thứ tự phương thức thanh toán theo mục 2 ở trên; thêm `fee_amount`; xác nhận thủ công có quyền làm dự phòng |
| 7.1 | Vé theo **đơn vị bán** (chỗ hoặc phòng), ghi số người |
| 8.2 | Thêm "Xuất/nhập Excel" cho danh sách khách và danh mục |
| 10 | Thêm `operators`, `operator_id` cho mọi bảng, `booking_passengers`, `fare_rules.occupancy`, `trips.contact_phone`, `trips.supervisor_id`, `payments.fee_amount`, `import_jobs` |
| 13 | AC mới: cô lập dữ liệu giữa các nhà xe; đổi phòng đơn ↔ đôi; nhập Excel trùng chỗ bị từ chối |

## 6. Đã chốt thêm và câu hỏi còn lại

- Thu phí nhà xe: **một lần hoặc theo số vé**. Gửi vé: **ưu tiên kênh miễn phí**. Trẻ em: **dưới 2 tuổi nằm chung miễn phí**, cấu hình theo nhà xe. Chi tiết và checklist setup: [SETUP-NHA-XE.md](SETUP-NHA-XE.md).
- Còn cần trả lời: nhà xe có cần **in vé giấy** hoặc in danh sách bằng máy in nhiệt không?
