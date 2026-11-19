import { DomainError } from './errors';

/** Đọc thân request thô (ảnh), dừng và báo lỗi `message` khi vượt `max` byte; body parser JSON không xử lý image/*. */
export function readLimited(req: NodeJS.ReadableStream, max: number, message: string, field: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const fail = () => {
      if (done) return;
      done = true;
      req.removeAllListeners('data');
      req.resume();
      reject(new DomainError('VALIDATION_FAILED', message, { field }));
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) return fail();
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', fail);
  });
}
