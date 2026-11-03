import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { DomainError, notFound } from './common/errors';
import { BookingsService } from './bookings/bookings.service';
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
  async createBooking(@Body() body: unknown, @Headers('idempotency-key') idempotencyKey?: string) {
    if (!idempotencyKey) {
      throw new DomainError('VALIDATION_FAILED', 'Thiếu header Idempotency-Key.', { field: 'Idempotency-Key' });
    }
    const result = await this.bookings.createHold(body as never, idempotencyKey);
    return result;
  }

  /** Token đi trong header, không đặt trên URL để không bị ghi log (PNTicketDocs mục 11). */
  @Get('bookings/:code')
  getBooking(@Param('code') code: string, @Headers('x-booking-token') token?: string) {
    if (!token || !/^[A-Z0-9]{4,12}$/.test(code)) throw notFound('đơn');
    return this.bookings.getByCode(code, token);
  }
}
