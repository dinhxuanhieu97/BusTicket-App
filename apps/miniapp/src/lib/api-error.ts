/** Lỗi từ API: `code` là mã ổn định của máy chủ (vd. SEAT_UNAVAILABLE), `message` là tiếng Việt khách đọc được. */
export class APIError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = `HTTP_${status}`, details?: unknown) {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
