# Phân quyền theo vai trò tài khoản

> Ngày: 03/11/2026 · Nguồn sự thật trong code: `apps/api/src/auth/permissions.ts` · Liên quan: PNTicketDocs mục 3

Quyền gắn với **vai trò (role) của tài khoản**. Mỗi tài khoản có đúng một vai trò; đổi vai trò thì quyền đổi theo và mọi phiên đăng nhập cũ của người đó bị thu hồi ngay. Nhân viên chỉ thấy dữ liệu của **nhà xe mình**.

| Quyền | Quản trị nền tảng | Chủ xe | Điều hành | Kế toán | Bán vé | Phụ xe |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Tạo nhà xe, xem danh sách nhà xe | ✔ | | | | | |
| Sửa thư viện mẫu sơ đồ dùng chung | ✔ | | | | | |
| Tạo/sửa/khóa tài khoản nhân viên | ✔ ¹ | ✔ | | | | |
| Xem chính sách (cọc, giữ chỗ, trẻ em) | ✔ ¹ | ✔ | ✔ | ✔ | ✔ | |
| Sửa chính sách | ✔ ¹ | ✔ | | | | |
| Xem xe, mẫu sơ đồ | ✔ ¹ | ✔ | ✔ | ✔ | ✔ | |
| Thêm/sửa xe, mẫu sơ đồ riêng | ✔ ¹ | ✔ | ✔ | | | |
| Xem tuyến, chuyến | ✔ ¹ | ✔ | ✔ | ✔ | ✔ | |
| Thêm tuyến, tạo chuyến, mở/đóng bán | ✔ ¹ | ✔ | ✔ | | | |
| Xem nhật ký thao tác | ✔ ¹ | ✔ | | ✔ | | |
| Thiết lập tài khoản nhận tiền SePay | ✔ ² | ✔ | | | | |
| Xem sổ thu, khoản cần kiểm tra | | ✔ | | ✔ | ✔ | |
| Ghi nhận **tiền mặt** cho đơn | | ✔ | | ✔ | ✔ | |
| Xác nhận **chuyển khoản thủ công** (mức 0) | | ✔ | | ✔ | | |
| Phân bổ tay, đánh dấu đã xử lý, chạy đối soát | | ✔ | | ✔ | | |
| Danh sách khách chuyến được giao, xuất Excel | — | — | — | — | — | (T8) |

¹ Quản trị nền tảng dùng để **setup nhà xe trước khi hoạt động chính thức**; mọi thao tác đều ghi nhật ký. Quản trị nền tảng **không xem/không động vào tiền** của nhà xe (nhật ký thao tác tiền bị ẩn).

² Chỉ **lần thiết lập đầu tiên**. Đổi tài khoản nhận tiền sau đó chỉ chủ xe làm được; mỗi lần đổi ghi nhật ký tài khoản cũ/mới và báo chủ xe.

Các quyền về **đặt vé hộ, hoàn tiền có duyệt** sẽ thêm khi làm các task tương ứng.

**Quy tắc an toàn:**
- Bắt buộc bật xác thực 2 lớp: quản trị nền tảng, chủ xe, kế toán.
- Không ai tự đổi vai trò, tự khóa hoặc tự đặt lại mật khẩu của chính mình qua trang quản trị (đổi mật khẩu phải nhập mật khẩu hiện tại).
- Mỗi nhà xe luôn còn ít nhất một chủ xe đang hoạt động.
- Chủ xe không thể tạo tài khoản quản trị nền tảng.

Muốn đổi bảng này (VD cho bán vé xem nhật ký): sửa `ROLE_PERMISSIONS` trong `apps/api/src/auth/permissions.ts` và test `auth-primitives.spec.ts`.
