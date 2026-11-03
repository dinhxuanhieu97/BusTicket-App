/** Mã lỗi ổn định trả cho client (PNTicketDocs mục 11). */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_LAYOUT'
  | 'FARE_NOT_CONFIGURED'
  | 'TRIP_NOT_ON_SALE'
  | 'SEAT_UNAVAILABLE'
  | 'LIMIT_EXCEEDED'
  | 'IDEMPOTENCY_CONFLICT';

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_LAYOUT: 400,
  FARE_NOT_CONFIGURED: 400,
  LIMIT_EXCEEDED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TRIP_NOT_ON_SALE: 409,
  SEAT_UNAVAILABLE: 409,
  IDEMPOTENCY_CONFLICT: 409,
};

/** Lỗi nghiệp vụ: `message` là tiếng Việt, khách đọc được; `details` không chứa dữ liệu cá nhân. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export const notFound = (what: string) => new DomainError('NOT_FOUND', `Không tìm thấy ${what}.`);
