# CLAUDE.md — Quy ước làm việc cho PNTicket

## Dự án
- Nền tảng đặt vé xe khách cho **nhiều nhà xe** (multi-tenant). Phong Nhung (`PN`) là nhà xe đầu tiên.
- Đặc tả chính: `docs/PNTicketDocs.md`. Các quyết định bổ sung: `docs/NEN-TANG-DA-NHA-XE.md`, `docs/SETUP-NHA-XE.md`, `docs/DOI-XE-SO-DO-CHO.md`, `docs/ZALO-MINI-APP.md`.
- Ngôn ngữ trao đổi và tài liệu: **tiếng Việt**. Code, tên biến, commit message: tiếng Anh.

## Cấu trúc
- `apps/api` — NestJS + PostgreSQL (truy vấn SQL qua `pg`, migration SQL thuần trong `src/db/migrations`).
- `prototype/` — bản mẫu giao diện tĩnh. `templates/` — file mẫu (Excel).

## Lệnh
```bash
pnpm install
pnpm --filter api test          # unit + integration
pnpm --filter api test:unit
pnpm --filter api test:int      # cần PostgreSQL, xem DATABASE_URL_TEST
pnpm --filter api typecheck
DATABASE_URL=... ADMIN_PHONE=09... ADMIN_NAME="..." ADMIN_PASSWORD=... pnpm --filter api create-admin   # tài khoản quản trị nền tảng đầu tiên
```
Biến môi trường khi chạy API: `DATABASE_URL`, `BOOKING_TOKEN_SECRET`, `AUTH_TOKEN_SECRET` (mỗi bí mật ≥ 32 ký tự).

Khi rà soát bằng nhiều subagent song song, **mỗi subagent dùng một DB test riêng** (`DATABASE_URL_TEST=.../pnticket_rN_test`) vì integration test xóa sạch schema.
Integration test dùng `DATABASE_URL_TEST` (mặc định `postgres://pnticket:pnticket@localhost:5432/pnticket_test`) và **xóa sạch schema `public`** của DB đó trước mỗi file test. Không trỏ biến này vào DB thật.

## Nguyên tắc nghiệp vụ không được vi phạm
- PostgreSQL là nguồn sự thật cho kho chỗ và tiền. Một chỗ/phòng trên một chuyến chỉ có tối đa một quyền chiếm (khóa hàng `trips ... FOR UPDATE` + khóa chính `trip_seats`).
- Mọi truy vấn nghiệp vụ lọc theo `operator_id` lấy từ phía máy chủ, không tin giá trị client gửi.
- Tiền là số nguyên VND. Giá, chính sách được **chụp lại vào đơn** lúc đặt.
- API công khai không trả tên/số điện thoại khách.
- Thời gian lưu UTC (`timestamptz`), ngày nghiệp vụ theo `Asia/Ho_Chi_Minh`.

## Quy trình mỗi task
1. Lấy task tiếp theo trong `task.md`, đánh dấu đang làm.
2. Viết test trước hoặc cùng lúc với code (theo skill `fullstack-dev-skills:test-master`): happy path **và** lỗi/biên; integration test với PostgreSQL thật cho logic khóa chỗ/tiền; không test chi tiết nội bộ.
3. Task chỉ **xong** khi `pnpm --filter api typecheck` và **toàn bộ** `pnpm --filter api test` pass. Không skip/xóa test để có màu xanh.
4. Rà soát bằng subagent (xem bên dưới) trước khi đánh dấu xong.
5. Đánh dấu `[x]` trong `task.md`; ghi **mọi việc mới phát hiện** vào mục "Phát hiện mới" của `task.md`.
6. Commit, push lên nhánh được giao.

## Rà soát bằng subagent
- Giao **mỗi service cho một subagent riêng**. Subagent **chỉ đọc đúng service đó** (file service, file test của nó, và schema/migration nó dùng), không sửa code, rồi báo: có bug hay không, kèm **bằng chứng** (đường dẫn `file:dòng`, đoạn code, kịch bản đầu vào → kết quả sai).
- Agent chính **tự kiểm tra lại bằng chứng** của từng subagent (đọc code, chạy thử hoặc viết test tái hiện) trước khi tin.
- Gom kết quả thành bảng: mỗi dòng là một service — **bị ảnh hưởng không**, **bằng chứng ở đâu**, **kết luận sau kiểm tra** (xác nhận/bác bỏ). Bug được xác nhận phải có test tái hiện và được sửa trong task (hoặc ghi vào `task.md` nếu ngoài phạm vi).

## Báo cáo khi kết thúc mỗi task
Mỗi lần kết thúc một task, báo cáo đúng 3 mục sau (ghi "Không có" nếu trống):

## Block on me
Những việc cần người dùng quyết định/cung cấp mới làm tiếp được.

## Change
Những gì đã thay đổi (file, hành vi, migration), và kết quả test.

## Found
Bug, rủi ro, việc mới phát hiện (đồng thời đã ghi vào `task.md`), kèm bảng rà soát subagent.
