# Hướng dẫn triển khai PNTicket

## Phương án A — Railway (Khuyến nghị cho Shared Hosting)

**Tại sao Railway?** Shared hosting không chạy được Node.js hay PostgreSQL.
Railway là PaaS (Platform-as-a-Service) deploy từ GitHub, tự cấp HTTPS,
hỗ trợ custom domain — phí ~$5–10/tháng (có $5 free credits để test ngay).

### Bước 1 — Đăng ký Railway

Truy cập [railway.app](https://railway.app) → **Login with GitHub**

### Bước 2 — Tạo project + PostgreSQL

1. **New Project → Deploy from GitHub repo** → chọn `dinhxuanhieu97/phongnhungticket`
2. Railway tự detect `railway.toml` và build.
3. Trong project, bấm **+ New** → **Database** → **Add PostgreSQL**
4. Railway tạo DB và tự gán biến `DATABASE_URL` vào service API.

### Bước 3 — Đặt biến môi trường

Vào service API → tab **Variables** → thêm:

```
BOOKING_TOKEN_SECRET=<32+ ký tự ngẫu nhiên>
AUTH_TOKEN_SECRET=<32+ ký tự ngẫu nhiên>
CORS_ORIGINS=https://miniapp.zalo.me,https://h5.zdn.vn
TRUST_PROXY=1
PORT=3000
```

Sinh secret: vào terminal máy tính chạy `openssl rand -hex 32` (cần OpenSSL/Git Bash).

### Bước 4 — Gắn domain api.dienmaykimbien.com.vn

1. Trong Railway → service API → **Settings** → **Networking** → **Custom Domain**
2. Nhập `api.dienmaykimbien.com.vn` → Railway hiển thị CNAME target (vd: `xxx.up.railway.app`)
3. Vào **bảng điều khiển shared hosting** → **DNS Manager** → thêm bản ghi:
   - **Type**: CNAME
   - **Name**: `api`
   - **Value**: `xxx.up.railway.app` (copy từ Railway)
   - **TTL**: 3600
4. Đợi 5–30 phút cho DNS cập nhật.
5. Railway tự cấp chứng chỉ HTTPS.

### Bước 5 — Tạo tài khoản admin

Sau khi Railway deploy xong, mở **Railway → service API → Terminal** (hoặc dùng CLI):

```bash
# Cài Railway CLI trên máy tính (nếu chưa có):
npm install -g @railway/cli
railway login
railway link   # chọn project

# Chạy create-admin:
railway run --service api \
  ADMIN_PHONE=09xxxxxxxx \
  ADMIN_NAME="Phong Nhung" \
  ADMIN_PASSWORD="MatKhauManhNe!" \
  node apps/api/dist/scripts/create-admin.js
```

### Bước 6 — Build và deploy Mini App Zalo

Trên **máy tính cá nhân** (cần `zmp` CLI và Zalo OA):

```bash
cd apps/miniapp
cp .env.example .env
# Mở .env, điền:
# VITE_API_BASE_URL=https://api.dienmaykimbien.com.vn
# VITE_OPERATOR_CODE=PN
# VITE_OPERATOR_NAME=Nhà xe Phong Nhung
pnpm build
zmp login          # quét QR bằng app Zalo
zmp deploy         # upload lên Zalo Mini App
```

### Bước 7 — Cấu hình webhook SePay

Trong [SePay](https://my.sepay.vn) → Tài khoản ngân hàng → Webhook:
- **URL**: `https://api.dienmaykimbien.com.vn/api/v1/webhooks/payments/sepay`
- **Nội dung**: JSON
- Lưu API key, cập nhật vào DB (xem docs/SETUP-NHA-XE.md)

### Cập nhật ứng dụng

```bash
git push origin main   # Railway tự động redeploy
```

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

---

## Kiểm tra sau deploy

```bash
# Thử gọi API (thay bằng domain thật):
curl https://api.dienmaykimbien.com.vn/api/v1/operators/PN/trips?date=2026-11-07

# Nên trả về:
# {"trips": [...]}
```
