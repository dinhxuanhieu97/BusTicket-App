-- Khách xóa họ tên, số điện thoại và ghi chú trong đơn đã xong (Thỏa thuận Zalo Mini App 5.3.3(d)).
-- Đơn, chỗ và tiền giữ nguyên để đối soát; chỉ trường liên hệ bị xóa.
ALTER TABLE bookings ADD COLUMN contact_erased_at timestamptz;
