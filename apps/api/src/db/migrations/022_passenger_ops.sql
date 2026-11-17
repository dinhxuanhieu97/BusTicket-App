-- D3: nhân viên hủy đơn + khoản cần hoàn, khách lên xe (nút, quét QR, nhập lại file), thực thu trên xe.

-- Hủy bởi nhân viên: lý do bắt buộc, người hủy, lúc hủy. Khách tự bỏ giữ chỗ (Mini App) không có các cột này.
ALTER TABLE bookings
  ADD COLUMN cancel_reason text,
  ADD COLUMN cancelled_by  uuid REFERENCES users(id),
  ADD COLUMN cancelled_at  timestamptz,
  ADD CONSTRAINT bookings_staff_cancel CHECK (cancelled_by IS NULL OR (cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL));

-- Lên xe theo từng chỗ (đơn nhiều chỗ có thể lên lẻ).
ALTER TABLE booking_items
  ADD COLUMN boarded_at timestamptz,
  ADD COLUMN boarded_by uuid REFERENCES users(id);

-- Tiền mặt phụ xe thu trên xe: tách được khi đối soát; cộng dồn theo đơn để nhập lại file không ghi trùng.
ALTER TABLE payments ADD COLUMN collected_onboard boolean NOT NULL DEFAULT false;

-- Khoản cần hoàn khi nhân viên hủy đơn đã nhận tiền. Hệ thống không tự hoàn: kế toán hoàn ngoài hệ thống rồi đánh dấu.
CREATE TABLE refund_obligations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid NOT NULL REFERENCES operators(id),
  booking_id   uuid NOT NULL UNIQUE REFERENCES bookings(id),
  amount       integer NOT NULL CHECK (amount > 0),
  reason       text NOT NULL,
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REFUNDED', 'WAIVED')),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES users(id),
  resolve_note text,
  CHECK ((status = 'OPEN') = (resolved_at IS NULL))
);
CREATE INDEX refund_obligations_open ON refund_obligations (operator_id, created_at) WHERE status = 'OPEN';

-- Lần nhập file: thêm loại (khách mới / cập nhật lên xe) — cùng bảng chống gửi trùng.
ALTER TABLE booking_imports ADD COLUMN kind text NOT NULL DEFAULT 'NEW' CHECK (kind IN ('NEW', 'BOARDING'));
