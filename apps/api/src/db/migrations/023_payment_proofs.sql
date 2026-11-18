-- Khách báo "đã chuyển khoản" kèm ảnh lệnh chuyển để nhà xe đối chiếu khi tiền chưa tự về.
-- Lần báo đầu tiên gia hạn giữ chỗ một lần (tối đa 2 giờ, không quá giờ đóng bán/xuất bến).
ALTER TABLE bookings ADD COLUMN transfer_claimed_at timestamptz;

CREATE TABLE booking_payment_proofs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES operators(id),
  data        bytea NOT NULL,
  mime        text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes       integer NOT NULL CHECK (bytes > 0 AND bytes <= 1572864),
  sha256      bytea NOT NULL,
  created_at  timestamptz NOT NULL,
  UNIQUE (booking_id, sha256)
);
CREATE INDEX booking_payment_proofs_booking_idx ON booking_payment_proofs (booking_id, created_at);
CREATE INDEX booking_payment_proofs_operator_idx ON booking_payment_proofs (operator_id, created_at);
