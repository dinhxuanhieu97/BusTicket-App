-- Báo cho nhà xe qua email khi khách đặt vé hoặc gửi ảnh chuyển khoản (QS01/QS03).
-- Chủ xe tự nhập máy chủ SMTP (vd. Gmail + mật khẩu ứng dụng) trong Dashboard; mật khẩu lưu mã hóa (SecretBox).
CREATE TABLE operator_alert_settings (
  operator_id        uuid PRIMARY KEY REFERENCES operators(id),
  enabled            boolean NOT NULL DEFAULT false,
  smtp_host          text NOT NULL,
  smtp_port          integer NOT NULL CHECK (smtp_port IN (465, 587)),
  smtp_user          text NOT NULL,
  smtp_password_enc  text NOT NULL,
  from_name          text,
  recipients         text[] NOT NULL CHECK (cardinality(recipients) BETWEEN 1 AND 5),
  on_booking_held    boolean NOT NULL DEFAULT false,
  on_payment_proof   boolean NOT NULL DEFAULT true,
  last_sent_at       timestamptz,
  last_error         text,
  last_error_at      timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Worker gửi đọc outbox theo loại `staff.*`; các loại cũ (chờ T7) không bị đụng tới.
ALTER TABLE outbox_events
  ADD COLUMN attempts        integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN last_error      text;
CREATE INDEX outbox_events_staff_pending_idx ON outbox_events (created_at)
  WHERE processed_at IS NULL AND type LIKE 'staff.%';

-- Đơn khách đã báo chuyển khoản, còn giữ chỗ, chờ nhà xe kiểm (chuông + danh sách).
CREATE INDEX bookings_transfer_claimed_idx ON bookings (operator_id, transfer_claimed_at)
  WHERE status = 'HOLDING' AND transfer_claimed_at IS NOT NULL;
