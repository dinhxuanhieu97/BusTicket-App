# Đề xuất: đồng bộ tab, luồng chọn chỗ – giữ chỗ – thanh toán, quyền chủ xe

> Ngày: 10/11/2026 · Trạng thái: **đề xuất, chưa triển khai** · Liên quan: `PNTicketDocs.md` mục 5, `PHAN-QUYEN.md`, `ZALO-MINI-APP.md`, checklist tại [task.md workspace](../../task.md) (mục "Đợt 3").

Bốn yêu cầu:

1. Các tab trên cùng trình duyệt có cùng trạng thái đăng nhập.
2. Chọn chỗ và đặt vé là phần quan trọng nhất: giao diện thống nhất, thao tác ít bước.
3. Khi khách A đang thanh toán, chỗ của A phải bị khóa để không ai đặt trùng.
4. Chủ xe (OWNER) có toàn quyền trong nhà xe của mình.

Tài liệu này mô tả **hiện trạng đã kiểm tra trong mã**, **khoảng trống**, rồi **giải pháp đề xuất** cho từng yêu cầu. Phần cuối nêu quyết định kiến trúc và thứ tự làm.

---

## 0. Kết luận nhanh

| Yêu cầu | Hiện trạng | Việc cần làm |
|---|---|---|
| Đồng bộ tab | Dashboard kiểm tra phiên khi tab được focus và mỗi 60 giây. Tab đang ở `/login` không biết tab khác đã đăng nhập. | Dùng `BroadcastChannel` (dự phòng bằng sự kiện `storage`) để phát sự kiện đăng nhập/đăng xuất/hết phiên; tab nhận sự kiện thì hỏi lại server. Không gửi token qua kênh này. |
| Luồng đặt vé | Chọn chỗ chưa khóa. Chỗ chỉ bị giữ khi bấm gửi ở trang thông tin liên hệ. Sơ đồ tự làm mới mỗi 5 giây. | Giữ chỗ ngay sau khi chọn (1 chạm nhờ tự điền SĐT Zalo). Có thanh tiến trình 3 bước và một đồng hồ đếm ngược dùng chung cho mọi trang. Chỗ vừa bị người khác lấy thì tự bỏ chọn và báo rõ. Có nút "Chọn lại chỗ" để nhả chỗ. |
| Khóa chỗ khi thanh toán | **Đã có lõi đúng**: giữ chỗ trong PostgreSQL (khóa chuyến + khóa chính `trip_seats`), hết hạn sau 10 phút, có Idempotency-Key. Rủi ro: tiền về **sau** hạn giữ thì đơn bị đánh dấu `LATE` và phải xử lý tay. | Không dùng Redis hay khóa phân tán. Bổ sung: hiển thị hạn chuyển khoản sớm hơn hạn giữ thật, thời gian ân hạn, tự xác nhận lại khi tiền về muộn mà chỗ vẫn trống, API nhả chỗ chủ động, và tác vụ dọn đơn hết hạn định kỳ. |
| Chủ xe toàn quyền | Backend: OWNER đã có mọi quyền trong phạm vi nhà xe (trừ quyền của nền tảng). Dashboard: chỉ OWNER đăng nhập được, phần lớn màn hình chỉ đọc, và quyền ghi chuyến còn phụ thuộc biến môi trường. Chưa có chức năng đặt vé hộ, hủy hay hoàn tiền. | Định nghĩa OWNER = **mọi quyền của nhà xe**, để quyền mới thêm sau tự động thuộc OWNER. Dashboard dựng menu và nút theo danh sách quyền server trả về. Thêm các chức năng còn thiếu, có xác nhận lại bằng 2FA cho thao tác nguy hiểm. |
| Kiến trúc | Một NestJS + một PostgreSQL. | Giữ **modular monolith**, **chưa tách microservices**. Lý do ở mục 5. |

---

## 1. Đồng bộ trạng thái giữa các tab (dashboard và web sau này)

### 1.1 Hiện trạng
- Phiên đăng nhập là cookie HttpOnly `pnticket_owner_session`, nên mọi tab của cùng trình duyệt **đã dùng chung phiên ở phía server**.
- Giao diện mỗi tab không biết tab khác vừa làm gì:
  - `components/live/shell.tsx` chỉ kiểm tra lại phiên khi tab được focus và mỗi 60 giây.
  - Trang `/login` và `/mfa` không kiểm tra gì cả.
- Kịch bản lỗi thường gặp:
  - Tab A đăng nhập xong, tab B vẫn hiện form đăng nhập.
  - Tab A đăng xuất, tab B (đang mở nhưng không được focus) vẫn hiển thị dữ liệu tối đa 60 giây.
  - Tab A tạo chuyến, danh sách ở tab B vẫn là dữ liệu cũ.
- Trong Zalo Mini App không có khái niệm nhiều tab. Phần này áp dụng cho dashboard và trang web đặt vé nếu làm sau này.

### 1.2 Giải pháp
**Kênh sự kiện dùng chung trong trình duyệt** (cùng origin):

```ts
// src/lib/tab-sync.ts (client)
type TabEvent =
  | { type: "auth:login" } | { type: "auth:logout" } | { type: "auth:mfa-done" }
  | { type: "auth:expired" } | { type: "data:changed"; resource: "trips" | "users" | "payments" };
const ch = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pnticket") : null;
export function publish(e: TabEvent) {
  ch?.postMessage(e);
  // Dự phòng cho trình duyệt không có BroadcastChannel: sự kiện storage chỉ bắn ở các tab KHÁC.
  try { localStorage.setItem("pnticket:event", JSON.stringify({ ...e, at: Date.now() })); } catch {}
}
export function subscribe(fn: (e: TabEvent) => void) { /* nghe cả ch.onmessage và window 'storage' */ }
```

Quy tắc:
- **Không bao giờ gửi token, mật khẩu hay mã OTP qua kênh.** Kênh chỉ báo "có thay đổi"; tab nhận luôn gọi `GET /api/auth/session` để lấy sự thật từ server. Vì vậy một tab giả mạo sự kiện cũng không chiếm được quyền.
- Phát sự kiện khi:
  - đăng nhập thành công: `auth:login`;
  - bật 2FA xong: `auth:mfa-done`;
  - bấm đăng xuất: `auth:logout`;
  - nhận 401 hoặc phiên bị thu hồi: `auth:expired`;
  - ghi dữ liệu thành công: `data:changed`.
- Xử lý khi nhận:
  - Ở `/login` hoặc `/mfa`: kiểm tra phiên. Nếu phiên đã đầy đủ thì `location.replace("/admin")`.
  - Ở `/admin/*`: kiểm tra phiên. Nếu không còn phiên thì ẩn dữ liệu ngay rồi chuyển về `/login`.
  - `data:changed`: gọi `reload()` của resource tương ứng (`useResource`).
- Kiểm tra thêm khi `visibilitychange` sang `visible`, ngoài sự kiện `focus` đang có.
- Đăng xuất phải xóa cookie ở server trước, rồi mới phát `auth:logout`.
- Đăng nhập ở hai tab cùng lúc: phiên ghi sau cùng thắng, việc này do server quyết định. Tab còn lại nhận `auth:login` rồi tự kiểm tra lại, không phải đăng nhập lần hai.

### 1.3 Kiểm thử chấp nhận (Playwright, 2 page cùng `context`)
- Page B mở `/login`, page A đăng nhập + OTP. Trong 1 giây, B tự chuyển sang `/admin`.
- A đăng xuất. B rời `/admin` và không còn hiển thị dữ liệu, kể cả khi B không được focus.
- A tạo chuyến. Danh sách chuyến ở B tự làm mới.
- Gửi giả một sự kiện `auth:login` khi không có cookie: B vẫn ở `/login`.

---

## 2. Luồng chọn chỗ – giữ chỗ – thanh toán (Mini App)

### 2.1 Hiện trạng đã kiểm tra
1. **Sơ đồ chỗ** (`pages/seat-map`): tải công khai `GET /trips/:id/seats`, tự làm mới mỗi 5 giây (`SEAT_MAP_REFRESH_MS`). Lúc chọn chỗ **chưa khóa gì**.
2. **Thông tin** (`pages/checkout`):
   - Nhập tên và SĐT, có nút điền nhanh bằng Zalo. Nếu bật chế độ cao điểm thì phải qua OTP.
   - Bấm gửi thì gọi `POST /bookings` kèm `Idempotency-Key` (`booking-draft.store`).
   - Server khóa hàng chuyến (`FOR NO KEY UPDATE`), dọn đơn hết hạn của chuyến, kiểm tra giới hạn theo SĐT, rồi ghi `trip_seats.booking_id`. Đơn ở trạng thái `HOLDING` với `hold_expires_at = now + holdMinutes` (mặc định 10 phút).
   - Chỗ đã bị người khác giữ thì trả `SEAT_UNAVAILABLE` kèm `details.seats` (danh sách chỗ trùng) và `tripId`. Mini App hiện chỉ báo lỗi chung rồi quay về sơ đồ, chưa tô các chỗ trùng.
3. **Thanh toán** (`pages/booking-detail`):
   - Hiện QR SePay và đếm ngược theo `holdExpiresAt`.
   - Hỏi lại trạng thái đơn mỗi 5 giây.
   - Webhook SePay cộng tiền; đủ tiền cọc thì chuyển `CONFIRMED`.
4. **Hết hạn**:
   - Xử lý "lười": khi đọc, đơn quá hạn được coi là trống.
   - Khi giữ chỗ mới, server dọn các đơn hết hạn của chuyến.
   - `expireDueHolds()` có sẵn nhưng **chưa có lịch chạy định kỳ**.
5. **Tiền về muộn** (`payments.service.ts → applyToBooking`):
   - Giao dịch có thời điểm sau hạn giữ, hoặc đơn đã `EXPIRED`, thì không cấp lại chỗ.
   - Khoản tiền bị đánh dấu `LATE` và cần xử lý tay.

**Đánh giá:** chống đặt trùng ở tầng dữ liệu **đã đúng và đủ mạnh**. `test/holds.int-spec.ts` đã có integration test cho các yêu cầu giữ chỗ chạy song song. Khoảng trống nằm ở **trải nghiệm** và **vùng biên thời gian quanh lúc thanh toán**.

### 2.2 Khoảng trống
| # | Vấn đề | Hậu quả |
|---|---|---|
| G1 | Chỗ chỉ bị giữ sau khi nhập xong thông tin (có thể kèm OTP). | Khách chọn xong, nhập xong mới biết chỗ đã mất. Đây là lỗi gây khó chịu nhất ở app đặt vé. |
| G2 | Chỉ có đồng hồ ở trang thanh toán. Trang thông tin không biết còn bao lâu. | Không thống nhất, khách không thấy áp lực thời gian. |
| G3 | Không có cách nhả chỗ. | Khách đổi ý thì chỗ bị treo 10 phút, và khách đụng giới hạn số đơn đang giữ theo SĐT. |
| G4 | Chuyển khoản sát giờ, ngân hàng báo về chậm. | Tiền đã trừ nhưng đơn `LATE`, phải xử lý tay, khách mất niềm tin. |
| G5 | Khi lần làm mới sơ đồ thấy chỗ đang chọn đã bị lấy, giao diện không nói rõ. | Khách bấm tiếp rồi mới nhận lỗi. |
| G6 | Không có lịch dọn đơn hết hạn. | Báo cáo hoặc tác vụ đọc trực tiếp `status` thấy `HOLDING` dù đã quá hạn. Nghiệp vụ không sai vì đã xử lý lười, nhưng dễ gây hiểu lầm. |

### 2.3 Luồng đề xuất (tham khảo cách các app đặt vé xe, vé xem phim, vé sự kiện thường làm: **khóa ngay khi xác nhận chọn chỗ, đếm ngược hiển thị suốt các bước còn lại**)

```
[1. Chọn chỗ] ──bấm "Giữ chỗ"──▶ POST /bookings (HOLDING, 10')
     │  (SĐT lấy từ hồ sơ/Zalo 1 chạm; OTP nếu cao điểm)          │
     │                                                          ▼
     │                                   [2. Thông tin & ghi chú] ─▶ [3. Thanh toán QR]
     │                                    đồng hồ dùng chung ◀──────────┘
     ◀──"Chọn lại chỗ" = POST /bookings/:code/release (nhả ngay)
```

1. **Giữ chỗ ngay ở bước 1 (sửa G1).**
   - Thanh dưới sơ đồ hiện các chỗ đã chọn, tổng tiền và nút **"Giữ chỗ"**.
   - Nút mở một bottom sheet có tên và SĐT đã điền sẵn (hồ sơ đã lưu hoặc "Dùng số Zalo"), 1 chạm để xác nhận. Đây chính là lời gọi `POST /bookings` hiện có, chỉ đưa lên sớm hơn.
   - Vẫn ràng buộc theo SĐT để giữ cơ chế chống giữ chỗ ảo (giới hạn đơn đang giữ theo SĐT/IP, OTP khi cao điểm).
   - *Phương án thay thế* (không khuyến nghị lúc này): "giữ tạm ẩn danh" 3–5 phút theo thiết bị. Lý do không chọn: phải xây cơ chế chống lạm dụng mới không dựa trên SĐT, dễ bị dùng để giữ chỗ ảo hàng loạt.
2. **Ghi chú chuyển sang bước 2.** Trang thông tin chỉ còn ghi chú, chuyến về, mã giảm giá sau này. Trang này hiện **cùng một đồng hồ** đọc từ `holdExpiresAt` của server.
   - Tạo hook `useHoldCountdown(booking)` dùng chung cho bước 2 và 3. Đồng hồ tính theo giờ server (lấy độ lệch từ header `Date`), không theo đồng hồ điện thoại.
   - Thanh tiến trình cố định 3 bước "Chọn chỗ · Thông tin · Thanh toán".
   - Trang chủ có thẻ "Bạn đang giữ 2 chỗ – còn 06:12" để quay lại ngay.
3. **Nhả chỗ chủ động (sửa G3).**
   - API mới `POST /bookings/:code/release` (cần `X-Booking-Token`), chỉ áp dụng cho `HOLDING` chưa có tiền. Trong một transaction: khóa chuyến → đơn chuyển `CANCELLED` → `trip_seats.booking_id = NULL`. Có idempotency.
   - "Chọn lại chỗ" gọi API này rồi quay về sơ đồ, giữ nguyên lựa chọn cũ để khách sửa.
4. **Xung đột chỗ rõ ràng (sửa G5).**
   - Nếu lần làm mới sơ đồ thấy chỗ khách đang chọn đã chuyển HELD hoặc BOOKED: tự bỏ chọn, rung nhẹ ô đó, báo "Chỗ A3 vừa có người giữ".
   - Khi `POST /bookings` trả `SEAT_UNAVAILABLE`: dùng `details.seats` server **đã trả sẵn** để tô đỏ đúng các chỗ trùng và giữ nguyên các chỗ còn lại, thay cho thông báo chung hiện nay.
   - Làm mới sơ đồ thích ứng: 3 giây khi tab đang hiển thị và khách đang chọn; tạm dừng khi ẩn; làm mới ngay khi quay lại.
   - Thêm `ETag` hoặc `seatVersion` (tăng mỗi khi `trip_seats` đổi) để server trả `304` khi không có gì mới, giảm tải.
5. **Vùng biên khi thanh toán (sửa G4).** Áp dụng đủ ba lớp:
   - **Hạn hiển thị sớm hơn hạn thật:** giao diện ghi "Vui lòng chuyển khoản trước **hh:mm**" = `hold_expires_at − 2 phút`. Server vẫn nhả chỗ đúng `hold_expires_at`.
   - **Ân hạn theo thời điểm giao dịch:** giữ quy tắc hiện tại (giao dịch xảy ra trước hạn giữ thì đơn vẫn hợp lệ) và đảm bảo đơn chưa bị nhả trước khi ngân hàng kịp báo. Cách làm: `release_at = hold_expires_at + graceMinutes` (mặc định 3 phút, nằm trong chính sách nhà xe). Trong khoảng ân hạn, chỗ **vẫn khóa** nhưng không nhận giao dịch mới có thời điểm sau `hold_expires_at`.
   - **Tự xác nhận lại khi tiền về muộn:** khi tiền thuộc diện `LATE` mà **mọi chỗ của đơn vẫn trống**, trong cùng transaction: khóa chuyến → giữ lại đúng các chỗ đó → xác nhận đơn và ghi nhật ký `booking.reinstated`. Nếu đã có người khác lấy chỗ thì vẫn `LATE` và hiện trong "Khoản cần kiểm tra" để hoàn tiền. Thêm cờ chính sách `autoReinstateLatePayment` (mặc định bật).
6. **Dọn đơn hết hạn định kỳ (sửa G6).** Chạy `expireDueHolds()` mỗi phút bằng `setInterval` trong tiến trình API (một instance) hoặc cron của Railway. Dùng advisory lock để nhiều instance không chạy cùng lúc. Xử lý lười vẫn giữ nguyên làm lớp an toàn.
7. **Thông báo** (dùng outbox sẵn có): giữ chỗ thành công, còn 2 phút, đã xác nhận, hết hạn. Gửi qua Zalo OA hoặc ZNS khi có tài khoản; trước đó hiện ngay trong app.

### 2.4 Vì sao không dùng Redis hay khóa phân tán cho chỗ ngồi
- PostgreSQL đã là nguồn sự thật của kho chỗ và tiền (`CLAUDE.md`). Giữ chỗ và ghi tiền nằm trong **cùng một transaction**, nên không thể có trạng thái "đã khóa trong Redis nhưng DB chưa ghi".
- Khóa hàng `trips` cộng khóa chính `(trip_id, seat_code)` đảm bảo một chỗ chỉ có tối đa một quyền chiếm, kể cả khi API chạy nhiều instance.
- Redis chỉ nên dùng sau này làm **cache sơ đồ** hoặc **pub/sub cho realtime** khi tải lớn. Redis không làm nguồn quyết định ai được chỗ.

### 2.5 Realtime (giai đoạn 2, khi cần)
- Server-Sent Events: `GET /trips/:id/seats/stream`. Sau mỗi lần giữ, xác nhận, nhả hoặc hết hạn chỗ, API gửi `NOTIFY trip_seats, '<tripId>:<seatVersion>'`. Mỗi instance `LISTEN` rồi đẩy `seatVersion` mới cho các client đang mở chuyến đó; client gọi lại GET sơ đồ.
- Luôn giữ polling làm dự phòng, vì webview Zalo hoặc mạng di động có thể cắt kết nối dài.
- Chỉ làm khi số khách cùng mở một chuyến đủ lớn (cao điểm Tết). Polling 3 giây kèm `304` đủ cho giai đoạn đầu.

### 2.6 Kiểm thử chấp nhận
- **Integration:**
  - Hai khách giữ cùng chỗ song song: một thành công, một nhận `SEAT_UNAVAILABLE` kèm `details.seats` (đã có test; giữ làm hồi quy).
  - `release`: nhả đúng chỗ; gọi lại vẫn trả kết quả cũ (idempotent); không nhả được đơn đã có tiền.
  - Giao dịch trong khoảng ân hạn: đơn được xác nhận; chỗ không bị người khác lấy trong khoảng ân hạn.
  - Tiền về muộn khi chỗ còn trống: tự xác nhận lại. Tiền về muộn khi chỗ đã bị lấy: đơn `LATE`, không cấp chỗ trùng.
  - Tác vụ dọn hết hạn chạy song song 2 lần không lỗi.
- **E2E Mini App** (mock API):
  - Chọn chỗ → giữ chỗ 1 chạm → đồng hồ thống nhất ở bước 2 và 3.
  - "Chọn lại chỗ" nhả chỗ.
  - Chỗ bị lấy trong lúc chọn thì tự bỏ chọn và hiện thông báo.

---

## 3. Chủ xe (OWNER) toàn quyền

### 3.1 Hiện trạng
- `apps/api/src/auth/permissions.ts`: OWNER = `SETUP + MONEY`, tức **mọi quyền phạm vi nhà xe**. Ba quyền chỉ của nền tảng (`operator.create`, `operator.list`, `layout.library.write`) **cố ý không cấp** để giữ an toàn đa nhà xe.
- Dashboard Next.js:
  - Chỉ cho OWNER đăng nhập.
  - Chỉ ghi được chuyến, và chỉ khi `PNTICKET_TRIP_WRITE_OPERATOR_ID` trùng nhà xe.
  - Nhân viên, chính sách, xe, tuyến, sổ thu đều chỉ đọc.
- Chưa có API cho: đặt vé hộ tại quầy, hủy/đổi chỗ/đổi chuyến, hoàn tiền, xem danh sách khách theo chuyến.

### 3.2 Đề xuất
1. **Quy tắc trong mã:**
   - `OWNER = ALL_OPERATOR_PERMISSIONS` (mọi quyền trừ nhóm nền tảng).
   - Thêm test bảo đảm mọi quyền mới không thuộc nhóm nền tảng đều tự có trong OWNER. Tránh trường hợp thêm quyền `booking.refund` mà quên cấp cho chủ xe.
2. **Server trả danh sách quyền:** `GET /auth/me` thêm `permissions: string[]`. Dashboard:
   - dựng menu, nút và route theo quyền này, không tự suy từ vai trò;
   - chặn ở route handler server (đã có);
   - bỏ dần biến `PNTICKET_TRIP_WRITE_OPERATOR_ID` sau khi đã xác minh xong trên production.
3. **Toàn quyền nhưng có hàng rào an toàn:**
   - Bắt buộc 2FA (đã có).
   - **Xác thực lại bằng OTP 2FA** cho thao tác nguy hiểm: đổi tài khoản nhận tiền, hủy chuyến có khách, hoàn tiền, khóa hoặc hạ quyền chủ xe khác, đổi chính sách giữ chỗ hoặc cọc.
   - Mọi thao tác ghi nhật ký (đã có).
   - Luôn còn ít nhất một chủ xe đang hoạt động (đã có).
4. **Màn hình OWNER cần bổ sung**, theo thứ tự ưu tiên:
   - Quản lý chuyến (sửa, đổi xe với kiểm tra chỗ đã bán, hủy).
   - Đơn đặt vé: tìm theo mã hoặc SĐT, đặt hộ tại quầy (`channel = STAFF`), hủy, đổi chỗ.
   - Sổ thu: ghi nhận, phân bổ, xử lý `LATE`/`OVERPAID`.
   - Nhân viên.
   - Chính sách.
   - Xe, sơ đồ, tuyến.
   - Mỗi màn hình đi kèm API, quyền mới (`booking.read`, `booking.create_staff`, `booking.cancel`, `booking.refund`) và test.
5. **Vai trò khác** dùng cùng khung này. Ví dụ, khi phụ xe cần xem danh sách khách theo chuyến được giao (T8) thì chỉ cần thêm quyền, không cần sửa giao diện riêng.

---

## 4. UI/UX thống nhất cho phần đặt vé (nguyên tắc thiết kế)
- **Một nguồn trạng thái:** `booking-draft.store` (lựa chọn và khóa idempotency) cộng đơn `HOLDING` từ server. Mọi trang đọc giờ hết hạn, tổng tiền và danh sách chỗ từ đây; không trang nào tự tính lại.
- **Thanh dưới cố định** ở cả 3 bước: số chỗ, tổng tiền VND, nút hành động chính. Nút bị vô hiệu hóa kèm lý do khi chưa đủ điều kiện.
- **Chú giải màu giống nhau** giữa Mini App và dashboard (còn trống, đang giữ, đã đặt, không bán). Không chỉ dựa vào màu: mỗi ô có chữ trạng thái và nhãn để trình đọc màn hình đọc được.
- **Ô chỗ ≥ 44×44 px**, có số người tối đa cho phòng đôi. Phòng hoặc giường tầng trên/dưới tách thành tab. Nhớ tầng đang xem khi quay lại.
- **Lỗi nói đúng việc cần làm:** "Chỗ A3 vừa có người giữ — chọn chỗ khác"; không dùng "Có lỗi xảy ra".
- **Không mất dữ liệu khi quay lại:** nút Back từ bước 2 về bước 1 hỏi "Nhả chỗ đang giữ?" (gọi `release`) hoặc "Giữ và quay lại".

---

## 5. Kiến trúc: modular monolith, chưa tách microservices

Đã xét theo quy trình của skill *microservices-architect* (DDD → giao tiếp → dữ liệu → khả năng chịu lỗi → quan sát → triển khai):

**Bounded contexts** (tách thành module NestJS rõ ranh giới, **cùng một DB và một tiến trình**):

| Context | Module hiện có | Sở hữu dữ liệu |
|---|---|---|
| Danh tính & quyền | `auth`, `audit` | users, sessions, audit_logs |
| Danh mục vận hành | `operators`, `vehicles`, `seat-layouts`, `trips` (tuyến/chuyến) | operators, policies, vehicles, seat_layouts, routes, trips, trip_fares |
| Kho chỗ & đặt vé | `bookings` (+ `trip_seats`) | bookings, booking_items, trip_seats |
| Thanh toán | `payments` | payments, allocations, outbox_events |
| Chống lạm dụng / xác thực SĐT | `abuse` | rate limits, phone verifications |

**Vì sao chưa tách microservices:**
- Giữ chỗ và ghi nhận tiền cần **nhất quán mạnh trong một transaction**: khóa chuyến, kiểm tra hạn giữ, cấp chỗ, cộng tiền. Nếu tách Booking và Payment thành hai service có hai DB thì phải dùng saga và bù trừ. Như vậy lại tạo ra đúng loại rủi ro mà yêu cầu 3 muốn tránh: tiền đã trừ, chỗ đã mất, phải bù.
- Quy mô hiện tại là 1 nhà xe, 1 service trên Railway và vận hành thủ công. Tách service sẽ nhân chi phí deploy và theo dõi. Đó là kiểu "distributed monolith" mà chính skill cảnh báo.

**Áp dụng ngay các mẫu chịu lỗi và quan sát của skill trong monolith:**
- Correlation ID: middleware gắn `x-correlation-id` vào log và phản hồi; dashboard chuyển tiếp header này. Truy được một lượt đặt vé từ Mini App → API → webhook.
- Timeout, retry giới hạn và circuit breaker cho mọi lời gọi ra ngoài: SePay API (đối soát), Zalo (đổi token lấy SĐT), SMS. Lỗi bên ngoài không được làm treo transaction giữ chỗ. Gọi bên ngoài trước hoặc sau transaction, không gọi bên trong.
- Outbox (đã có `outbox_events`) cho thông báo và tích hợp bất đồng bộ.
- `/health/live` và `/health/ready` (ready kiểm tra DB). Railway hiện kiểm tra sức khỏe bằng một truy vấn nghiệp vụ, nên đổi sang `/health/ready`.
- Version API giữ tiền tố `/api/v1`. Thay đổi phá tương thích thì lên `/v2`.

**Khi nào mới tách:** khi có tải riêng biệt rõ ràng, ví dụ thông báo hoặc realtime sơ đồ cần scale riêng trong cao điểm Tết. Khi đó tách **Notification** hoặc **Realtime gateway** trước. Hai phần này chỉ đọc sự kiện từ outbox hoặc `NOTIFY`, không sở hữu kho chỗ hay tiền.

---

## 6. Thứ tự triển khai đề xuất

| Đợt | Nội dung | Ước lượng | Phụ thuộc |
|---|---|---|---|
| 3A | Đồng bộ tab dashboard (mục 1) + `permissions` trong `/auth/me` + menu theo quyền | 1–2 ngày | Không |
| 3B | Mini App: giữ chỗ ở bước 1, đồng hồ dùng chung, thanh tiến trình, tự bỏ chọn chỗ bị lấy, tô chỗ trùng theo `details.seats` (mục 2.3 bước 1, 2, 4) | 3–4 ngày | Không (API đã có `details.seats`) |
| 3C | API `release`, khoảng ân hạn, tự xác nhận lại khi tiền về muộn, tác vụ dọn hết hạn (mục 2.3 bước 3, 5, 6) + integration test đồng thời | 3 ngày | Chính sách thêm `graceMinutes`, `autoReinstateLatePayment` |
| 3D | OWNER: `ALL_OPERATOR_PERMISSIONS`, xác thực lại 2FA cho thao tác nguy hiểm, màn hình đơn đặt vé và đặt hộ tại quầy | 1–2 tuần | Quyết định quy tắc hủy/hoàn tiền |
| 3E | Correlation ID, health/ready, timeout và circuit breaker cho SePay/Zalo/SMS | 1–2 ngày | Không |
| Sau | SSE realtime sơ đồ, Redis cache (khi tải cao điểm cần) | — | Số liệu tải thực tế |

## 7. Cần chủ xe quyết định
1. Thời gian giữ chỗ (hiện 10 phút) và thời gian ân hạn chuyển khoản (đề xuất 3 phút).
2. Có tự xác nhận lại đơn khi tiền về muộn mà chỗ còn trống không (đề xuất: có).
3. Giữ chỗ ngay ở bước chọn chỗ, bắt buộc có SĐT (đề xuất), hay giữ tạm ẩn danh?
4. Quy tắc hủy và hoàn tiền: mốc thời gian, phí, ai được duyệt. Cần có trước khi làm màn hình hủy/hoàn cho OWNER.
5. Danh sách thao tác cần xác thực lại bằng 2FA (đề xuất ở mục 3.2 bước 3).
