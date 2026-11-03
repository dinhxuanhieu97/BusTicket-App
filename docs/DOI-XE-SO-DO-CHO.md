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

### Đội xe mặc định

Khi tạo nhà xe mới, hệ thống tạo sẵn 2 xe; mã xe dùng **tiền tố của nhà xe** (xem [NEN-TANG-DA-NHA-XE.md](NEN-TANG-DA-NHA-XE.md) mục 1).

| Tên | Mã | Loại | Mẫu sơ đồ |
|---|---|---|---|
| Xe 01 | PN01 | Limousine | Limousine 24 phòng (bán theo phòng đơn/đôi) |
| Xe 02 | PN02 | Giường nằm | Giường nằm 40 chỗ |

Mẫu "Ghế ngồi 29 chỗ" có sẵn trong thư viện mẫu, dùng khi nhà xe thêm xe ghế ngồi.

## 2. Quy ước mã chỗ

**Dùng đúng mã đang dán trên xe** để nhân viên và khách không bị nhầm. Hệ thống chấp nhận mã gồm 1–2 chữ cái in hoa + 1–2 chữ số (`A1`, `B10`, `D6`…), duy nhất trong một sơ đồ. **Tầng của chỗ là tầng chứa chỗ đó trong sơ đồ**, không suy ra từ mã.

Hai cách đánh số thường gặp (ảnh trong thư mục `Images/`):

| Kiểu xe | Cách đánh số | Ảnh |
|---|---|---|
| **Giường nằm 40 chỗ** | Theo **dãy**: A (phía tài xế), B (giữa), C (phía cửa lên), D (hàng cuối). **Số lẻ ở tầng dưới, số chẵn ở tầng trên** cùng vị trí (A1 dưới, A2 ngay trên). Dãy D: D1–D5 tầng dưới, D6–D10 tầng trên. | `Images/40-GIUONG.webp` |
| **Limousine 24 phòng** | Theo **tầng**: A1–A12 tầng 1 (dưới), B1–B12 tầng 2 (trên), 2 dãy trái/phải. | `Images/so-do-giường-mẫu-tham-khảo-2.jpeg` |

Sơ đồ được vẽ **từ đầu xe về cuối xe, trái sang phải khi nhìn theo hướng xe chạy** (tài xế bên trái, cửa lên bên phải).

## 3. Mẫu sơ đồ chỗ (seat layout)

Mỗi mẫu là một **lưới** theo từng tầng. Nhà xe vẽ mẫu một lần, các xe cùng kiểu dùng chung.

### 3.1. Cách khai báo

Tầng có mã `1` (tầng dưới) và `2` (tầng trên). Mỗi hàng là một chuỗi, các ô cách nhau bằng dấu cách:

| Ký hiệu | Ý nghĩa |
|---|---|
| `A1`, `B10`, `D6`… | Một chỗ bán được |
| `.` | Lối đi |
| `_` | Ô trống |
| `TX` | Tài xế (chỉ để hiển thị) |
| `CUA` | Cửa lên xuống (chỉ để hiển thị) |
| `WC` | Nhà vệ sinh (chỉ để hiển thị) |

Ví dụ **Giường nằm 40 chỗ** đúng theo `Images/40-GIUONG.webp`:

```json
{
  "code": "BED40",
  "name": "Giường nằm 40 chỗ",
  "unit": "giường",
  "kind": "bed",
  "floors": [
    { "code": "1", "label": "Tầng dưới",
      "rows": ["TX . _ . CUA", "A1 . B1 . C1", "A3 . B3 . C3", "A5 . B5 . C5", "A7 . B7 . C7", "A9 . B9 . C9", "D1 D2 D3 D4 D5"] },
    { "code": "2", "label": "Tầng trên",
      "rows": ["A2 . B2 . C2", "A4 . B4 . C4", "A6 . B6 . C6", "A8 . B8 . C8", "A10 . B10 . C10", "D6 D7 D8 D9 D10"] }
  ]
}
```

Ví dụ **Limousine 24 phòng** (`defaultMaxOccupancy: 2` = mỗi phòng tối đa 2 người):

```
Tầng 1: TX . CUA | A1 . A2 | A3 . A4 | … | A11 . A12
Tầng 2:          B1 . B2 | B3 . B4 | … | B11 . B12
```

Trang quản trị sau này sẽ có **trình vẽ sơ đồ kéo-thả**, lưu ra cùng định dạng trên. Khi lưu, máy chủ kiểm tra: mã đúng dạng và không trùng trong cả xe, mỗi tầng có mã riêng, có ít nhất một chỗ bán được.

### 3.2. Thuộc tính từng chỗ (tùy chọn)

| Thuộc tính | Dùng để |
|---|---|
| `maxOccupancy` | Số người tối đa. Phòng limousine = 2 (bán được phòng đơn hoặc phòng đôi); phòng chỉ cho 1 người = 1. Xem [NEN-TANG-DA-NHA-XE.md](NEN-TANG-DA-NHA-XE.md) mục 3 |
| `sellable` | `false` cho chỗ giữ cho phụ xe, nhân viên |

Giá vé đặt theo **tầng × số người** (VD tầng dưới đắt hơn tầng trên; phòng đôi đắt hơn phòng đơn).

### 3.3. Phiên bản

Theo PNTicketDocs mục 5.1:
- Sửa mẫu sơ đồ thì tạo **phiên bản mới**. Chuyến đã mở bán vẫn giữ phiên bản cũ.
- Mỗi chuyến tạo ra một bộ `trip_seats` từ phiên bản sơ đồ của xe được gán, có **ràng buộc duy nhất (trip_id, seat_code)**.
- Đổi sơ đồ của xe chỉ ảnh hưởng chuyến tạo sau đó.

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
