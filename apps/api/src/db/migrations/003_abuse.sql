-- T5b: chống giữ chỗ ảo — giới hạn tần suất, xác thực SĐT bằng OTP, chính sách cao điểm.

-- Bộ đếm theo cửa sổ thời gian cố định (khóa ví dụ: "booking-ip:1.2.3.4").
CREATE TABLE rate_limit_counters (
  key           text        NOT NULL,
  window_start  timestamptz NOT NULL,
  count         int         NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limit_counters_window_idx ON rate_limit_counters (window_start);

CREATE TABLE phone_verifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid NOT NULL REFERENCES operators(id),
  phone        text NOT NULL,
  code_hash    text NOT NULL,                 -- HMAC của mã, không lưu mã gốc
  attempts     int  NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_verifications_lookup_idx ON phone_verifications (operator_id, phone, created_at DESC);

ALTER TABLE operator_policies
  ADD COLUMN max_active_holds_per_phone int NOT NULL DEFAULT 2 CHECK (max_active_holds_per_phone BETWEEN 1 AND 20),
  ADD COLUMN require_phone_otp boolean NOT NULL DEFAULT false;

-- Đếm nhanh đơn đang giữ theo SĐT trong một nhà xe.
CREATE INDEX bookings_operator_phone_holding_idx ON bookings (operator_id, contact_phone, hold_expires_at) WHERE status = 'HOLDING';
