/** Bí mật ký token truy cập đơn (ít nhất 32 ký tự). */
export class TokenSecret {
  constructor(readonly value: string) {
    if (value.length < 32) throw new Error('BOOKING_TOKEN_SECRET must be at least 32 characters');
  }
}
