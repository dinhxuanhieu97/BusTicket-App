import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PhoneVerificationService } from './abuse/phone-verification.service';
import { z } from 'zod';
import { DomainError, notFound } from './common/errors';
import { BookingsService } from './bookings/bookings.service';
import { PaymentsService } from './payments/payments.service';
import { TripsService } from './trips/trips.service';

const uuid = z.string().uuid();

function parseUuid(value: string, what: string): string {
  if (!uuid.safeParse(value).success) throw notFound(what);
  return value;
}

/** API công khai cho khách (Mini App / web): không yêu cầu đăng nhập, không trả dữ liệu cá nhân của người khác. */
@Controller('api/v1')
export class PublicController {
  constructor(
    private readonly trips: TripsService,
    private readonly bookings: BookingsService,
    private readonly phones: PhoneVerificationService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('operators/:operatorCode/trips')
  async searchTrips(@Param('operatorCode') operatorCode: string, @Query('date') date?: string, @Query('route') route?: string) {
    if (!/^[A-Z]{2,4}$/.test(operatorCode)) throw notFound('nhà xe');
    if (!date) throw new DomainError('VALIDATION_FAILED', 'Thiếu ngày đi (date=YYYY-MM-DD).', { field: 'date' });
    return { trips: await this.trips.search(operatorCode, date, route || undefined) };
  }

  @Get('trips/:tripId/seats')
  seatMap(@Param('tripId') tripId: string) {
    return this.trips.seatMap(parseUuid(tripId, 'chuyến'));
  }

  @Post('bookings')
  @HttpCode(201)
  async createBooking(
    @Body() body: unknown,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-phone-token') phoneToken?: string,
  ) {
    if (!idempotencyKey) {
      throw new DomainError('VALIDATION_FAILED', 'Thiếu header Idempotency-Key.', { field: 'Idempotency-Key' });
    }
    return this.bookings.createHold(body as never, idempotencyKey, { ip: req.ip, phoneToken });
  }

  /** Bước 1 xác thực SĐT (khi nhà xe bật chế độ cao điểm): gửi mã OTP qua SMS. */
  @Post('phone-verifications')
  @HttpCode(201)
  startPhoneVerification(@Body() body: unknown, @Req() req: Request) {
    return this.phones.start(body as never, req.ip ?? 'unknown');
  }

  /** Bước 2: nhập mã → nhận `phoneToken` để gửi kèm header `X-Phone-Token` khi giữ chỗ. */
  @Post('phone-verifications/verify')
  @HttpCode(200)
  verifyPhone(@Body() body: unknown) {
    return this.phones.verify(body as never);
  }

  /** Thông tin chuyển khoản + ảnh QR cho đơn (số tiền cần trả lúc này, nội dung = mã đơn). */
  @Get('bookings/:code/payment')
  paymentInstructions(@Param('code') code: string, @Headers('x-booking-token') token?: string) {
    if (!token || !/^[A-Z0-9]{4,12}$/.test(code)) throw notFound('đơn');
    return this.payments.paymentInstructions(code, token);
  }

  /**
   * Webhook SePay (xác thực "API Key": header `Authorization: Apikey <key>`). Trả `{"success": true}` với
   * HTTP 200 kể cả khi giao dịch trùng/không liên quan để SePay không gửi lại; lỗi xác thực → 401.
   */
  @Post('webhooks/payments/sepay')
  @HttpCode(200)
  async sepayWebhook(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    const result = await this.payments.handleSepayWebhook(authorization, body);
    return { success: true, status: result.status };
  }

  /** Token đi trong header, không đặt trên URL để không bị ghi log (PNTicketDocs mục 11). */
  @Get('bookings/:code')
  getBooking(@Param('code') code: string, @Headers('x-booking-token') token?: string) {
    if (!token || !/^[A-Z0-9]{4,12}$/.test(code)) throw notFound('đơn');
    return this.bookings.getByCode(code, token);
  }
}
