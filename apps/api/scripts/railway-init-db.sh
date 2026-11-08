#!/bin/zsh
# Khởi tạo dữ liệu cho database Railway: seed nhà xe PN + tạo tài khoản quản trị.
# Chạy trong Terminal (cần nhập tay): ./apps/api/scripts/railway-init-db.sh
# Mọi thông tin nhạy cảm được nhập trực tiếp tại đây, không lưu lại ở đâu.
set -e
cd "$(dirname "$0")/../../.."   # về thư mục gốc repo

if [[ -t 0 ]]; then
  echo "Dán DATABASE_PUBLIC_URL (Railway → Postgres → Connect → Public Network), rồi Enter."
  echo "(Hoặc chỉ nhấn Enter để lấy từ clipboard)"
  read -rs DB_URL; echo
fi
if [[ -z "$DB_URL" ]]; then
  DB_URL="$(pbpaste)"
  echo "Dùng URL từ clipboard."
fi
# Bỏ khoảng trắng, xuống dòng, dấu nháy, và tiền tố "DATABASE_PUBLIC_URL=" nếu lỡ chép cả dòng
DB_URL="${DB_URL//[[:space:]]/}"
DB_URL="${DB_URL//\"/}"; DB_URL="${DB_URL//\'/}"
DB_URL="${DB_URL#DATABASE_PUBLIC_URL=}"
[[ "$DB_URL" == *'${{'* ]] && { echo "Bạn đã chép MẪU tham chiếu (có \${{...}}), không phải giá trị thật."; echo "Trong Railway, bấm vào dòng DATABASE_PUBLIC_URL → biểu tượng con mắt để hiện giá trị → nút copy."; exit 1; }
[[ "$DB_URL" == postgres* ]] || { echo "URL không hợp lệ (phải bắt đầu bằng postgresql://)"; exit 1; }
[[ "$DB_URL" == *railway.internal* ]] && { echo "Đây là URL nội bộ — cần DATABASE_PUBLIC_URL (host *.proxy.rlwy.net)"; exit 1; }
DB_URL="$DB_URL" node -e 'const u=new URL(process.env.DB_URL); if(!u.hostname||!u.port) throw 0; console.log("URL hợp lệ, host: "+u.hostname+":"+u.port)' \
  || { echo "URL không phân tích được — hãy chép lại giá trị DATABASE_PUBLIC_URL."; exit 1; }

echo "== Seed nhà xe PN =="
DATABASE_URL="$DB_URL" pnpm --filter api seed

echo
echo "== Tạo tài khoản quản trị nền tảng =="
if [[ ! -t 0 ]]; then
  echo "Bỏ qua tạo admin: bước này cần nhập mật khẩu, hãy chạy script trong panel Terminal (không dùng ô '!')."
  exit 0
fi
read -r "ADMIN_NAME?Họ tên admin: "
read -r "ADMIN_PHONE?Số điện thoại admin (09...): "
read -rs "ADMIN_PASSWORD?Mật khẩu admin (ẩn khi gõ): "; echo
read -rs "ADMIN_PASSWORD2?Nhập lại mật khẩu: "; echo
[[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD2" ]] || { echo "Mật khẩu không khớp"; exit 1; }

DATABASE_URL="$DB_URL" ADMIN_NAME="$ADMIN_NAME" ADMIN_PHONE="$ADMIN_PHONE" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  pnpm --filter api create-admin

unset DB_URL ADMIN_PASSWORD ADMIN_PASSWORD2
echo
echo "Xong. Đăng nhập lần đầu sẽ yêu cầu bật xác thực 2 lớp."
