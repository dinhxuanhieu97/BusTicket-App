# PNTicket — Nền tảng đặt vé xe khách online cho các nhà xe

🇻🇳 Tiếng Việt · 🇬🇧 [English version](README.en.md)

Nền tảng giúp khách đặt vé xe giường nằm/limousine online (chọn chỗ, chuyển khoản QR, nhận vé) và giúp nhà xe quản lý chuyến, kho chỗ, tiền cọc và đối soát tự động — đặc biệt trong mùa cao điểm Lễ, Tết. Hỗ trợ **nhiều nhà xe**; Phong Nhung (`PN`) là nhà xe đầu tiên.

## Trạng thái

| Phần                                                                                        | Trạng thái                                                                       |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/api` — kho chỗ, xác thực/phân quyền, chống giữ chỗ ảo, thanh toán SePay (T1–T6)       | ✅ Xong, 338 test                                                                |
| `apps/miniapp` — Zalo Mini App cho khách (T11)                                              | 🚧 Đã có khung: tìm chuyến → chọn chỗ → giữ chỗ → QR chuyển khoản → "Vé của tôi" |
| Vé + gửi vé (T7), danh sách khách (T8), phí nền tảng (T9), worker (T10), web quản trị (T12) | ⏳ Chưa làm                                                                      |

Chi tiết và các việc mới phát hiện: [task.md](task.md). Quy ước làm việc: [CLAUDE.md](CLAUDE.md).

## Cấu trúc

```
apps/
  api/        NestJS 11 + PostgreSQL (SQL thuần qua `pg`, migration trong src/db/migrations)
  miniapp/    Zalo Mini App: React 18 + ZMP UI/SDK, React Router 7, TanStack Query, Zustand, Tailwind
docs/         Đặc tả sản phẩm và các quyết định
prototype/    Bản mẫu giao diện tĩnh (sơ đồ chọn chỗ)
templates/    File mẫu (Excel danh sách khách theo chuyến)
Images/       Ảnh sơ đồ xe thật dùng để dựng mẫu sơ đồ
```

## Chạy trên máy local

### 1. Yêu cầu

- Node.js 22+ và pnpm 10 (`packageManager: pnpm@10.28.0`)
- PostgreSQL 14+ đang chạy

```bash
pnpm install
```

### 2. Database

```bash
createdb pnticket_dev
```

Đặt biến môi trường cho mỗi terminal chạy API. Hai bí mật phải dài **≥ 32 ký tự** (giá trị dưới đây chỉ dùng khi dev):

```bash
export DATABASE_URL="postgres://localhost/pnticket_dev" BOOKING_TOKEN_SECRET=dev-only-booking-secret-0123456789abcdef AUTH_TOKEN_SECRET=dev-only-auth-secret-0123456789abcdefgh
```

> PostgreSQL cài qua Homebrew chỉ nghe qua socket: dùng `postgres://localhost/pnticket_dev?host=/tmp`.

```bash
pnpm --filter api migrate
```

### 3. Dữ liệu mẫu

```bash
pnpm --filter api seed
```

Tạo nhà xe `PN` (2 xe mặc định: Limousine 24 phòng, giường nằm 40 chỗ), tuyến `HCM-HA` và 2 chuyến ngày mai.

> ⚠️ **Lỗi đã biết** (ghi trong `task.md`): `scripts/seed.ts` còn đặt giá theo tầng `A`/`B`, trong khi sơ đồ đã đổi sang tầng `1`/`2`, nên seed báo `VALIDATION_FAILED`. Tạm thời sửa `floor: 'A'` → `'1'` và `floor: 'B'` → `'2'` trong file đó. Nếu đã chạy seed lỗi một lần (nhà xe đã được tạo), xóa và tạo lại database rồi chạy lại `migrate` trước khi seed.

### 4. Chạy API

Dùng cổng **3001** (cổng 3000 để dành cho `zmp start` của Mini App):

```bash
pnpm --filter api build && PORT=3001 pnpm --filter api start
```

Kiểm tra:

```bash
curl "http://localhost:3001/api/v1/operators/PN/trips?date=$(TZ=Asia/Ho_Chi_Minh date +%F)"
```

Chạy sau proxy/load balancer thì **phải** đặt `TRUST_PROXY` (xem `CLAUDE.md`).

Để giới hạn đăng nhập Dashboard theo IP khách, đặt cùng `PNTICKET_LOGIN_PROXY_KEY` (ít nhất 32 ký tự ngẫu nhiên, chỉ dùng phía máy chủ) trên API và Dashboard. Trên Dashboard, đặt `PNTICKET_TRUSTED_CLIENT_IP_HEADER` thành tên header được ingress tin cậy **ghi đè** bằng một IP đã xác minh. Ingress phải loại bỏ giá trị do client gửi và chặn đường vào Dashboard bỏ qua ingress. API tiếp tục dùng `req.ip` cho các request đăng nhập trực tiếp.

### 5. Chạy Mini App

```bash
cp apps/miniapp/.env.example apps/miniapp/.env
```

```bash
pnpm --filter miniapp dev
```

Mở http://localhost:5173 (thu nhỏ trình duyệt về cỡ điện thoại). Vite chuyển tiếp `/api` sang `VITE_API_PROXY_TARGET` (mặc định `http://localhost:3001`) vì API chưa bật CORS.

Chạy qua Zalo Mini App CLI (cần cài `zmp-cli` và đăng nhập):

```bash
pnpm --filter miniapp start
```

Cấu hình trong `apps/miniapp/.env`: `VITE_OPERATOR_CODE`, `VITE_OPERATOR_NAME` (mỗi nhà xe một bản Mini App), `VITE_API_BASE_URL` (khi phát hành). Xem [apps/miniapp/README.md](apps/miniapp/README.md).

### 6. Thử luồng thanh toán khi chưa có SePay

Đơn giữ chỗ hết hạn sau `holdMinutes` (mặc định 10 phút). Màn QR chỉ hiện khi nhà xe đã cấu hình tài khoản nhận tiền (API quản trị `payment-account`). Để thử trạng thái "Đã xác nhận" trên database dev:

```bash
psql "$DATABASE_URL" -c "update bookings set status='CONFIRMED', paid_amount=total_amount, payment_status='PAID' where code='MÃ_ĐƠN'"
```

## Kiểm tra

```bash
pnpm -r typecheck
```

```bash
pnpm --filter miniapp test
```

Test API gồm unit + integration với PostgreSQL thật. Integration test **xóa sạch schema `public`** của database test — không trỏ vào database thật:

```bash
createdb pnticket_test && DATABASE_URL_TEST="postgres://localhost/pnticket_test" pnpm --filter api test
```

(mặc định `DATABASE_URL_TEST=postgres://pnticket:pnticket@localhost:5432/pnticket_test`)

## Tài liệu

- 📘 [docs/PNTicketDocs.md](docs/PNTicketDocs.md) — Định hướng sản phẩm và đặc tả triển khai (**tài liệu chính**).
- 📝 [docs/GOP-Y-PNTicketDocs.md](docs/GOP-Y-PNTicketDocs.md) — Góp ý, rủi ro và đề xuất bổ sung cho bản v0.1.
- 📱 [docs/ZALO-MINI-APP.md](docs/ZALO-MINI-APP.md) — Phương án dùng Zalo Mini App làm kênh đặt vé cho khách (ZNS, Checkout SDK, bản đồ điểm đón).
- 🏢 [docs/NEN-TANG-DA-NHA-XE.md](docs/NEN-TANG-DA-NHA-XE.md) — Nhiều nhà xe, thanh toán tiết kiệm, Limousine phòng đơn/đôi, danh sách khách theo chuyến (Excel).
- ✅ [docs/SETUP-NHA-XE.md](docs/SETUP-NHA-XE.md) — Thu phí nhà xe, gửi vé ưu tiên kênh miễn phí, chính sách trẻ em, checklist setup nhà xe.
- 🔐 [docs/PHAN-QUYEN.md](docs/PHAN-QUYEN.md) — Bảng phân quyền theo vai trò tài khoản.
- 🚌 [docs/DOI-XE-SO-DO-CHO.md](docs/DOI-XE-SO-DO-CHO.md) — Đội xe, mẫu sơ đồ giường/ghế, quy ước mã chỗ và trạng thái chỗ.

## Bản mẫu giao diện

- [prototype/so-do-cho.html](prototype/so-do-cho.html) — Sơ đồ chọn chỗ theo sơ đồ thật trong `Images/` (Limousine 24 phòng đơn/đôi, giường nằm 40 chỗ, ghế ngồi), kèm trẻ dưới 2 tuổi. Mở trực tiếp bằng trình duyệt.
- [templates/mau-danh-sach-khach-theo-chuyen.xlsx](templates/mau-danh-sach-khach-theo-chuyen.xlsx) — Excel mẫu danh sách khách theo chuyến cho phụ xe.
