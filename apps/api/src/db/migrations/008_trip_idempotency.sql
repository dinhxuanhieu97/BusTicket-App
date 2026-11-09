-- Chống tạo trùng chuyến khi quản trị bấm lại, mở nhiều tab hoặc mất phản hồi sau khi đã lưu.
ALTER TABLE trips ADD COLUMN idempotency_key text, ADD COLUMN request_hash text;
CREATE UNIQUE INDEX trips_operator_idempotency_key ON trips (operator_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
