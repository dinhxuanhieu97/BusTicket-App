# Hướng dẫn triển khai PNTicket

## Yêu cầu

- VPS Linux (Ubuntu 22.04+ khuyến nghị), tối thiểu 1 vCPU / 1GB RAM
- Docker Engine 24+ và Docker Compose plugin (`docker compose`)
- Tên miền, trỏ A record `api.<domain>` về IP VPS
- Cổng 80 và 443 mở

## Bước 1 — Cài Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # rồi logout/login lại
docker --version                # kiểm tra
```

## Bước 2 — Clone repo và tạo file env

```bash
git clone https://github.com/dinhxuanhieu97/phongnhungticket.git
cd phongnhungticket
cp .env.production.example .env.production
nano .env.production            # điền các giá trị thật
```

Sinh secret ngẫu nhiên:
```bash
openssl rand -hex 32   # chạy 2 lần, dùng cho BOOKING_TOKEN_SECRET và AUTH_TOKEN_SECRET
```

## Bước 3 — Cấu hình domain trong Caddyfile

Mở `Caddyfile`, thay `api.yourdomain.vn` bằng domain thật:
```
api.phongnhung.vn {
    reverse_proxy api:3000
    ...
}
```

Bỏ comment phần `caddy:` trong `docker-compose.prod.yml`.

## Bước 4 — Build và khởi động

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml logs -f api    # theo dõi log
```

Lần đầu: migration chạy tự động trước khi API start.

## Bước 5 — Tạo tài khoản admin

```bash
docker compose -f docker-compose.prod.yml exec api \
  sh -c "cd /app && DATABASE_URL=postgres://pnticket:${DB_PASSWORD}@db:5432/pnticket \
  ADMIN_PHONE=09xxxxxxxx ADMIN_NAME='Phong Nhung' ADMIN_PASSWORD='MatKhauManhNe!' \
  node -e \"require('./apps/api/dist/scripts/create-admin')\""
```

Hoặc chạy từ host (cần biết DB_PASSWORD):
```bash
DATABASE_URL=postgres://pnticket:matkhau@localhost:5432/pnticket \
ADMIN_PHONE=09xxxxxxxx ADMIN_NAME='Phong Nhung' ADMIN_PASSWORD='MatKhauManhNe!' \
pnpm --filter api create-admin
```

## Bước 6 — Cấu hình webhook SePay

Trong [SePay](https://my.sepay.vn) → Tài khoản ngân hàng → Webhook:
- URL: `https://api.<domain>/api/v1/webhooks/payments/sepay`
- Nội dung: JSON
- Lưu API key, điền vào cột `webhook_api_key` trong bảng `payment_accounts` (xem docs/SETUP-NHA-XE.md)

## Bước 7 — Build và deploy Mini App

Trên máy cá nhân (cần `zmp` CLI và Zalo OA):

```bash
cd apps/miniapp
cp .env.example .env
# Điền VITE_API_BASE_URL=https://api.<domain> và các biến khác
pnpm build
zmp login          # quét QR bằng app Zalo
zmp deploy         # upload lên Zalo Mini App
```

## Backup PostgreSQL hằng ngày

```bash
# Thêm vào crontab (cron 2h sáng)
0 2 * * * docker exec <container_db> pg_dump -U pnticket pnticket | gzip > /backups/pnticket-$(date +\%Y\%m\%d).sql.gz
# Giữ 7 ngày
0 3 * * * find /backups -name 'pnticket-*.sql.gz' -mtime +7 -delete
```

## Cập nhật ứng dụng

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build api
```
