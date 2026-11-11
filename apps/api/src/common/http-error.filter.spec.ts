import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DomainError } from './errors';
import { HttpErrorFilter } from './http-error.filter';

function run(exception: unknown) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  const filter = new HttpErrorFilter();
  jest.spyOn((filter as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
  filter.catch(exception, host);
  return { status: res.status.mock.calls[0]![0] as number, body: res.json.mock.calls[0]![0] };
}

describe('HttpErrorFilter', () => {
  it('maps a DomainError to its HTTP status and stable code', () => {
    const r = run(new DomainError('SEAT_UNAVAILABLE', 'Chỗ A1 vừa có người khác giữ.', { seats: ['A1'] }));
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: { code: 'SEAT_UNAVAILABLE', message: 'Chỗ A1 vừa có người khác giữ.', details: { seats: ['A1'] } } });
  });

  it('maps a ZodError to 400 VALIDATION_FAILED with field paths', () => {
    const err = z.object({ name: z.string() }).safeParse({ name: 1 }).error!;
    const r = run(err);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(r.body.error.details[0].path).toBe('name');
  });

  it('bounds the number of validation issues returned to a client', () => {
    const error = z.array(z.string()).safeParse(Array(50).fill(0)).error!;
    const r = run(error);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(r.body.error.details).toHaveLength(20);
  });

  it('does not echo a large list of unknown keys in a validation issue', () => {
    const payload = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`unexpected_${i}`, i]));
    const error = z.object({}).strict().safeParse(payload).error!;
    const r = run(error);
    expect(r.body.error.details).toEqual([{ path: '', message: 'Dữ liệu chứa trường không được hỗ trợ.' }]);
  });

  it('maps an unknown route to NOT_FOUND', () => {
    const r = run(new NotFoundException());
    expect(r).toEqual({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Không tìm thấy đường dẫn.' } } });
  });

  it('hides internal error details behind INTERNAL_ERROR', () => {
    const r = run(new Error('connection string postgres://secret'));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('secret');
    expect(r.body.error.code).toBe('INTERNAL_ERROR');
  });
});
