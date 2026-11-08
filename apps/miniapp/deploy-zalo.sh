#!/bin/zsh
# Build bản phát hành rồi deploy lên Zalo Mini App.
# zmp-cli ("Deploy your existing project") đọc app-config.json ở thư mục dự án, không phải trong www,
# nên tạm thay bằng bản do build sinh ra (có listCSS/listSyncJS), deploy xong thì khôi phục.
# Chạy trong panel Terminal (cần tương tác): ./deploy-zalo.sh   — khi được hỏi dist folder, nhập: www
set -e
cd "$(dirname "$0")"

pnpm build

cp app-config.json app-config.json.bak
restore() { mv -f app-config.json.bak app-config.json; }
trap restore EXIT INT TERM
cp www/app-config.json app-config.json

zmp deploy
