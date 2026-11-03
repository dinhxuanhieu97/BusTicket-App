# task.md — Danh sách việc PNTicket

Quy ước: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong (typecheck + toàn bộ test pass + đã rà soát subagent). Xem quy trình trong `CLAUDE.md`.

## Giai đoạn 1 — Nền tảng kho chỗ (xong 03/11/2026 · 121 test pass)

- [x] **T1. Khung dự án**: pnpm workspace, `apps/api` (NestJS 11 + `pg`), migration SQL, Jest unit + integration với PostgreSQL thật, bộ lọc lỗi chuẩn (mã lỗi ổn định, thông điệp tiếng Việt).
- [x] **T2. Nhà xe, mẫu sơ đồ, xe**: tạo nhà xe (tiền tố mã, chính sách mặc định có phiên bản, 2 xe mặc định), thư viện mẫu sơ đồ (Limousine 24 phòng, giường nằm 36, ghế ngồi 29), bộ đọc/kiểm tra sơ đồ, phiên bản sơ đồ, tạo xe có kiểm tra nhà xe sở hữu.
- [x] **T3. Tuyến, chuyến, giá**: tạo tuyến; tạo chuyến sinh `trip_seats` từ phiên bản sơ đồ; giá theo tầng × số người (phòng đơn/đôi) bắt buộc đủ; tìm chuyến theo ngày (giờ VN); API sơ đồ chỗ công khai không lộ dữ liệu khách.
- [x] **T4. Giữ chỗ chống bán trùng**: `POST /api/v1/bookings` giữ nhiều chỗ nguyên tử (all-or-nothing), hết hạn giữ chỗ, phòng đơn/đôi, trẻ dưới 2 tuổi theo chính sách, chụp giá/chính sách vào đơn, `Idempotency-Key`, chuẩn hóa SĐT, mã đơn an toàn. Test AC-01, AC-02, AC-03, idempotency.

## Giai đoạn 2 — Tiếp theo (T5 xong 03/11/2026 · 191 test pass)

- [x] **T5. Xác thực nội bộ + phân quyền + cô lập nhà xe** (JWT, vai trò, 2FA cho chủ xe/kế toán) và API quản trị cho T2/T3. Chỉ quản trị nền tảng được sửa thư viện mẫu sơ đồ dùng chung.
- [ ] **T5b. Chống giữ chỗ ảo mùa cao điểm**: giới hạn tần suất `POST /bookings` theo IP và SĐT, số đơn đang giữ tối đa mỗi SĐT, OTP khi bật cao điểm (PNTicketDocs mục 5.2, 12).
- [ ] **T6. Thanh toán**: `payment_requests`, webhook SePay/payOS (xác thực chữ ký, chống trùng), phân bổ tiền, xác nhận đơn, ngoại lệ (thiếu/dư/muộn), xác nhận thủ công có quyền (mức 0).
- [ ] **T7. Vé + outbox + gửi vé**: phát hành vé theo đơn vị bán, QR token, outbox, kênh ưu tiên miễn phí (trang vé, email, Zalo OA) rồi ZNS/SMS, hạn mức chi phí tin.
- [ ] **T8. Danh sách khách theo chuyến**: API + **xuất Excel để xem** theo mẫu `templates/mau-danh-sach-khach-theo-chuyen.xlsx`. Không cần in vé giấy/máy in nhiệt (chốt 03/11/2026).
- [ ] **T9. Đếm vé tính phí nền tảng** (`billable_tickets`, bảng kê theo kỳ).
- [ ] **T10. Worker**: hết hạn giữ chỗ định kỳ, đối soát định kỳ, nhắc giờ.
- [ ] **T11. Zalo Mini App** (giao diện khách) dựa trên bản mẫu `prototype/so-do-cho.html`.
- [ ] **T12. Web quản trị** (Next.js).

## Phát hiện mới

<!-- Ghi mọi việc mới phát hiện trong khi làm: [ngày] [task] mô tả — trạng thái -->
- [x] 03/11/2026 · T2 · **Sơ đồ xe thật** (`Images/`): xe 40 giường đánh mã **theo dãy** (A1 dưới, A2 trên), khác giả định "chữ cái = tầng". — đã đổi định dạng sơ đồ (tầng `1`/`2`, mã tự do 1–2 chữ + 1–2 số, ô `TX`/`CUA`/`WC`), thư viện BED40 + LIMO24 theo ảnh, bản mẫu giao diện cập nhật
- [x] 03/11/2026 · T2–T4 · Id không đúng dạng UUID làm PostgreSQL ném lỗi 22P02 (thành lỗi 500) thay vì NOT_FOUND. — đã sửa (`src/common/ids.ts`), test `review-findings.int-spec.ts`
- [x] 03/11/2026 · T3 · Sơ đồ chỗ công khai hiện cả chuyến DRAFT. — đã sửa: DRAFT trả NOT_FOUND
- [x] 03/11/2026 · T2/T4 · `FOR UPDATE` trên `operators`/`trips` chặn các giao dịch chèn bản ghi có FK. — đã đổi sang `FOR NO KEY UPDATE`
- [x] 03/11/2026 · T4 · Tổng tiền đơn có thể tràn cột `int` (giá 100 triệu + giá trẻ em không trần). — trần giá 20 triệu/chỗ, trần tổng 2 tỷ (`LIMIT_EXCEEDED`)
- [x] 03/11/2026 · T5 · `createTrip` khóa xe `FOR SHARE`; `vehicles.update` khóa `FOR UPDATE`. — đã làm
- [x] 03/11/2026 · T5 · Biển số chuẩn hóa (cắt khoảng trắng, viết hoa, rỗng → NULL); tên xe duy nhất không phân biệt hoa/thường và chuẩn hóa Unicode NFC. — đã làm
- [ ] 03/11/2026 · T10 · `expireDueHolds()` đã có nhưng chưa có worker gọi định kỳ (luồng giữ chỗ vẫn tự hết hạn "lười" nên không bán trùng).

- [x] 03/11/2026 · T5 · **Bug (Trung bình)**: viết id của chính mình bằng chữ HOA vượt qua chốt "không tự đổi vai trò/khóa/đặt lại mật khẩu" → chiếm tài khoản từ phiên bị lộ. — đã sửa (so với id từ DB), test "self-protection cannot be bypassed…"
- [x] 03/11/2026 · T5 · **Bug (Cao)**: gửi đăng nhập song song vượt giới hạn khóa 5 lần (thử được ~23 mật khẩu), lần đúng còn xóa khóa. — đã sửa (giữ lượt thử nguyên tử trước khi kiểm mật khẩu), test "parallel login bursts…"
- [x] 03/11/2026 · T5 · Mật khẩu đúng không kèm OTP từng có thể làm mới bộ đếm → đoán OTP vô hạn. — đã chặn, test "a correct password without the OTP…"
- [x] 03/11/2026 · T5 · `SecretBox.open` không cố định độ dài tag GCM. — đã đặt `authTagLength: 16`
- [x] 03/11/2026 · T5 · `redact()` chỉ lọc tầng ngoài, ít từ khóa. — lọc mọi tầng, thêm mfa/hash/key/cred
- [ ] 03/11/2026 · T5 · Nhật ký thao tác ghi **sau** khi transaction nghiệp vụ commit → nếu DB lỗi đúng lúc đó có thể mất dòng nhật ký. Cần ghi trong cùng transaction (truyền client từ service) — làm cùng T6 (thao tác tiền bắt buộc có nhật ký).
- [ ] 03/11/2026 · T5 · Tài khoản bị khóa trả `TOO_MANY_ATTEMPTS` còn SĐT không tồn tại trả `INVALID_CREDENTIALS` → lộ một phần sự tồn tại tài khoản sau 5 lần thử. Thấp; xem xét cùng giới hạn theo IP ở T5b.
- [x] 03/11/2026 · T5 · Phân quyền theo vai trò tài khoản (chốt 03/11/2026). Bảng quyền: `docs/PHAN-QUYEN.md`.

### Rà soát subagent — T5 (03/11/2026)

| Service | Subagent kết luận | Bằng chứng | Agent chính kiểm tra lại | Bị ảnh hưởng? |
|---|---|---|---|---|
| `AuthService` (+ jwt, password, totp) | **Bug Cao**: khóa đăng nhập bị vượt khi gửi song song; ghi chú tag GCM | `auth.service.ts` đọc `locked_until` không khóa, ~50 ms scrypt rồi mới ghi lỗi; PoC 30 yêu cầu song song → 23 lần kiểm mật khẩu | **Xác nhận**: test "parallel login bursts…" đỏ → sửa → xanh. Tự phát hiện thêm lỗ đoán OTP vô hạn → sửa + test | Có (Cao) — đã sửa |
| `UsersService` | **Bug Trung bình**: id viết HOA vượt chốt tự bảo vệ | `users.service.ts` so `actor.id === userId` (phân biệt hoa/thường) trong khi PostgreSQL so UUID không phân biệt; PoC đặt lại mật khẩu của chính mình | **Xác nhận**: test "self-protection cannot be bypassed…" đỏ → sửa → xanh; thêm `ORDER BY id` khi khóa chủ xe (tránh deadlock) | Có (Trung bình) — đã sửa |
| `AuthGuard` + `permissions` | Không bug; ghi chú thiếu test nhánh cho phép `mfa_setup` | Đọc 19 route quản trị đều có `@Perm`; chỉ `login` công khai | Đồng ý; thêm test nhánh `mfa_setup`, UUID viết hoa; thử bỏ `@Perm` một route → test bắt được | Không |
| `AdminController` + `AuditService` | Không bug; ghi chú `redact` nông, nhật ký không nguyên tử, test mật khẩu yếu | `audit.service.ts` chỉ lọc khóa tầng ngoài | Đồng ý: làm `redact` đệ quy + unit test; viết test đặt lại mật khẩu thật; nhật ký nguyên tử ghi vào việc cần làm | Không (đã gia cố) |
| `VehiclesService` | Không bug; ghi chú biển số kiểm độ dài trước khi cắt, tên chưa chuẩn hóa Unicode | `vehicles.service.ts` schema update | Đồng ý: sửa cả hai + test NFC/biển số; thêm test đổi sơ đồ xe không ảnh hưởng chuyến cũ | Không (đã gia cố) |
| `TripsService` | Không bug; ghi chú thiếu test chuyến CLOSED, đếm chỗ khóa/hết hạn | `trips.service.ts` `setStatus` khóa `FOR NO KEY UPDATE` trùng khóa với giữ chỗ | Đồng ý; thêm test CLOSED không đặt được, không thoát/không vào CANCELLED, đếm chỗ khóa/hết hạn, cô lập nhà xe | Không |

### Rà soát subagent — T1–T4 (03/11/2026)

| Service | Subagent kết luận | Bằng chứng | Agent chính kiểm tra lại | Bị ảnh hưởng? |
|---|---|---|---|---|
| `BookingsService` (+ `pricing.ts`) | Không bug; ghi chú tổng tiền `int` | `bookings.service.ts` khóa chuyến + `UPDATE … booking_id IS NULL` + kiểm `rowCount`; AC-01 50 yêu cầu song song pass | Ghi chú tràn `int` **đúng một phần**: subagent tính sai trần (bỏ qua giá trẻ em không giới hạn) → đã sửa, test `pricing.spec.ts` "rejects a total above the booking limit" | Có (thấp) — đã sửa |
| `TripsService` | Không bug; ghi chú chuyến DRAFT lộ ra | `trips.service.ts` `seatMap` không lọc trạng thái | Tái hiện bằng test "seatMap hides a DRAFT trip" (đỏ → xanh) | Có (thấp) — đã sửa |
| `OperatorsService` | Không bug; ghi chú UUID sai dạng + `FOR UPDATE` chặn FK | Script thử 20 lần cập nhật song song; lỗi 22P02 | Tái hiện: test "a policy update does not wait…" **đỏ (blocked)** → đổi `FOR NO KEY UPDATE` → xanh; test UUID đỏ → xanh; thêm test cập nhật song song và rollback giữa chừng | Có (trung bình) — đã sửa |
| `VehiclesService` | Không bug; ghi chú UUID sai dạng | `vehicles.service.ts` `get` truyền id thẳng vào SQL | Tái hiện bằng test UUID (đỏ → xanh) | Có (thấp) — đã sửa |
| `SeatLayoutsService` (+ parser, thư viện) | Không bug | Khóa advisory theo (nhà xe, mã) trước khi đọc `MAX(version)`; khóa `layout-library`; test tạo 4 nhà xe song song | Đọc lại code khóa + test thư viện chỉ tạo 1 lần: đồng ý | Không |
