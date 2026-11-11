# Hướng dẫn triển khai PNTicket

Hiện trạng production (08/11/2026):

| Thành phần | Ở đâu |
|---|---|
| API (NestJS) | Railway, project `mindful-respect`, service `PhongNhungTicket`, domain `https://api.dienmaykimbien.com.vn` |
| Database | Railway, service `Postgres` (cùng project) |
| Mini App khách | Zalo Mini App "Đặt vé xe Hoài Ân", App ID `2835786331064843363` |
| Admin Dashboard | (sắp làm) shared hosting, `admin.dienmaykimbien.com.vn` |

---

## Phương án A — Railway (đang dùng)

**Tại sao Railway?** Shared hosting không chạy được Node.js hay PostgreSQL.
Railway deploy từ GitHub, tự cấp HTTPS, hỗ trợ custom domain — phí ~$5–10/tháng (gói Trial có $5 credit).

> **Lưu ý chung về Railway:** mọi thay đổi (thêm biến, thêm database, bật networking…) chỉ được **xếp hàng** —
> phải bấm **Deploy** ở thanh *"Apply N changes"* góc trên bên trái thì mới có hiệu lực.

### Bước 1 — Đăng ký Railway

Truy cập [railway.app](https://railway.app) → **Login with GitHub**.

### Bước 2 — Tạo project, service API và PostgreSQL

1. **New Project → Deploy from GitHub repo** → chọn `dinhxuanhieu97/PhongNhungTicket`.
   Repo không có nhánh `main`; nhánh đang dùng là `claude/zealous-wright-h92iz1`.
2. Railway dùng Railpack, đọc script `build`/`start` ở `package.json` gốc
   (`start` = chạy migration rồi mới chạy API — DB phải kết nối được thì API mới lên).
3. Trên canvas: chuột phải → **Database** → **PostgreSQL**. Kiểm tra canvas có **đúng 1** ô Postgres
   (đừng thêm nhầm Redis — ứng dụng không dùng Redis).

### Bước 3 — Đặt biến môi trường cho service API

Service API → **Variables** → **Raw Editor**, dán (thay 2 secret bằng giá trị thật):

```
DATABASE_URL="${{Postgres.DATABASE_URL}}"
BOOKING_TOKEN_SECRET="<64 ký tự hex>"
AUTH_TOKEN_SECRET="<64 ký tự hex khác>"
CORS_ORIGINS="https://miniapp.zalo.me,https://h5.zdn.vn"
TRUST_PROXY="1"
PORT="3000"
```

- Sinh secret trên máy: `openssl rand -hex 32` (chạy 2 lần, mỗi secret một giá trị). **Không** commit, không gửi qua chat.
- `DATABASE_URL` phải là **tham chiếu** `${{Postgres.DATABASE_URL}}` (đúng tên service `Postgres`), **không dán cứng**
  URL — dán cứng URL của một DB đã xóa sẽ lỗi `getaddrinfo ENOTFOUND postgres.railway.internal`.
- Bấm **Update Variables** → kiểm tra hiện đủ **6 Service Variables** → bấm **Deploy**.
- Khi có Admin Dashboard: thêm `,https://admin.dienmaykimbien.com.vn` vào cuối `CORS_ORIGINS`.
- Nút "Dùng tên và số điện thoại Zalo" ở trang đặt vé cần thêm biến
  `ZALO_APP_SECRET_KEYS="PN=<Secret Key của Mini App>"` (mỗi nhà xe một Mini App: `PN=...,ABC=...`).
  Secret Key lấy ở https://developers.zalo.me → **Quản lý ứng dụng** → chọn Zalo App gắn với Mini App → **Khóa bí mật của ứng dụng**. Không đặt biến này thì
  nút vẫn hiện nhưng báo khách nhập tay.

### Bước 4 — Gắn domain api.dienmaykimbien.com.vn

1. Service API → **Settings** → **Networking** → **Custom Domain** → nhập `api.dienmaykimbien.com.vn`.
2. **Target port = `3000`** (trùng biến `PORT`). Railway có thể tự điền port khác (vd. 8080/8083) →
   API vẫn chạy nhưng domain trả **502 "Application failed to respond"**. Sửa bằng nút bút chì ở dòng domain.
3. Railway hiện CNAME target (vd. `xxxxxxxx.up.railway.app`). Vào **DNS Manager của shared hosting** thêm:
   - Type `CNAME` · Name `api` · Value `<target Railway đưa>` · TTL 3600
4. Đợi 5–30 phút; Railway tự cấp HTTPS (dấu tích xanh cạnh domain).

Gói Trial chỉ gắn được **1 custom domain** — Admin Dashboard nên đặt trên shared hosting (xem Bước 8).

### Bước 5 — Khởi tạo dữ liệu (seed + tài khoản admin)

Script chạy **trên máy bạn**, kết nối DB Railway qua đường public tạm thời.

1. **Bật truy cập công khai cho Postgres (tạm):** service Postgres → **Settings → Networking → Public networking →
   TCP Proxy** (port `5432`) → bấm **Deploy** ở thanh "Apply changes". Đợi Postgres Online.
2. **Lấy URL thật:** service Postgres → nút **Connect** → tab **Public Network** → copy **Connection URL**.
   Dạng đúng: `postgresql://postgres:<mật-khẩu>@<tên>.proxy.rlwy.net:<port>/railway`.
   Nếu thấy `${{...}}` là đang chép *mẫu* — nghĩa là TCP Proxy chưa được Deploy.
3. **Chạy script trong panel Terminal** (không dùng ô `!` của Claude — script cần nhập tay):

   ```bash
   ./apps/api/scripts/railway-init-db.sh
   ```

   - Dán URL rồi Enter (hoặc chỉ Enter nếu URL đang nằm trong clipboard). Phải thấy
     `URL hợp lệ, host: …proxy.rlwy.net:…` thì seed mới chạy.
   - Seed tạo nhà xe `PN`, 2 xe mẫu, tuyến TP.HCM → Hoài Ân và **2 chuyến demo** (hủy trước khi bán thật).
     Chạy lại seed khi đã có nhà xe `PN` sẽ tự bỏ qua.
   - Sau đó nhập họ tên, SĐT, mật khẩu admin (ẩn khi gõ). Lần đăng nhập đầu bắt buộc bật 2FA.
4. **Tắt truy cập công khai:** Postgres → Settings → Networking → xóa TCP Proxy → **Deploy**.

### Bước 6 — Kiểm tra API

```bash
curl "https://api.dienmaykimbien.com.vn/api/v1/operators/PN/trips?date=YYYY-MM-DD"
```

| Kết quả | Ý nghĩa |
|---|---|
| `{"trips":[...]}` (200) | Thành công |
| `{"trips":[]}` (200) | Nhà xe có, nhưng ngày đó không có chuyến (chuyến demo của seed rơi vào "ngày mai" tính theo **UTC**) |
| `NOT_FOUND "Không tìm thấy nhà xe."` (404) | DB chưa seed (Bước 5) |
| `502 Application failed to respond` | Sai target port của domain (Bước 4) hoặc API đang crash — xem Deploy Logs |

Kiểm tra CORS cho Mini App:

```bash
curl -s -o /dev/null -D - -X OPTIONS -H "Origin: https://h5.zdn.vn" \
  -H "Access-Control-Request-Method: POST" https://api.dienmaykimbien.com.vn/api/v1/bookings | grep -i allow-origin
```

**Đọc lỗi trong Deploy Logs:**

| Log | Cách sửa |
|---|---|
| `Migration failed: getaddrinfo ENOTFOUND postgres.railway.internal` | Chưa có Postgres trong project hoặc `DATABASE_URL` không phải `${{Postgres.DATABASE_URL}}` |
| `Missing environment variable BOOKING_TOKEN_SECRET` (hoặc `AUTH_…`) | Chưa thêm secret, hoặc thêm nhưng chưa bấm Deploy |
| `DB up to date` + `Nest application successfully started` | API đã chạy |

### Bước 7 — Build và deploy Mini App Zalo

**Chuẩn bị một lần:**

1. Vào [miniapp.zaloplatforms.com](https://miniapp.zaloplatforms.com) → tài khoản nhà phát triển "Đặt vé xe Hoài Ân"
   → **Tạo Mini App** (Doanh nghiệp/Hộ kinh doanh · Giao thông vận tải · Vận chuyển hành khách, đặt xe).
   Mô tả **không** được chứa ký tự đặc biệt như `–`, `( )`, `/`.
2. Lấy **App ID của Mini App** trong *Mini App List* (dòng `ID: …`). Đừng nhầm với số trong URL
   `/developers/<số>` — đó là ID tài khoản nhà phát triển; dùng nhầm sẽ báo `Invalid Mini App ID`.
3. Cài CLI: `npm install -g zmp-cli`.
4. Trong `apps/miniapp`:
   - `.env` có `APP_ID=2835786331064843363` (file này không commit).
   - `.env.production` (không commit) — dùng khi build bản phát hành:

     ```
     VITE_API_BASE_URL=https://api.dienmaykimbien.com.vn
     VITE_OPERATOR_CODE=PN
     VITE_OPERATOR_NAME=Đặt vé xe Hoài Ân
     ```
5. Đăng nhập (trong panel Terminal, đứng ở `apps/miniapp`): `zmp login` → chọn QR → quét bằng Zalo **trong 60 giây**.
   Token được lưu vào `apps/miniapp/.env` (biến `ZMP_TOKEN`) → luôn chạy `zmp` từ thư mục này.

**Mỗi lần phát hành:**

```bash
cd apps/miniapp
./deploy-zalo.sh
```

Script tự `pnpm build`, tạm thay `app-config.json` bằng bản build sinh ra (có danh sách CSS/JS), chạy `zmp deploy`, xong thì khôi phục.
Trả lời CLI:

- *This is not a ZMP Project…* → **Deploy your existing project**
- *Where is your dist folder?* → `www`
- *Version status* → **Testing** (mở bằng QR cho người thử, không cần Zalo duyệt) hoặc **Development**
- *Description* → mô tả ngắn thay đổi của bản này

Kết quả đúng: `✔ Deploy Done!` + mã QR "View app at" + hạn mức (Testing tối đa 60 lần, Development 300 lần).

**Lỗi thường gặp:**

| Lỗi | Nguyên nhân / cách sửa |
|---|---|
| `Invalid Mini App ID` | `APP_ID` là ID tài khoản nhà phát triển hoặc tài khoản Zalo đăng nhập không có quyền với Mini App |
| `No asset defined… listSyncJS, listAsyncJS, listCSS` | Chạy `zmp deploy` trực tiếp → dùng `./deploy-zalo.sh` |
| CLI đòi đăng nhập lại | Đang chạy ngoài `apps/miniapp` (không thấy `ZMP_TOKEN`), hoặc token hết hạn → `zmp login` |
| Không thấy QR / không nhập được | Đang chạy bằng ô `!` của Claude → chạy trong panel Terminal hoặc app Terminal của macOS |
| Mini App mở được nhưng không tải chuyến | Origin của Zalo chưa có trong `CORS_ORIGINS` (Bước 3) |

Cảnh báo `NODE_TLS_REJECT_UNAUTHORIZED` khi chạy `zmp` là do chính zmp-cli đặt — bỏ qua.

**Lên bản chính thức (Production):** cần Zalo duyệt. Trước khi nộp: hủy chuyến demo, cấu hình SePay (Bước 9),
kiểm tra tên nhà xe, banner Mini App (1920×1080).

### Bước 8 — Admin Dashboard (shared hosting)

- Build giao diện ra file tĩnh, upload lên `admin.dienmaykimbien.com.vn` (thư mục web của subdomain trên shared hosting).
- Dashboard gọi `https://api.dienmaykimbien.com.vn/api/v1/admin/...` và `/api/v1/auth/...`.
- Thêm `https://admin.dienmaykimbien.com.vn` vào `CORS_ORIGINS` của service API (Bước 3) rồi Deploy.

### Bước 9 — Cấu hình webhook SePay

Trong [SePay](https://my.sepay.vn) → Tài khoản ngân hàng → Webhook:
- **URL**: `https://api.dienmaykimbien.com.vn/api/v1/webhooks/payments/sepay`
- **Nội dung**: JSON
- Lưu API key và cấu hình tài khoản nhận tiền qua `PUT /api/v1/admin/operators/:operatorId/payment-account`
  (xem docs/SETUP-NHA-XE.md).

### Cập nhật ứng dụng

- **API:** push lên nhánh đang gắn với Railway → Railway tự build lại. Nếu Settings → Source báo
  *"Auto deploy unavailable / Could not load branches"* → bấm **Retry** hoặc kết nối lại GitHub; tạm thời bấm
  **Deploy/Redeploy** tay trong tab Deployments.
- **Mini App:** `cd apps/miniapp && ./deploy-zalo.sh`.

### Dọn dẹp / bảo mật

- Tắt TCP Proxy của Postgres khi không cần chạy script từ máy.
- Xóa service thừa trên canvas (vd. Redis) để không tốn credit.
- Secret và `ZMP_TOKEN` chỉ nằm trong Railway Variables / `.env` trên máy — không commit, không in ra màn hình chia sẻ.

---

## CI/CD (GitHub Actions + Railway)

Áp dụng cho cả `BusTicket-App` và `BusTicket-DashboardAdmin`.

**CI (`.github/workflows/ci.yml`)**: chạy khi mở hoặc cập nhật PR, push lên `main` hoặc nhánh `hieufeature_*`.

| Job | Backend | Dashboard |
|---|---|---|
| `quick-checks` | typecheck, unit test, build API; typecheck, test, build Mini App | Prettier, typecheck, unit test, build |
| sau `quick-checks` | `integration`: test với PostgreSQL 17 dùng một lần trong container CI | `e2e`: Playwright với API giả, lưu trace khi lỗi |
| `claude-review` (chỉ PR) | Claude review và bình luận trên PR. File nhạy cảm (auth, payments, bookings, trips, migration) dùng Opus + effort cao (Sonnet + effort cao khi dùng token gói Pro) | tương tự; file nhạy cảm là proxy, phiên đăng nhập, `app/api` |

**@claude (`.github/workflows/claude.yml`)**: gõ `@claude` trong issue hoặc PR để hỏi hoặc giao việc. Chỉ người có quyền ghi vào repo mới kích hoạt được. Claude tạo nhánh `hieufeature_...` và mở PR, không push thẳng `main`.

**CD**: Railway tự deploy khi `main` có commit mới. Bật **Settings → Deploy → Wait for CI** ở từng service (`PhongNhungTicket`, `BusTicket-DashboardAdmin`) để Railway chỉ deploy khi workflow CI xanh.

**Thiết lập một lần**:
1. Cài GitHub App Claude cho hai repo: <https://github.com/apps/claude>, hoặc chạy `/install-github-app` trong Claude Code ở terminal.
2. Thêm thông tin xác thực Claude vào **Settings → Secrets and variables → Actions** của mỗi repo (chưa có secret nào thì `claude-review` tự bỏ qua, CI vẫn chạy):
   - **Khuyến nghị — gói Claude Pro/Max, không tính phí thêm:** chạy `claude setup-token` trên máy, đăng nhập, rồi lưu token vào secret `CLAUDE_CODE_OAUTH_TOKEN`. Review tính vào hạn mức của gói (dùng chung với lúc bạn dùng Claude); file nhạy cảm review bằng Sonnet + effort cao thay vì Opus để tiết kiệm hạn mức. Token hết hạn thì chạy lại lệnh và cập nhật secret. Token này là bí mật: không dán vào chat, issue hay file.
   - **Dự phòng — API key Console (tính phí theo token):** secret `ANTHROPIC_API_KEY`; chỉ dùng khi không có `CLAUDE_CODE_OAUTH_TOKEN`. Nên đặt giới hạn chi tiêu tháng trong Console.
3. Bảo vệ nhánh `main`: bắt buộc PR, bắt buộc các check `Typecheck, unit tests, build` và `Integration tests (PostgreSQL)` (backend) hoặc `Format, typecheck, unit tests, build` và `E2E (Playwright, fake API)` (dashboard) phải qua.
4. Bật "Wait for CI" trên Railway như trên.

---

## Phương án B — VPS với Docker (khi muốn toàn quyền kiểm soát)

Cần VPS Linux với quyền root (DigitalOcean $6/tháng, Vultr, v.v.).

### Cài Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # logout/login lại
```

### Deploy

```bash
git clone https://github.com/dinhxuanhieu97/phongnhungticket.git
cd phongnhungticket
cp .env.production.example .env.production
nano .env.production   # điền giá trị thật

# Mở Caddyfile, thay api.yourdomain.vn bằng api.dienmaykimbien.com.vn
# Trỏ A record DNS về IP VPS trước

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Khởi tạo dữ liệu: `DATABASE_URL=... pnpm --filter api seed` và
`DATABASE_URL=... ADMIN_PHONE=09... ADMIN_NAME="..." ADMIN_PASSWORD=... pnpm --filter api create-admin`.
