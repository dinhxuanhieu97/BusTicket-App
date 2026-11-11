import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PhoneVerificationService } from './abuse/phone-verification.service';
import { ZaloPhoneService } from './abuse/zalo-phone.service';
import { z } from 'zod';
import { DomainError, notFound } from './common/errors';
import { BookingsService } from './bookings/bookings.service';
import { renderTicketVerification } from './bookings/ticket-verification-page';
import { OperatorsService } from './operators/operators.service';
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
    private readonly zaloPhone: ZaloPhoneService,
    private readonly operators: OperatorsService,
  ) {}

  /** Tên và phiên bản logo của nhà xe (dashboard hiển thị ở trang đăng nhập). Dữ liệu vốn công khai. */
  @Get('operators/:operatorCode/brand')
  @Header('Cache-Control', 'public, max-age=60')
  brand(@Param('operatorCode') code: string) {
    if (!/^[A-Z]{2,4}$/.test(code)) throw notFound('nhà xe');
    return this.operators.brand(code);
  }

  @Get('operators/:operatorCode/logo')
  async logo(@Param('operatorCode') code: string, @Res() res: Response) {
    if (!/^[A-Z]{2,4}$/.test(code)) throw notFound('nhà xe');
    const logo = await this.operators.logo(code);
    res
      .status(200)
      .set({
        'Content-Type': logo.mime,
        'Content-Length': String(logo.data.length),
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'cross-origin',
      })
      .end(logo.data);
  }

  @Get('operators/:operatorCode/trips')
  async searchTrips(@Param('operatorCode') operatorCode: string, @Query('date') date?: string, @Query('route') route?: string) {
    if (!/^[A-Z]{2,4}$/.test(operatorCode)) throw notFound('nhà xe');
    if (!date) throw new DomainError('VALIDATION_FAILED', 'Thiếu ngày đi (date=YYYY-MM-DD).', { field: 'date' });
    return { trips: await this.trips.search(operatorCode, date, route || undefined) };
  }

  @Get('operators/:operatorCode/open-routes')
  async openRoutes(@Param('operatorCode') code: string) {
    if (!/^[A-Z]{2,4}$/.test(code)) throw notFound('nhà xe');
    return { routes: await this.trips.discover(code) };
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
    @Headers('x-booking-retry-token') retryToken?: string,
  ) {
    if (!idempotencyKey) {
      throw new DomainError('VALIDATION_FAILED', 'Thiếu header Idempotency-Key.', { field: 'Idempotency-Key' });
    }
    return this.bookings.createHold(body as never, idempotencyKey, { ip: req.ip, phoneToken, retryToken });
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

  /**
   * Mini App: đổi token `getPhoneNumber` + access token Zalo lấy SĐT của chính khách.
   * Trả kèm `phoneToken` (số do Zalo xác nhận, dùng thay OTP khi giữ chỗ).
   */
  @Post('zalo/phone')
  @HttpCode(200)
  zaloPhoneNumber(@Body() body: unknown, @Req() req: Request) {
    return this.zaloPhone.exchange(body as never, req.ip ?? 'unknown');
  }

  /** Thông tin chuyển khoản + ảnh QR cho đơn (số tiền cần trả lúc này, nội dung = mã đơn). */
  @Get('bookings/:code/payment')
  paymentInstructions(
    @Param('code') code: string,
    @Query('purpose') purpose?: string,
    @Headers('x-booking-token') token?: string,
  ) {
    if (!token || !/^[A-Z0-9]{4,12}$/.test(code)) throw notFound('đơn');
    return this.payments.paymentInstructions(code, token, purpose === 'deposit');
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

  @Get('bookings/:code/contact')
  @Header('Cache-Control', 'private, no-store')
  getBookingContact(@Param('code') code: string, @Headers('x-booking-token') token?: string) {
    if (!token || !/^[A-Z0-9]{4,12}$/.test(code)) throw notFound('đơn');
    return this.bookings.contactByCode(code, token);
  }

  @Get('tickets/:code/verify')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @Header('X-Content-Type-Options', 'nosniff')
  async verifyTicket(
    @Param('code') code: string,
    @Query('proof') proof: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const ticket = /^[A-Z0-9]{4,12}$/.test(code) && typeof proof === 'string' && /^[A-Za-z0-9_-]{43}$/.test(proof)
      ? await this.bookings.verifyTicket(code, proof)
      : null;
    if (!ticket) response.status(404);
    return renderTicketVerification(ticket);
  }

  /** Khách xóa họ tên, số điện thoại trong đơn đã xong (nút "Xóa thông tin đã lưu" ở Mini App). */
  @Post('bookings/:code/erase-contact')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  eraseBookingContact(@Param('code') code: string, @Headers('x-booking-token') token?: string) {
    if (!token || !/^[A-Z0-9]{4,12}$/.test(code)) throw notFound('đơn');
    return this.bookings.eraseContactByCode(code, token);
  }

  /** Khách bỏ giữ chỗ để chọn lại: nhả chỗ ngay. Gọi lại nhiều lần an toàn (trả trạng thái hiện tại). */
  @Post('bookings/:code/release')
  @HttpCode(200)
  releaseBooking(@Param('code') code: string, @Headers('x-booking-token') token?: string) {
    if (!token || !/^[A-Z0-9]{4,12}$/.test(code)) throw notFound('đơn');
    return this.bookings.releaseByCode(code, token);
  }
}
