import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from './errors';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Chuẩn hóa mọi lỗi thành `{ error: { code, message, details? } }`; không lộ chi tiết lỗi nội bộ. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toBody(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(status).json(body);
  }

  private toBody(e: unknown): [number, ErrorBody] {
    if (e instanceof DomainError) {
      return [e.httpStatus, { error: { code: e.code, message: e.message, details: e.details } }];
    }
    if (e instanceof ZodError) {
      const details = e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return [400, { error: { code: 'VALIDATION_FAILED', message: 'Dữ liệu gửi lên không hợp lệ.', details } }];
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const code = status === 404 ? 'NOT_FOUND' : `HTTP_${status}`;
      const message = status === 404 ? 'Không tìm thấy đường dẫn.' : e.message;
      return [status, { error: { code, message } }];
    }
    return [500, { error: { code: 'INTERNAL_ERROR', message: 'Hệ thống đang gặp sự cố, vui lòng thử lại sau.' } }];
  }
}
