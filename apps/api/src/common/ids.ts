const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id không đúng dạng UUID được coi là "không tìm thấy" thay vì để PostgreSQL ném lỗi 22P02. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
