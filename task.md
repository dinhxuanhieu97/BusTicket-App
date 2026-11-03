# task.md — Danh sách việc PNTicket

Quy ước: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong (typecheck + toàn bộ test pass + đã rà soát subagent). Xem quy trình trong `CLAUDE.md`.

## Giai đoạn 1 — Nền tảng kho chỗ (xong 03/11/2026 · 121 test pass)

- [x] **T1. Khung dự án**: pnpm workspace, `apps/api` (NestJS 11 + `pg`), migration SQL, Jest unit + integration với PostgreSQL thật, bộ lọc lỗi chuẩn (mã lỗi ổn định, thông điệp tiếng Việt).
- [x] **T2. Nhà xe, mẫu sơ đồ, xe**: tạo nhà xe (tiền tố mã, chính sách mặc định có phiên bản, 2 xe mặc định), thư viện mẫu sơ đồ (Limousine 24 phòng, giường nằm 36, ghế ngồi 29), bộ đọc/kiểm tra sơ đồ, phiên bản sơ đồ, tạo xe có kiểm tra nhà xe sở hữu.
- [x] **T3. Tuyến, chuyến, giá**: tạo tuyến; tạo chuyến sinh `trip_seats` từ phiên bản sơ đồ; giá theo tầng × số người (phòng đơn/đôi) bắt buộc đủ; tìm chuyến theo ngày (giờ VN); API sơ đồ chỗ công khai không lộ dữ liệu khách.
- [x] **T4. Giữ chỗ chống bán trùng**: `POST /api/v1/bookings` giữ nhiều chỗ nguyên tử (all-or-nothing), hết hạn giữ chỗ, phòng đơn/đôi, trẻ dưới 2 tuổi theo chính sách, chụp giá/chính sách vào đơn, `Idempotency-Key`, chuẩn hóa SĐT, mã đơn an toàn. Test AC-01, AC-02, AC-03, idempotency.

## Giai đoạn 2 — Tiếp theo

- [~] **T5. Xác thực nội bộ + phân quyền + cô lập nhà xe** (JWT, vai trò, 2FA cho chủ xe/kế toán) và API quản trị cho T2/T3. Chỉ quản trị nền tảng được sửa thư viện mẫu sơ đồ dùng chung.
- [ ] **T5b. Chống giữ chỗ ảo mùa cao điểm**: giới hạn tần suất `POST /bookings` theo IP và SĐT, số đơn đang giữ tối đa mỗi SĐT, OTP khi bật cao điểm (PNTicketDocs mục 5.2, 12).
- [ ] **T6. Thanh toán**: `payment_requests`, webhook SePay/payOS (xác thực chữ ký, chống trùng), phân bổ tiền, xác nhận đơn, ngoại lệ (thiếu/dư/muộn), xác nhận thủ công có quyền (mức 0).
- [ ] **T7. Vé + outbox + gửi vé**: phát hành vé theo đơn vị bán, QR token, outbox, kênh ưu tiên miễn phí (trang vé, email, Zalo OA) rồi ZNS/SMS, hạn mức chi phí tin.
- [ ] **T8. Danh sách khách theo chuyến**: API + xuất Excel theo mẫu `templates/mau-danh-sach-khach-theo-chuyen.xlsx`.
- [ ] **T9. Đếm vé tính phí nền tảng** (`billable_tickets`, bảng kê theo kỳ).
- [ ] **T10. Worker**: hết hạn giữ chỗ định kỳ, đối soát định kỳ, nhắc giờ.
- [ ] **T11. Zalo Mini App** (giao diện khách) dựa trên bản mẫu `prototype/so-do-cho.html`.
- [ ] **T12. Web quản trị** (Next.js).

## Phát hiện mới

<!-- Ghi mọi việc mới phát hiện trong khi làm: [ngày] [task] mô tả — trạng thái -->
- [ ] 03/11/2026 · T2 · **Sơ đồ xe thật** trong thư mục `Images/` chưa có trong repo (chỉ có trên máy người dùng). Đang dùng sơ đồ minh họa; cần đẩy `Images/` lên repo để thay mẫu sơ đồ. — **chờ người dùng**
- [x] 03/11/2026 · T2–T4 · Id không đúng dạng UUID làm PostgreSQL ném lỗi 22P02 (thành lỗi 500) thay vì NOT_FOUND. — đã sửa (`src/common/ids.ts`), test `review-findings.int-spec.ts`
- [x] 03/11/2026 · T3 · Sơ đồ chỗ công khai hiện cả chuyến DRAFT. — đã sửa: DRAFT trả NOT_FOUND
- [x] 03/11/2026 · T2/T4 · `FOR UPDATE` trên `operators`/`trips` chặn các giao dịch chèn bản ghi có FK. — đã đổi sang `FOR NO KEY UPDATE`
- [x] 03/11/2026 · T4 · Tổng tiền đơn có thể tràn cột `int` (giá 100 triệu + giá trẻ em không trần). — trần giá 20 triệu/chỗ, trần tổng 2 tỷ (`LIMIT_EXCEEDED`)
- [ ] 03/11/2026 · T5 · Khi thêm API đổi trạng thái/sơ đồ xe: `createTrip` phải khóa xe (`FOR SHARE`) để không chạy đua với thay đổi xe.
- [ ] 03/11/2026 · T5 · Biển số toàn khoảng trắng đang lưu `""` thay vì NULL; tên xe phân biệt hoa/thường ("Xe 03" ≠ "xe 03") — quyết định khi làm form quản trị.
- [ ] 03/11/2026 · T10 · `expireDueHolds()` đã có nhưng chưa có worker gọi định kỳ (luồng giữ chỗ vẫn tự hết hạn "lười" nên không bán trùng).

### Rà soát subagent — T1–T4 (03/11/2026)

| Service | Subagent kết luận | Bằng chứng | Agent chính kiểm tra lại | Bị ảnh hưởng? |
|---|---|---|---|---|
| `BookingsService` (+ `pricing.ts`) | Không bug; ghi chú tổng tiền `int` | `bookings.service.ts` khóa chuyến + `UPDATE … booking_id IS NULL` + kiểm `rowCount`; AC-01 50 yêu cầu song song pass | Ghi chú tràn `int` **đúng một phần**: subagent tính sai trần (bỏ qua giá trẻ em không giới hạn) → đã sửa, test `pricing.spec.ts` "rejects a total above the booking limit" | Có (thấp) — đã sửa |
| `TripsService` | Không bug; ghi chú chuyến DRAFT lộ ra | `trips.service.ts` `seatMap` không lọc trạng thái | Tái hiện bằng test "seatMap hides a DRAFT trip" (đỏ → xanh) | Có (thấp) — đã sửa |
| `OperatorsService` | Không bug; ghi chú UUID sai dạng + `FOR UPDATE` chặn FK | Script thử 20 lần cập nhật song song; lỗi 22P02 | Tái hiện: test "a policy update does not wait…" **đỏ (blocked)** → đổi `FOR NO KEY UPDATE` → xanh; test UUID đỏ → xanh; thêm test cập nhật song song và rollback giữa chừng | Có (trung bình) — đã sửa |
| `VehiclesService` | Không bug; ghi chú UUID sai dạng | `vehicles.service.ts` `get` truyền id thẳng vào SQL | Tái hiện bằng test UUID (đỏ → xanh) | Có (thấp) — đã sửa |
| `SeatLayoutsService` (+ parser, thư viện) | Không bug | Khóa advisory theo (nhà xe, mã) trước khi đọc `MAX(version)`; khóa `layout-library`; test tạo 4 nhà xe song song | Đọc lại code khóa + test thư viện chỉ tạo 1 lần: đồng ý | Không |
