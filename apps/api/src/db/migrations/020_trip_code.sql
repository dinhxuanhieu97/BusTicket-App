-- Mã chuyến dễ đọc: <mã nhà xe><ddmmyy theo giờ VN>-<mã tuyến không gạch>, trùng thì thêm -2, -3...
-- Giữ nguyên trips.id (UUID) làm khóa chính; mã chỉ dùng để hiển thị và đối chiếu.
ALTER TABLE trips ADD COLUMN code text;

WITH base AS (
  SELECT t.id, t.operator_id, t.created_at,
         o.code || to_char(t.depart_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DDMMYY') || '-'
           || regexp_replace(r.code, '[^A-Z0-9]', '', 'g') AS base_code
  FROM trips t
  JOIN operators o ON o.id = t.operator_id
  JOIN routes r ON r.id = t.route_id
),
numbered AS (
  SELECT id, base_code,
         row_number() OVER (PARTITION BY operator_id, base_code ORDER BY created_at, id) AS n
  FROM base
)
UPDATE trips t
SET code = n.base_code || CASE WHEN n.n > 1 THEN '-' || n.n ELSE '' END
FROM numbered n
WHERE t.id = n.id;

ALTER TABLE trips ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX trips_operator_code_key ON trips (operator_id, code);
