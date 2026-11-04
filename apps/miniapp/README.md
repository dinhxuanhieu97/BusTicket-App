# apps/miniapp — Zalo Mini App đặt vé (T11, khung)

Giao diện cho khách đặt vé trong Zalo. **Chỉ là giao diện**: kho chỗ, tiền, vé đều ở `apps/api` (xem `docs/ZALO-MINI-APP.md`).
Khung dựng lại từ template ZaUI Bistro (React 18, ZMP UI/SDK, React Router 7, TanStack Query, Zustand, Tailwind).

## Luồng đã có

| Màn | Đường dẫn | API công khai dùng |
|---|---|---|
| Chọn ngày, danh sách chuyến (lọc theo tuyến) | `/` | `GET /operators/:code/trips?date=` |
| Sơ đồ chỗ theo tầng, chọn chỗ, phòng đơn/đôi, trẻ em | `/trip/:tripId` | `GET /trips/:id/seats` (tự tải lại mỗi 5 giây) |
| Thông tin liên hệ, OTP khi cao điểm, giữ chỗ | `/checkout` | `POST /bookings` (`Idempotency-Key`), `POST /phone-verifications[/verify]` |
| Đơn: đếm ngược giữ chỗ, QR chuyển khoản, tự cập nhật khi tiền về | `/booking/:code` | `GET /bookings/:code`, `GET /bookings/:code/payment` (`X-Booking-Token`) |
| Vé của tôi (đơn đặt trên máy này) | `/my-bookings` | `GET /bookings/:code` |

Quy tắc giữ đúng phía máy chủ:
- `Idempotency-Key` sinh một lần cho mỗi lần giữ chỗ, **giữ nguyên khi gửi lại**; đổi chỗ/thông tin thì sinh khóa mới.
- Token đơn đi trong header, không đặt trên URL. Tạm lưu `mã đơn + accessToken` trong localStorage vì chưa có đăng nhập Zalo.
- Giá trên Mini App chỉ là **tạm tính**; số tiền chính thức là `totalAmount`/`amountDueNow` máy chủ trả.
- Chỉ trạng thái đơn từ máy chủ mới cho biết đã nhận tiền.

## Chạy thử

```bash
pnpm install
# API ở cổng 3001 (zmp start dùng cổng 3000):
DATABASE_URL=... BOOKING_TOKEN_SECRET=... AUTH_TOKEN_SECRET=... PORT=3001 pnpm --filter api start
cp apps/miniapp/.env.example apps/miniapp/.env
pnpm --filter miniapp dev        # trình duyệt: http://localhost:5173, /api chuyển tiếp sang :3001
pnpm --filter miniapp start      # hoặc qua Zalo Mini App CLI (zmp)
pnpm --filter miniapp typecheck
pnpm --filter miniapp test
```

Mỗi nhà xe một bản Mini App: đổi `VITE_OPERATOR_CODE`, `VITE_OPERATOR_NAME` khi build.

## Chưa làm (cần API trước)

- Đăng nhập Zalo + "Vé của tôi" theo tài khoản (`/auth/zalo`, `/me/tickets`), lấy SĐT qua `getPhoneNumber`.
- Vé điện tử/QR lên xe (T7), điểm đón/trả (`stops`), danh sách tuyến công khai.
- Giá trẻ em trước khi giữ chỗ (API công khai chưa trả chính sách trẻ em).
- Thanh toán ZaloPay/ví qua Checkout SDK.
- Bật CORS ở API cho domain Mini App khi phát hành (dev dùng proxy của Vite).
