# PNTicket — Đặt vé xe khách trên Zalo Mini App

🇻🇳 Tiếng Việt · 🇬🇧 [English](README.en.md)

Nền tảng đặt vé xe giường nằm/limousine cho **nhiều nhà xe**: khách chọn chỗ và chuyển khoản ngay trong Zalo; nhà xe quản lý chuyến, kho chỗ, tiền cọc, khách lên xe và đối soát. Phong Nhung (`PN`) là nhà xe đầu tiên.

Repo này gồm **API** và **Zalo Mini App**. Trang quản trị cho nhà xe nằm ở repo riêng [BusTicket-DashboardAdmin](https://github.com/dinhxuanhieu97/BusTicket-DashboardAdmin).

```
Khách (Zalo Mini App) ─┐
                       ├──► API NestJS ──► PostgreSQL
Nhà xe (Dashboard) ────┘        ▲
                     SePay webhook (tiền về)
```

## Tính năng chính

**Cho khách (Mini App)**
- Tìm chuyến theo ngày/tuyến, xem sơ đồ chỗ thật theo tầng (giường nằm, limousine phòng đơn/đôi), trẻ dưới 2 tuổi.
- Giữ chỗ có đếm ngược, chọn điểm đón/trả, đặt cọc hoặc trả đủ bằng QR chuyển khoản; đơn tự xác nhận khi tiền về.
- Vé của tôi, biên nhận tải/chia sẻ được, QR soát vé có chữ ký.

**Cho nhà xe (qua API quản trị)**
- Tuyến, điểm đón/trả, đội xe, thư viện sơ đồ chỗ, bảng giá theo tầng/số người, lịch chạy tự động sinh chuyến.
- Bán vé tại quầy, nhập danh sách khách từ Excel, sửa đơn (liên hệ, điểm đón/trả, ghi chú), hủy đơn và hoàn tiền.
- Sổ thu: thu tiền mặt/chuyển khoản thủ công, phân bổ vào đơn, xử lý tiền về trễ.
- Phụ xe xem chuyến được giao và đánh dấu khách lên xe theo từng chỗ.
- Phân quyền theo vai trò (Chủ xe, Điều phối, Bán vé, Kế toán, Phụ xe, Quản trị nền tảng), 2FA, nhật ký thao tác.

**Nguyên tắc an toàn không đổi**
- PostgreSQL là nguồn sự thật: mỗi chỗ trên một chuyến chỉ có tối đa một đơn giữ (khóa hàng + khóa chính).
- Mọi truy vấn lọc theo nhà xe lấy từ phía máy chủ; API công khai không trả tên/SĐT khách.
- Tiền là số nguyên VND; giá và chính sách được chụp vào đơn lúc đặt. Thao tác ghi tiền dùng `Idempotency-Key`.
- Giờ lưu UTC, ngày nghiệp vụ theo `Asia/Ho_Chi_Minh`.

## Công nghệ

| Phần | Công nghệ |
|---|---|
| `apps/api` | NestJS 11, PostgreSQL 14+ (SQL thuần qua `pg`, migration trong `src/db/migrations`), Zod, Jest |
| `apps/miniapp` | React 18, ZMP UI/SDK, React Router 7, TanStack Query, Zustand, Tailwind, Vite |
| Hạ tầng | Railway (tự deploy `main`), GitHub Actions |

## Cấu trúc

```
apps/
  api/        API NestJS: auth, bookings, trips, payments, operators, vehicles, seat-layouts, audit
  miniapp/    Zalo Mini App cho khách
docs/         Đặc tả sản phẩm và các quyết định
prototype/    Bản mẫu giao diện tĩnh (sơ đồ chọn chỗ)
templates/    File mẫu (Excel danh sách khách theo chuyến)
Images/       Ảnh sơ đồ xe thật dùng để dựng mẫu sơ đồ
```

## Chạy trên máy local

Yêu cầu: Node.js 22+, pnpm 10, PostgreSQL 14+.

```bash
pnpm install
```

```bash
createdb pnticket_dev
```

Biến môi trường cho terminal chạy API (giá trị dưới đây **chỉ dùng khi dev**; mỗi bí mật ≥ 32 ký tự):

```bash
export DATABASE_URL="postgres://localhost/pnticket_dev" BOOKING_TOKEN_SECRET=dev-only-booking-secret-0123456789abcdef AUTH_TOKEN_SECRET=dev-only-auth-secret-0123456789abcdefgh
```

> PostgreSQL cài qua Homebrew chỉ nghe qua socket: dùng `postgres://localhost/pnticket_dev?host=/tmp`.

```bash
pnpm --filter api migrate
```

```bash
pnpm --filter api seed
```

Tạo tài khoản quản trị nền tảng đầu tiên (dùng mật khẩu của riêng bạn):

```bash
ADMIN_PHONE=09xxxxxxxx ADMIN_NAME="Quản trị" ADMIN_PASSWORD='<mật-khẩu-mạnh>' pnpm --filter api create-admin
```

Chạy API ở cổng 3001 (3000 dành cho `zmp start`):

```bash
pnpm --filter api build && PORT=3001 pnpm --filter api start
```

```bash
curl "http://localhost:3001/api/v1/operators/PN/trips?date=$(TZ=Asia/Ho_Chi_Minh date +%F)"
```

Chạy Mini App trên trình duyệt (Vite chuyển `/api` sang `VITE_API_PROXY_TARGET`, mặc định `http://localhost:3001`):

```bash
cp apps/miniapp/.env.example apps/miniapp/.env
```

```bash
pnpm --filter miniapp dev
```

Mở http://localhost:5173 ở cỡ màn hình điện thoại. Chạy trong Zalo bằng `pnpm --filter miniapp start` (cần `zmp-cli` và đăng nhập). Chi tiết: [apps/miniapp/README.md](apps/miniapp/README.md).

### Biến môi trường API

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL |
| `BOOKING_TOKEN_SECRET`, `AUTH_TOKEN_SECRET` | Khóa ký token đơn và phiên đăng nhập (≥ 32 ký tự, khác nhau) |
| `TRUST_PROXY` | **Bắt buộc** khi chạy sau proxy/load balancer (số tầng proxy hoặc danh sách subnet) |
| `PORT` | Cổng HTTP |
| `CORS_ORIGINS` | Origin được phép gọi API (domain Mini App) |
| `ZALO_APP_SECRET_KEYS` | Secret Key của từng Mini App, dạng `PN=...,ABC=...` |
| `PNTICKET_LOGIN_PROXY_KEY` | Khóa dùng chung với Dashboard để giới hạn đăng nhập theo IP khách |
| `AUTH_REQUIRE_MFA`, `AUTH_ACCESS_TTL_SECONDS`, `HOLD_SWEEP_INTERVAL_MS`, `TRIP_SCHEDULE_INTERVAL_MS` | Tùy chọn vận hành |

Không commit file `.env*`. Cấu hình production: [DEPLOY.md](DEPLOY.md).

## Kiểm tra

```bash
pnpm -r typecheck
```

```bash
pnpm --filter miniapp test
```

Test API gồm unit + integration với PostgreSQL thật. Integration test **xóa sạch schema `public`** của database test, nên không bao giờ trỏ vào database thật:

```bash
createdb pnticket_test && DATABASE_URL_TEST="postgres://localhost/pnticket_test" pnpm --filter api test
```

## Triển khai

- Mọi thay đổi đi qua PR từ nhánh `hieufeature_<tên>`; CI chạy typecheck, unit test, build, integration test với PostgreSQL và Claude review.
- Railway tự deploy API khi `main` đổi. Mini App deploy bằng `zmp deploy` (bản Testing, sau đó gửi Zalo duyệt để phát hành).
- Hướng dẫn đầy đủ (Railway, biến môi trường, CI/CD, sự cố thường gặp): [DEPLOY.md](DEPLOY.md).

## Tài liệu

- 📘 [docs/PNTicketDocs.md](docs/PNTicketDocs.md) — Định hướng sản phẩm và đặc tả (**tài liệu chính**).
- 📱 [docs/ZALO-MINI-APP.md](docs/ZALO-MINI-APP.md) — Zalo Mini App làm kênh đặt vé (ZNS, Checkout SDK, điểm đón).
- 🏢 [docs/NEN-TANG-DA-NHA-XE.md](docs/NEN-TANG-DA-NHA-XE.md) — Nhiều nhà xe, limousine phòng đơn/đôi, danh sách khách theo chuyến.
- ✅ [docs/SETUP-NHA-XE.md](docs/SETUP-NHA-XE.md) — Phí nhà xe, gửi vé, chính sách trẻ em, checklist setup.
- 🔐 [docs/PHAN-QUYEN.md](docs/PHAN-QUYEN.md) — Bảng phân quyền theo vai trò.
- 🚌 [docs/DOI-XE-SO-DO-CHO.md](docs/DOI-XE-SO-DO-CHO.md) — Đội xe, sơ đồ chỗ, mã chỗ và trạng thái chỗ.
- 📝 [docs/GOP-Y-PNTicketDocs.md](docs/GOP-Y-PNTicketDocs.md) — Góp ý, rủi ro và đề xuất cho bản v0.1.

Quy ước làm việc: [CLAUDE.md](CLAUDE.md). Theo dõi công việc: [task.md](task.md).

## Giấy phép

Chưa công bố giấy phép mã nguồn mở; mọi quyền thuộc về chủ sở hữu repo.
