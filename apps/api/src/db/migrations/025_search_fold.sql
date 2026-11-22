-- Tìm nhanh không phân biệt dấu tiếng Việt (GB3): "nguyen" khớp "Nguyễn", "duc" khớp "Đức".
-- Dùng translate thay cho extension `unaccent` (không cần quyền tạo extension, hàm IMMUTABLE nên dùng được trong index).
-- Phải khớp với `foldVn` trong src/reports/report-query.ts.
CREATE FUNCTION vn_fold(s text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$
  SELECT lower(translate(normalize(s, NFC),
    'àÀáÁảẢãÃạẠằẰắẮẳẲẵẴặẶăĂầẦấẤẩẨẫẪậẬâÂèÈéÉẻẺẽẼẹẸềỀếẾểỂễỄệỆêÊìÌíÍỉỈĩĨịỊòÒóÓỏỎõÕọỌồỒốỐổỔỗỖộỘôÔờỜớỚởỞỡỠợỢơƠùÙúÚủỦũŨụỤừỪứỨửỬữỮựỰưƯỳỲýÝỷỶỹỸỵỴđĐ',
    'aAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAeEeEeEeEeEeEeEeEeEeEeEiIiIiIiIiIoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOoOuUuUuUuUuUuUuUuUuUuUuUyYyYyYyYyYdD'))
$$;
