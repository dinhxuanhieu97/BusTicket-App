-- D2: đặt vé tại quầy, điểm đón/trả theo khách, nhập danh sách khách mới từ file.
-- (020 để dành cho worker thông báo; bộ chạy migration áp từng file theo tên nên thứ tự số không bắt buộc liên tục.)

-- Điểm đón/trả khách chọn, chụp từ điểm của chuyến lúc đặt: {"name","time","day"}. NULL = chưa chọn.
-- Nhân viên tạo đơn tại quầy/nhập file (bắt buộc với đơn STAFF).
ALTER TABLE bookings
  ADD COLUMN pickup_stop  jsonb,
  ADD COLUMN dropoff_stop jsonb,
  ADD COLUMN created_by   uuid REFERENCES users(id),
  ADD CONSTRAINT bookings_staff_creator CHECK (channel <> 'STAFF' OR created_by IS NOT NULL);

-- Mỗi lần nhập danh sách khách mới: chống ghi hai lần khi gửi lại cùng file (Idempotency-Key = băm nội dung).
-- `result` chỉ có mã đơn, chỗ, tiền — không có họ tên/SĐT.
CREATE TABLE booking_imports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      uuid NOT NULL REFERENCES operators(id),
  trip_id          uuid NOT NULL REFERENCES trips(id),
  idempotency_key  text NOT NULL,
  request_hash     text NOT NULL,
  file_name        text,
  result           jsonb NOT NULL,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, idempotency_key)
);
