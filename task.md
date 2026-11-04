# task.md — Danh sách việc PNTicket

Quy ước: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong (typecheck + toàn bộ test pass + đã rà soát subagent). Xem quy trình trong `CLAUDE.md`.

## Giai đoạn 1 — Nền tảng kho chỗ (xong 03/11/2026 · 121 test pass)

- [x] **T1. Khung dự án**: pnpm workspace, `apps/api` (NestJS 11 + `pg`), migration SQL, Jest unit + integration với PostgreSQL thật, bộ lọc lỗi chuẩn (mã lỗi ổn định, thông điệp tiếng Việt).
- [x] **T2. Nhà xe, mẫu sơ đồ, xe**: tạo nhà xe (tiền tố mã, chính sách mặc định có phiên bản, 2 xe mặc định), thư viện mẫu sơ đồ (Limousine 24 phòng, giường nằm 36, ghế ngồi 29), bộ đọc/kiểm tra sơ đồ, phiên bản sơ đồ, tạo xe có kiểm tra nhà xe sở hữu.
- [x] **T3. Tuyến, chuyến, giá**: tạo tuyến; tạo chuyến sinh `trip_seats` từ phiên bản sơ đồ; giá theo tầng × số người (phòng đơn/đôi) bắt buộc đủ; tìm chuyến theo ngày (giờ VN); API sơ đồ chỗ công khai không lộ dữ liệu khách.
- [x] **T4. Giữ chỗ chống bán trùng**: `POST /api/v1/bookings` giữ nhiều chỗ nguyên tử (all-or-nothing), hết hạn giữ chỗ, phòng đơn/đôi, trẻ dưới 2 tuổi theo chính sách, chụp giá/chính sách vào đơn, `Idempotency-Key`, chuẩn hóa SĐT, mã đơn an toàn. Test AC-01, AC-02, AC-03, idempotency.

## Giai đoạn 2 — Tiếp theo (T5, T5b xong 03/11/2026; T6 xong 04/11/2026 · 338 test pass)

- [x] **T5. Xác thực nội bộ + phân quyền + cô lập nhà xe** (JWT, vai trò, 2FA cho chủ xe/kế toán) và API quản trị cho T2/T3. Chỉ quản trị nền tảng được sửa thư viện mẫu sơ đồ dùng chung.
- [x] **T5b. Chống giữ chỗ ảo mùa cao điểm**: giới hạn tần suất `POST /bookings` theo IP và SĐT, số đơn đang giữ tối đa mỗi SĐT, OTP khi bật cao điểm (PNTicketDocs mục 5.2, 12).
- [x] **T6. Thanh toán (SePay)**: webhook SePay (API Key theo từng tài khoản, chống trùng), phân bổ tiền, cọc theo %, xác nhận đơn, ngoại lệ (thiếu/dư/muộn/sai mã/trùng), xác nhận thủ công (mức 0), đối soát qua API SePay, QR thanh toán.
- [ ] **T7. Vé + outbox + gửi vé**: phát hành vé theo đơn vị bán, QR token, outbox, kênh ưu tiên miễn phí (trang vé, email, Zalo OA) rồi ZNS/SMS, hạn mức chi phí tin.
- [ ] **T8. Danh sách khách theo chuyến**: API + **xuất Excel để xem** theo mẫu `templates/mau-danh-sach-khach-theo-chuyen.xlsx`. Không cần in vé giấy/máy in nhiệt (chốt 03/11/2026).
- [ ] **T9. Đếm vé tính phí nền tảng** (`billable_tickets`, bảng kê theo kỳ).
- [ ] **T10. Worker**: hết hạn giữ chỗ định kỳ, đối soát định kỳ, nhắc giờ.
- [~] **T11. Zalo Mini App** (giao diện khách) dựa trên bản mẫu `prototype/so-do-cho.html`. 04/11/2026: đã có khung `apps/miniapp` (dựng từ template ZaUI Bistro) nối API công khai: tìm chuyến → sơ đồ chỗ → giữ chỗ (OTP cao điểm) → QR chuyển khoản → tự cập nhật khi tiền về → "Vé của tôi" lưu trên máy. 49 test (vitest), typecheck, build pass; đã chạy thử với API + PostgreSQL thật. Chưa rà soát subagent. Còn chờ API: đăng nhập Zalo/`/me/tickets`, vé (T7), điểm đón/trả.
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
- [x] 03/11/2026 · T5/T5b · Tài khoản bị khóa từng trả lỗi khác SĐT không tồn tại → dò được SĐT nào là tài khoản (và khóa luôn tài khoản đó). — tài khoản đang khóa trả đúng lỗi chung, cùng thời gian xử lý; thêm giới hạn đăng nhập theo IP
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

- [x] 03/11/2026 · T2 · Thư viện mẫu sơ đồ dùng chung không tự cập nhật khi định nghĩa trong code đổi → DB tạo trước đó giữ LIMO24 cũ (tầng A/B, mã A01) và **không tạo được chuyến Limousine**. — `ensureLibrary` tự thêm phiên bản mới khi định nghĩa khác, test `library-upgrade.int-spec.ts`
- [x] 03/11/2026 · T2 · Mã `A01` và `A1` có thể cùng tồn tại → dễ nhầm. — mã chỗ không cho số 0 đứng đầu
- [x] 03/11/2026 · T3 · Danh sách chỗ sắp xếp kiểu chữ (A1, A10, A3). — sắp xếp tự nhiên theo tầng → dãy → số
- [x] 03/11/2026 · T2 · Tầng trên lệch một hàng so với tầng dưới (A2 không thẳng trên A1). — thêm hàng trống đầu tầng trên trong BED40/LIMO24 và bản mẫu

### Rà soát subagent — Sơ đồ xe thật (03/11/2026)

| Service | Subagent kết luận | Bằng chứng | Agent chính kiểm tra lại | Bị ảnh hưởng? |
|---|---|---|---|---|
| `SeatLayoutsService` (parser, thư viện) | Không bug; BED40/LIMO24 **khớp ảnh** (hướng trái/phải, thứ tự D1–D5/D6–D10, lẻ dưới/chẵn trên); rủi ro thư viện cũ | Xem ảnh `40-GIUONG.webp` đã thu nhỏ; `seat-layouts.service.ts` `ensureLibrary` chỉ tạo khi thiếu | **Xác nhận rủi ro**: test `library-upgrade` đỏ → tự lên phiên bản → xanh. Ghi chú lệch hàng: đã căn thẳng | Có (Trung bình, chỉ DB cũ) — đã sửa |
| `BookingsService` (+ pricing) | Không bug; ghi chú `A01`/`A1` là hai mã khác nhau | Thử 416 mã để kiểm thứ tự sắp xếp/hash | Đồng ý; chặn số 0 đứng đầu | Không (đã gia cố) |
| `TripsService` | Không bug; cùng rủi ro thư viện cũ; sắp xếp chỗ kiểu chữ | Probe: BED40 20 chỗ/tầng, giá thấp nhất 350.000đ | Đồng ý; sửa sắp xếp tự nhiên + test | Không (đã gia cố) |
| `OperatorsService` | Không bug; rủi ro DB tạo trước commit | `library.get(...)!` luôn có vì `ensureLibrary` tạo đủ | Đồng ý (đã sửa ở `SeatLayoutsService`) | Không |

- [x] 03/11/2026 · T5b · **Bug (Cao)**: `PUT policy` thiếu 2 trường mới thì zod điền mặc định → **âm thầm tắt chế độ cao điểm** và đặt lại giới hạn giữ chỗ giữa mùa Tết; nhật ký ghi body gốc nên không thấy. — trường bỏ trống giữ nguyên giá trị cũ; nhật ký ghi chính sách sau khi gộp
- [x] 03/11/2026 · T5b · **Bug (Trung bình–Cao)**: bật OTP khi chưa cấu hình SMS → không ai đặt vé online được. — từ chối bật (`VALIDATION_FAILED`)
- [x] 03/11/2026 · T5b · **Bug (Trung bình)**: khóa giới hạn theo IP dùng nguyên chuỗi `req.ip` → một dải IPv6 /64 đổi địa chỉ để né mọi giới hạn; `::ffff:1.2.3.4` khác `1.2.3.4`. — `clientKey()` gom IPv6 theo /64, chuẩn hóa IPv4 nhúng
- [x] 03/11/2026 · T5b · Gửi OTP không kiểm tra nhà xe có bật cao điểm → spam SMS tốn tiền qua mọi nhà xe; giới hạn theo SĐT nhân lên theo số nhà xe. — chỉ gửi khi bật cao điểm; thêm giới hạn SĐT toàn nền tảng
- [x] 03/11/2026 · T5b · Khoảng cách gửi lại OTP "1 lần/phút" lách được ở ranh giới phút hoặc gửi song song; lần bị từ chối vẫn trừ hạn mức giờ. — kiểm tra dưới khóa theo thời điểm gửi cuối; chỉ trừ hạn mức khi gửi thật
- [x] 03/11/2026 · T5b · Gửi lại cùng `Idempotency-Key` (mạng chập chờn) bị tính vào giới hạn tần suất → khách nhận 429 thay vì đơn đã giữ. — trả đơn cũ trước khi tính giới hạn
- [x] 03/11/2026 · T5b · `TRUST_PROXY=true`/`loopback` bị đọc thành `NaN`. — `parseTrustProxy()` hỗ trợ số, true/false, danh sách subnet
- [ ] 03/11/2026 · T7 · Chế độ cao điểm (OTP) chỉ bật được khi đã cắm nhà cung cấp SMS thật. Zalo Mini App có thể lấy SĐT đã xác thực qua `getPhoneNumber` thay cho OTP (T11).
- [ ] 03/11/2026 · Vận hành · Chạy sau proxy/load balancer **phải** đặt `TRUST_PROXY`, nếu không mọi khách dùng chung IP của proxy và một người có thể làm cạn giới hạn của tất cả.

### Rà soát subagent — T5b (03/11/2026)

| Service | Subagent kết luận | Bằng chứng | Agent chính kiểm tra lại | Bị ảnh hưởng? |
|---|---|---|---|---|
| `OperatorsService` (chính sách) | **2 bug**: PUT thiếu trường tắt cao điểm; bật OTP khi chưa có SMS | `policy.ts` `.default()`; không kiểm tra SMS | **Xác nhận**: test `abuse-review` đỏ → sửa → xanh | Có (Cao) — đã sửa |
| `RateLimiter` + IP | **Bug Trung bình**: IPv6 /64 né giới hạn; `TRUST_PROXY` đọc sai | Khóa `booking-ip:${req.ip}` thô | **Xác nhận**: test gom /64 và `::ffff:` đỏ → xanh; unit test `client-ip.spec.ts` | Có (Trung bình) — đã sửa |
| `AuthService` (đăng nhập) | Không bug mới; lộ tài khoản qua lỗi khóa vẫn khai thác được từ nhiều IP | `auth.service.ts` trả `TOO_MANY_ATTEMPTS` khi khóa | **Xác nhận**: test "locked account answers exactly like an unknown phone" đỏ → xanh; test dồn dập đếm số lần so mật khẩu thật (spy) | Có (Trung bình) — đã sửa |
| `PhoneVerificationService` | Không bug nghiêm trọng; gửi OTP khi không cao điểm; khoảng cách gửi lại lách được | Đọc code + 18 test | **Xác nhận** cả hai bằng test đỏ → sửa; tự phát hiện thêm: lần bị từ chối vẫn trừ hạn mức giờ → sửa | Có (Thấp–Trung bình) — đã sửa |
| `BookingsService` | Không bug; ghi chú gửi lại cùng khóa bị tính giới hạn | Lock ordering, đếm dưới khóa SĐT | **Xác nhận**: test "retry … even when the IP limit is used up" đỏ → xanh. Thử bỏ khóa SĐT → test song song đỏ 5/5 lần | Có (Thấp) — đã sửa |

- [x] 04/11/2026 · T6 · **Bug (Cao)**: một lần chuyển khoản có thể **cộng hai lần** (kế toán xác nhận tay lúc SePay gián đoạn, sau đó webhook/đối soát đưa về cùng giao dịch) → đơn được xác nhận dù chỉ trả nửa cọc. — giao dịch SePay khớp ghi tay (cùng mã GD hoặc cùng đơn + số tiền trong 3 ngày) không tự cộng mà đánh dấu `POSSIBLE_DUPLICATE`; mã GD ghi tay là duy nhất; ghi tay khi SePay đã có khoản tương tự phải xác nhận rõ `confirmNotDuplicate`
- [x] 04/11/2026 · T6 · **Bug (Cao)**: quản trị nền tảng (hoặc phiên bị chiếm) đổi được tài khoản nhận tiền bất cứ lúc nào → chuyển hướng tiền, đặt khóa webhook mới để giả giao dịch. — chỉ thiết lập lần đầu; đổi sau đó chỉ chủ xe; nhật ký ghi tài khoản cũ/mới; outbox `payment_account.changed` để báo chủ xe (gửi ở T7)
- [x] 04/11/2026 · T6 · **Bug (Trung bình)**: đổi tài khoản nhưng khóa webhook của tài khoản cũ vẫn dùng được. — chỉ nhận webhook của tài khoản đang hoạt động
- [x] 04/11/2026 · T6 · **Bug (Trung bình)**: `amountDueNow` bảo khách chuyển tiền cho đơn hết hạn/đã hủy (thậm chí toàn bộ tổng tiền). — một quy tắc chung `amountDueNow()` cho cả đơn và hướng dẫn thanh toán
- [x] 04/11/2026 · T6 · **Bug (Trung bình)**: tên người gửi trùng tiền tố nhà xe (vd. "NGUYEN VAN AN" với nhà xe `AN`) làm mất mã đơn thật → khách trả đúng hạn vẫn có thể hết hạn. — tìm mã cho phép chồng nhau (lookahead)
- [x] 04/11/2026 · T6 · **Bug (Trung bình)**: khoản chuyển > 2,1 tỷ làm webhook lỗi mãi và chặn đối soát các giao dịch sau. — cột tiền của `payments` là `bigint`; đối soát bắt lỗi từng giao dịch
- [x] 04/11/2026 · T6 · **Bug (Trung bình)**: phần dư của khoản đã đánh dấu "đã xử lý" (vd. đã hoàn) vẫn phân bổ được vào đơn khác. — khoản RESOLVED bị khóa
- [x] 04/11/2026 · T6 · Quản trị nền tảng xem được chi tiết thao tác tiền qua nhật ký. — ẩn nhật ký `payment.*` với quản trị nền tảng
- [ ] 04/11/2026 · T6 · **Cần xác minh với SePay thật**: (1) định dạng header ký HMAC-SHA256 (hiện dùng xác thực API Key — đã xác nhận trong tài liệu), (2) tên trường API danh sách giao dịch để đối soát, (3) định dạng ảnh QR `qr.sepay.vn/img`. Môi trường này không truy cập được `developer.sepay.vn`.
- [ ] 04/11/2026 · T6 · Một nhà xe có thể "chiếm trước" số tài khoản của nhà xe khác (ràng buộc duy nhất theo số tài khoản). Webhook vẫn cần đúng API Key do chủ tài khoản đặt trong SePay nên không giả được tiền, nhưng nhà xe thật bị chặn cấu hình → cần quy trình xác minh quyền sở hữu tài khoản (quản trị nền tảng xử lý tay).
- [ ] 04/11/2026 · T6 · Đối soát chỉ lấy tối đa 5.000 giao dịch/lần, chưa phân trang; worker gọi định kỳ ở T10.
- [ ] 04/11/2026 · T6 · Hoàn tiền (refund có duyệt) chưa làm: hiện chỉ "đánh dấu đã xử lý" kèm ghi chú. Cần module hoàn tiền theo PNTicketDocs mục 5.4/6.4 (task mới).
- [ ] 04/11/2026 · T6 · Tiền đến muộn (LATE) chưa có thao tác "cấp lại chỗ" có kiểm tra — hiện kế toán xử lý ngoài hệ thống (hoàn tiền hoặc đặt hộ đơn mới).
- [ ] 04/11/2026 · T3 · **`scripts/seed.ts` lỗi** (`pnpm --filter api seed` báo `VALIDATION_FAILED` regex): giá vé dùng tầng `A`/`B` trong khi sơ đồ đã đổi sang tầng `1`/`2`. Seed còn tạo nhà xe trước rồi mới lỗi → chạy lại báo trùng. — chưa sửa
- [ ] 04/11/2026 · T11 · API chưa bật CORS: Mini App chạy trên domain của Zalo sẽ bị trình duyệt chặn. Dev dùng proxy của Vite; khi phát hành cần `enableCors` với danh sách domain Mini App (hoặc reverse proxy cùng origin).
- [ ] 04/11/2026 · T11 · Sơ đồ chỗ công khai không trả chính sách trẻ em (`childPolicy`: giá, tối đa mỗi chỗ) → Mini App chỉ tạm tính chưa gồm trẻ em và cho chọn tối đa 2 trẻ/chỗ theo schema; máy chủ mới kiểm tra đúng giới hạn. Nên thêm `childPolicy` vào `GET /trips/:id/seats`.
- [ ] 04/11/2026 · T11 · Chưa có API công khai liệt kê tuyến và điểm đón/trả (`stops`): Mini App lọc tuyến từ danh sách chuyến trong ngày, chưa chọn được điểm đón.
- [ ] 04/11/2026 · T11 · "Vé của tôi" đang lưu mã đơn + `accessToken` trong localStorage của máy → đổi máy/xóa dữ liệu là mất danh sách. Cần `POST /auth/zalo` + `GET /me/tickets` (ZALO-MINI-APP.md mục 6).
- [ ] 04/11/2026 · T11 · **Giấy phép template**: ZaUI Bistro ghi "non-commercial testing and evaluation purposes only". Cần xác nhận với Zalo được dùng cho sản phẩm thương mại, nếu không thì thay phần UI lấy từ template (layout, tabs, icon, tokens).

### Rà soát subagent — T6 (04/11/2026)

| Service | Subagent kết luận | Bằng chứng | Agent chính kiểm tra lại | Bị ảnh hưởng? |
|---|---|---|---|---|
| `PaymentsService` (sổ thu, phân bổ) | **2 bug**: cộng tiền hai lần (ghi tay + SePay); phân bổ được tiền đã hoàn | PoC: `paid_amount = 200000` cho khoản 100.000đ; đơn thứ hai xác nhận bằng tiền đã hoàn | **Xác nhận**: test `payments-review.int-spec.ts` đỏ → sửa → xanh | Có (Cao) — đã sửa |
| `sepay.ts` + webhook | **2 bug**: mã đơn bị "nuốt"; khoản > 2,1 tỷ lỗi mãi | Script: `extractBookingCodes('NGUYEN VAN AN CK AN7K3D2Q','AN')` → `['ANANCKAN']` | **Xác nhận**: test đỏ → lookahead, `bigint`, đối soát bắt lỗi từng dòng, timeout HTTP → xanh | Có (Trung bình) — đã sửa |
| Phân quyền + route thanh toán | **1 Cao + 2 Trung bình**: đổi tài khoản nhận tiền; khóa cũ còn hiệu lực; thiếu test HTTP | `permissions.ts` SETUP có `payment.configure`; tra tài khoản không lọc `active` | **Xác nhận**: test đỏ → sửa → xanh; thêm test HTTP 403/404 cho mọi route tiền (pass) | Có (Cao) — đã sửa |
| `BookingsService` + chính sách cọc | **1 bug**: `amountDueNow` cho đơn chết | `bookings.service.ts` dùng `status` thô | **Xác nhận**: test đỏ → quy tắc chung → xanh; làm tròn cọc kiểm 3 triệu trường hợp không sai | Có (Trung bình) — đã sửa |

### Rà soát subagent — T1–T4 (03/11/2026)

| Service | Subagent kết luận | Bằng chứng | Agent chính kiểm tra lại | Bị ảnh hưởng? |
|---|---|---|---|---|
| `BookingsService` (+ `pricing.ts`) | Không bug; ghi chú tổng tiền `int` | `bookings.service.ts` khóa chuyến + `UPDATE … booking_id IS NULL` + kiểm `rowCount`; AC-01 50 yêu cầu song song pass | Ghi chú tràn `int` **đúng một phần**: subagent tính sai trần (bỏ qua giá trẻ em không giới hạn) → đã sửa, test `pricing.spec.ts` "rejects a total above the booking limit" | Có (thấp) — đã sửa |
| `TripsService` | Không bug; ghi chú chuyến DRAFT lộ ra | `trips.service.ts` `seatMap` không lọc trạng thái | Tái hiện bằng test "seatMap hides a DRAFT trip" (đỏ → xanh) | Có (thấp) — đã sửa |
| `OperatorsService` | Không bug; ghi chú UUID sai dạng + `FOR UPDATE` chặn FK | Script thử 20 lần cập nhật song song; lỗi 22P02 | Tái hiện: test "a policy update does not wait…" **đỏ (blocked)** → đổi `FOR NO KEY UPDATE` → xanh; test UUID đỏ → xanh; thêm test cập nhật song song và rollback giữa chừng | Có (trung bình) — đã sửa |
| `VehiclesService` | Không bug; ghi chú UUID sai dạng | `vehicles.service.ts` `get` truyền id thẳng vào SQL | Tái hiện bằng test UUID (đỏ → xanh) | Có (thấp) — đã sửa |
| `SeatLayoutsService` (+ parser, thư viện) | Không bug | Khóa advisory theo (nhà xe, mã) trước khi đọc `MAX(version)`; khóa `layout-library`; test tạo 4 nhà xe song song | Đọc lại code khóa + test thư viện chỉ tạo 1 lần: đồng ý | Không |
