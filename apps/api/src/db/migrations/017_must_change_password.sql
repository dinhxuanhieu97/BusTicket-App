-- OWNER đặt mật khẩu tạm cho nhân viên → nhân viên phải đổi mật khẩu trước khi dùng các chức năng khác.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
