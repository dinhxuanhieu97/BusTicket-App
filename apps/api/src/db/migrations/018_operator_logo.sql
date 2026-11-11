-- Logo nhà xe (hiển thị ở trang đăng nhập dashboard). Lưu trong DB: ảnh nhỏ, không phụ thuộc host ngoài.
ALTER TABLE operators
  ADD COLUMN logo_data bytea,
  ADD COLUMN logo_mime text,
  ADD COLUMN logo_updated_at timestamptz,
  ADD CONSTRAINT operators_logo_pair CHECK ((logo_data IS NULL) = (logo_mime IS NULL) AND (logo_data IS NULL) = (logo_updated_at IS NULL)),
  ADD CONSTRAINT operators_logo_mime CHECK (logo_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  ADD CONSTRAINT operators_logo_size CHECK (octet_length(logo_data) BETWEEN 1 AND 204800);
