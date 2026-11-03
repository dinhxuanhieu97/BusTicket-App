# task.md — Danh sách việc PNTicket

Quy ước: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong (typecheck + toàn bộ test pass + đã rà soát subagent). Xem quy trình trong `CLAUDE.md`.

## Giai đoạn 1 — Nền tảng kho chỗ (đang làm)

- [ ] **T1. Khung dự án**: pnpm workspace, `apps/api` (NestJS 11 + `pg`), migration SQL, Jest unit + integration với PostgreSQL thật, bộ lọc lỗi chuẩn (mã lỗi ổn định, thông điệp tiếng Việt).
- [ ] **T2. Nhà xe, mẫu sơ đồ, xe**: tạo nhà xe (tiền tố mã, chính sách mặc định có phiên bản, 2 xe mặc định), thư viện mẫu sơ đồ (Limousine 24 phòng, giường nằm 36, ghế ngồi 29), bộ đọc/kiểm tra sơ đồ, phiên bản sơ đồ, tạo xe có kiểm tra nhà xe sở hữu.
- [ ] **T3. Tuyến, chuyến, giá**: tạo tuyến; tạo chuyến sinh `trip_seats` từ phiên bản sơ đồ; giá theo tầng × số người (phòng đơn/đôi) bắt buộc đủ; tìm chuyến theo ngày (giờ VN); API sơ đồ chỗ công khai không lộ dữ liệu khách.
- [ ] **T4. Giữ chỗ chống bán trùng**: `POST /api/v1/bookings` giữ nhiều chỗ nguyên tử (all-or-nothing), hết hạn giữ chỗ, phòng đơn/đôi, trẻ dưới 2 tuổi theo chính sách, chụp giá/chính sách vào đơn, `Idempotency-Key`, chuẩn hóa SĐT, mã đơn an toàn. Test AC-01, AC-02, AC-03, idempotency.

## Giai đoạn 2 — Tiếp theo

- [ ] **T5. Xác thực nội bộ + phân quyền + cô lập nhà xe** (JWT, vai trò, 2FA cho chủ xe/kế toán) và API quản trị cho T2/T3.
- [ ] **T6. Thanh toán**: `payment_requests`, webhook SePay/payOS (xác thực chữ ký, chống trùng), phân bổ tiền, xác nhận đơn, ngoại lệ (thiếu/dư/muộn), xác nhận thủ công có quyền (mức 0).
- [ ] **T7. Vé + outbox + gửi vé**: phát hành vé theo đơn vị bán, QR token, outbox, kênh ưu tiên miễn phí (trang vé, email, Zalo OA) rồi ZNS/SMS, hạn mức chi phí tin.
- [ ] **T8. Danh sách khách theo chuyến**: API + xuất Excel theo mẫu `templates/mau-danh-sach-khach-theo-chuyen.xlsx`.
- [ ] **T9. Đếm vé tính phí nền tảng** (`billable_tickets`, bảng kê theo kỳ).
- [ ] **T10. Worker**: hết hạn giữ chỗ định kỳ, đối soát định kỳ, nhắc giờ.
- [ ] **T11. Zalo Mini App** (giao diện khách) dựa trên bản mẫu `prototype/so-do-cho.html`.
- [ ] **T12. Web quản trị** (Next.js).

## Phát hiện mới

<!-- Ghi mọi việc mới phát hiện trong khi làm: [ngày] [task] mô tả — trạng thái -->
- [ ] 03/11/2026 · T2 · **Sơ đồ xe thật** trong thư mục `Images/` chưa có trong repo (chỉ có trên máy người dùng). Đang dùng sơ đồ minh họa; cần đẩy `Images/` lên repo để thay mẫu sơ đồ.
