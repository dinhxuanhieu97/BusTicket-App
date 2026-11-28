-- Nhân viên đổi chỗ/chuyến/tiền của đơn đã đặt (kể cả đơn đã cọc).

-- Một đơn có thể có nhiều khoản cần hoàn: phần dư sau khi đổi sang chỗ rẻ hơn / giảm "đã thu" (ADJUST),
-- và tối đa một khoản khi hủy đơn (CANCEL).
ALTER TABLE refund_obligations DROP CONSTRAINT refund_obligations_booking_id_key;
ALTER TABLE refund_obligations
  ADD COLUMN kind text NOT NULL DEFAULT 'CANCEL' CHECK (kind IN ('CANCEL', 'ADJUST'));
CREATE UNIQUE INDEX refund_obligations_one_cancel ON refund_obligations (booking_id) WHERE kind = 'CANCEL';
CREATE INDEX refund_obligations_booking ON refund_obligations (booking_id, created_at);

-- Mỗi lần đổi: ảnh chụp trước/sau (chỗ, chuyến, tiền — không họ tên/SĐT) + chống gửi trùng.
CREATE TABLE booking_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES operators(id),
  booking_id      uuid NOT NULL REFERENCES bookings(id),
  idempotency_key text NOT NULL,
  request_hash    text NOT NULL,
  reason          text,
  before          jsonb NOT NULL,
  after           jsonb NOT NULL,
  result          jsonb NOT NULL,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, idempotency_key)
);
CREATE INDEX booking_changes_booking ON booking_changes (booking_id, created_at);
