-- Màu giao diện Dashboard theo nhà xe: hai màu của dải chuyển (góc trên trái → góc dưới phải).
-- NULL cả hai = dùng màu mặc định (#6366f1 → #06b6d4). Lưu dạng hex thường "#rrggbb".
ALTER TABLE operators
  ADD COLUMN brand_color_from text,
  ADD COLUMN brand_color_to   text,
  ADD CONSTRAINT operators_brand_colors_check CHECK (
    (brand_color_from IS NULL AND brand_color_to IS NULL)
    OR (brand_color_from ~ '^#[0-9a-f]{6}$' AND brand_color_to ~ '^#[0-9a-f]{6}$')
  );
