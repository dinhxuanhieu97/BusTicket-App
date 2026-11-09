-- Ân hạn chuyển khoản: chỗ vẫn khóa thêm vài phút sau hạn thanh toán để tiền ngân hàng báo chậm không làm mất vé.
ALTER TABLE operator_policies
  ADD COLUMN payment_grace_minutes int NOT NULL DEFAULT 3 CHECK (payment_grace_minutes BETWEEN 0 AND 30),
  ADD COLUMN auto_reinstate_late_payment boolean NOT NULL DEFAULT true;

-- release_at = thời điểm nhả chỗ (hạn thanh toán + ân hạn). hold_expires_at vẫn là hạn thanh toán khách thấy.
ALTER TABLE bookings ADD COLUMN release_at timestamptz;
UPDATE bookings SET release_at = hold_expires_at WHERE status = 'HOLDING';
-- Trong lúc deploy, bản API cũ (chưa biết release_at) vẫn có thể tạo đơn giữ chỗ: mặc định nhả đúng hạn thanh toán.
CREATE FUNCTION bookings_default_release_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'HOLDING' AND NEW.release_at IS NULL THEN
    NEW.release_at := NEW.hold_expires_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_default_release_at BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_default_release_at();
ALTER TABLE bookings ADD CONSTRAINT bookings_holding_release_at CHECK (status <> 'HOLDING' OR release_at IS NOT NULL);
-- Tác vụ dọn đơn tìm theo release_at qua booking_items (đơn khứ hồi).
CREATE INDEX bookings_holding_release_idx ON bookings (release_at) WHERE status = 'HOLDING';
CREATE INDEX bookings_operator_phone_release_idx ON bookings (operator_id, contact_phone, release_at) WHERE status = 'HOLDING';
