# Đội xe và sơ đồ chỗ

> Ngày: 03/11/2026 · Trạng thái: Đề xuất để rà soát · Liên quan: [PNTicketDocs.md](PNTicketDocs.md) mục 5.1, 10 · Bản mẫu: [prototype/so-do-cho.html](../prototype/so-do-cho.html)

Tài liệu này mô tả cách quản lý **đội xe** của mỗi nhà xe (mặc định **2 xe**, chủ xe tự thêm; Phong Nhung là ví dụ đầu tiên) và **sơ đồ giường/ghế** để khách chọn chỗ. Biển số, số chỗ, giá và việc chia loại xe dưới đây là **dữ liệu minh họa**. Dữ liệu thật do nhà xe nhập trong trang quản trị.

## 1. Thông tin một xe

| Trường | Ví dụ | Quy tắc |
|---|---|---|
| Tên (`name`) | Xe 01 | Tên hiển thị cho nhân viên và khách, sửa được |
| Mã (`code`) | PN01 | **Duy nhất, không đổi**, viết hoa. Dùng trên vé, danh sách khách, báo cáo |
| Loại (`type`) | `LIMOUSINE` / `SLEEPER` / `SEATER` | Limousine (phòng) / Giường nằm thường / Ghế ngồi |
| Sơ đồ (`seat_layout`) | Limousine 24 phòng (v1) | Chọn từ **mẫu sơ đồ**; nhiều xe cùng kiểu dùng chung một mẫu |
| Biển số | (nhập khi triển khai) | Dùng cho vé, ZNS "thông tin chuyến" và đối chiếu thiết bị GPS |
| Thiết bị GPS | (mã thiết bị) | Để trống đến khi xác định được hãng (mục 5) |
| Trạng thái | Hoạt động / Bảo dưỡng / Ngưng | Xe đang bảo dưỡng không được gán vào chuyến mới |
| Ghi chú | "Có WC", "Cổng sạc USB" | Tiện ích hiển thị cho khách |

### Đội xe mặc định (minh họa)

Khi tạo nhà xe mới, hệ thống tạo sẵn 2 xe; mã xe dùng **tiền tố của nhà xe** (xem [NEN-TANG-DA-NHA-XE.md](NEN-TANG-DA-NHA-XE.md) mục 1).

| Tên | Mã | Loại | Mẫu sơ đồ |
|---|---|---|---|
| Xe 01 | PN01 | Limousine | Limousine 24 phòng (bán theo phòng đơn/đôi) |
| Xe 02 | PN02 | Giường nằm | Giường nằm 36 chỗ |

Mẫu "Ghế ngồi 29 chỗ" có sẵn trong thư viện mẫu, dùng khi nhà xe thêm xe ghế ngồi.

## 2. Quy ước mã chỗ

| Loại | Mã | Ví dụ |
|---|---|---|
| Tầng dưới (hoặc xe 1 tầng) | `A` + số 2 chữ số | A01 … A12 |
| Tầng trên | `B` + số 2 chữ số | B01 … B12 |

- Đánh số **từ đầu xe về cuối xe, từ trái sang phải** (nhìn theo hướng xe chạy), giống cách nhân viên đang gọi chỗ.
- Mã chỗ **in trên vé** và **dán tại giường/ghế** để khách tự tìm chỗ.
- Nếu nhà xe đang dùng cách đánh số khác (VD giường 1–40), giữ cách hiện tại để nhân viên và khách không bị nhầm. Hệ thống chỉ yêu cầu mã **duy nhất trong một sơ đồ**.

## 3. Mẫu sơ đồ chỗ (seat layout)

Mỗi mẫu là một **lưới** theo từng tầng. Nhà xe vẽ mẫu một lần, các xe cùng kiểu dùng chung.

### 3.1. Cách khai báo

Mỗi hàng là một chuỗi, các ô cách nhau bằng dấu cách:

| Ký hiệu | Ý nghĩa |
|---|---|
| `A01`, `B05`… | Một chỗ bán được |
| `.` | Lối đi |
| `_` | Ô trống (không có chỗ) |

Ví dụ **Limousine 24 phòng** (2 dãy, 6 hàng, 2 tầng):

```json
{
  "code": "LIMO24",
  "name": "Limousine 24 phòng",
  "version": 1,
  "unit": "phòng",
  "floors": [
    { "code": "A", "label": "Tầng dưới",
      "rows": ["A01 . A02", "A03 . A04", "A05 . A06", "A07 . A08", "A09 . A10", "A11 . A12"] },
    { "code": "B", "label": "Tầng trên",
      "rows": ["B01 . B02", "B03 . B04", "B05 . B06", "B07 . B08", "B09 . B10", "B11 . B12"] }
  ]
}
```

**Ghế ngồi 29 chỗ** (2+2, hàng cuối 5 ghế):

```
A01 A02 . A03 A04
...
A21 A22 . A23 A24
A25 A26 A27 A28 A29
```

Trang quản trị sau này sẽ có **trình vẽ sơ đồ kéo-thả**, lưu ra cùng định dạng trên. Khi lưu, máy chủ kiểm tra: mã không trùng, đúng tiền tố tầng, số chỗ khớp với sức chứa khai báo.

### 3.2. Thuộc tính từng chỗ (tùy chọn)

| Thuộc tính | Dùng để |
|---|---|
| `price_tier` | Giá khác nhau theo vị trí (VD tầng dưới đắt hơn, phòng đôi) |
| `capacity` | Số người tối đa. Phòng limousine = 2 (bán được phòng đơn hoặc phòng đôi); phòng chỉ cho 1 người = 1. Xem [NEN-TANG-DA-NHA-XE.md](NEN-TANG-DA-NHA-XE.md) mục 3 |
| `sellable` | `false` cho chỗ giữ cho phụ xe, nhân viên |
| `tags` | "gần cửa", "gần WC", "cửa sổ" để hiển thị cho khách |

### 3.3. Phiên bản

Theo PNTicketDocs mục 5.1:
- Sửa mẫu sơ đồ thì tạo **phiên bản mới**. Chuyến đã mở bán vẫn giữ phiên bản cũ.
- Mỗi chuyến tạo ra một bộ `trip_seats` từ phiên bản sơ đồ của xe được gán, có **ràng buộc duy nhất (trip_id, seat_code)**.
- Đổi xe cho chuyến đã có khách: hệ thống ánh xạ mã chỗ cũ sang xe mới. Nếu xe mới thiếu chỗ hoặc khác mã, hệ thống liệt kê khách bị ảnh hưởng và **chặn hoàn tất** cho đến khi điều hành xử lý xong (AC-15).

## 4. Trạng thái chỗ khách nhìn thấy

| Trạng thái | Hiển thị | Chọn được? | Nguồn |
|---|---|---|---|
| **Còn trống** | Nền trắng, viền xám, mã chỗ + giá | ✔ | `trip_seats` không có quyền chiếm hiệu lực |
| **Đang chọn** | Nền đỏ thương hiệu, dấu ✓ | (bỏ chọn) | Chỉ ở máy khách, **chưa giữ chỗ** |
| **Đang giữ** | Nền vàng nhạt, chữ "Đang giữ" | ✘ | Đơn HOLDING chưa hết hạn của người khác |
| **Đã đặt** | Nền xám đậm, chữ "Đã đặt" | ✘ | Đơn CONFIRMED |
| **Không bán** | Gạch chéo | ✘ | `sellable = false` hoặc điều hành khóa |

Quy tắc hiển thị:
- **Không dùng màu làm tín hiệu duy nhất** (PNTicketDocs mục 8.3): luôn kèm chữ hoặc biểu tượng.
- API sơ đồ chỗ (`GET /api/v1/trips/:id/seats`) **chỉ trả mã chỗ và trạng thái**, không trả tên hay số điện thoại người đặt.
- Gộp "Đang giữ" vào "Đã đặt" khi hiển thị cho khách là một lựa chọn (đơn giản hơn). Bản mẫu tách riêng để thấy rõ cơ chế giữ chỗ.
- Sơ đồ tự làm mới vài giây/lần. Nếu chỗ khách đang chọn vừa bị người khác giữ, bỏ chọn và báo ngay. Khi bấm "Tiếp tục", máy chủ mới là bên quyết định (`SEAT_UNAVAILABLE`).

## 5. Thiết bị giám sát hành trình (GPS)

Nhà xe đã lắp thiết bị nhưng chưa biết hãng. Cách xác định:
1. Xem **nhãn trên thiết bị** hoặc **hợp đồng/hóa đơn** lắp đặt.
2. Xem **trang web hoặc ứng dụng** mà chủ xe dùng để xem hành trình xe: tên miền và logo cho biết nhà cung cấp.
3. Hỏi nhà cung cấp: có **API** (hoặc webhook) trả vị trí theo thời gian thực không, có tính phí không, và mã thiết bị của từng xe là gì.

Khi có API: lưu `gps_device_id` cho từng xe. Worker lấy vị trí của **xe đang chạy chuyến**, và chỉ hiện cho khách có vé của chuyến trong khoảng gần giờ đón (ZALO-MINI-APP mục 3.2). Đây là việc của giai đoạn sau, không chặn MVP.

## 6. Mô hình dữ liệu (bổ sung PNTicketDocs mục 10)

```
vehicles        (id, operator_id, code UNIQUE, name, type, plate_number, seat_layout_id,
                 gps_device_id, status, amenities, created_at, updated_at)
seat_layouts    (id, code, name, unit, version, floors_json, capacity,
                 UNIQUE(code, version))
seats           (id, seat_layout_id, code, floor, row, col, price_tier,
                 capacity, sellable, tags, UNIQUE(seat_layout_id, code))
trips           (..., vehicle_id, seat_layout_id  -- phiên bản đã chụp)
trip_seats      (id, trip_id, seat_code, status, booking_item_id NULL,
                 hold_expires_at NULL, UNIQUE(trip_id, seat_code))
```
