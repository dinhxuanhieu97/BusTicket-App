-- Báo cáo dashboard: doanh thu theo ngày nhận tiền, đơn theo ngày tạo, tiền đã hoàn theo ngày xử lý.
CREATE INDEX payments_operator_received_idx ON payments (operator_id, received_at);
CREATE INDEX bookings_operator_created_idx ON bookings (operator_id, created_at);
CREATE INDEX refund_obligations_refunded_idx ON refund_obligations (operator_id, resolved_at) WHERE status = 'REFUNDED';
-- Lọc chuyến theo tuyến trong khoảng ngày (GET trips?route=).
CREATE INDEX trips_operator_route_depart_idx ON trips (operator_id, route_id, depart_at, id);
-- Doanh thu theo tuyến: từ khoản thu trong kỳ tới các lần phân bổ.
CREATE INDEX payment_allocations_payment_idx ON payment_allocations (payment_id);
