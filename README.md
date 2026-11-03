# PNTicket — Nền tảng đặt vé xe khách online cho các nhà xe

Web app giúp khách đặt vé xe giường nằm/limousine online (chọn chỗ, chuyển khoản QR, nhận vé qua Email/SMS) và giúp nhà xe quản lý chuyến, kho chỗ, tiền cọc và đối soát tự động — đặc biệt trong mùa cao điểm Lễ, Tết.

## Tài liệu

- 📘 [docs/PNTicketDocs.md](docs/PNTicketDocs.md) — Định hướng sản phẩm và đặc tả triển khai (**tài liệu chính**).
- 📝 [docs/GOP-Y-PNTicketDocs.md](docs/GOP-Y-PNTicketDocs.md) — Góp ý, rủi ro và đề xuất bổ sung cho bản v0.1.
- 📱 [docs/ZALO-MINI-APP.md](docs/ZALO-MINI-APP.md) — Phương án dùng Zalo Mini App làm kênh đặt vé cho khách (ZNS, Checkout SDK, bản đồ điểm đón).
- 🏢 [docs/NEN-TANG-DA-NHA-XE.md](docs/NEN-TANG-DA-NHA-XE.md) — Nhiều nhà xe, thanh toán tiết kiệm, Limousine phòng đơn/đôi, danh sách khách theo chuyến (Excel).
- 🚌 [docs/DOI-XE-SO-DO-CHO.md](docs/DOI-XE-SO-DO-CHO.md) — Đội xe (tên, mã, loại), mẫu sơ đồ giường/ghế, quy ước mã chỗ và trạng thái chỗ.

## Bản mẫu giao diện

- [prototype/so-do-cho.html](prototype/so-do-cho.html) — Sơ đồ chọn chỗ: 2 xe mặc định (Limousine bán theo phòng đơn/đôi, giường nằm) và mẫu ghế ngồi: còn trống / đang giữ / đã đặt / không bán. Mở trực tiếp bằng trình duyệt, không cần cài đặt.
- [templates/mau-danh-sach-khach-theo-chuyen.xlsx](templates/mau-danh-sach-khach-theo-chuyen.xlsx) — File Excel mẫu danh sách khách theo chuyến cho phụ xe.

> Trạng thái: giai đoạn thiết kế, chưa có mã nguồn hay kết nối thanh toán thật.
