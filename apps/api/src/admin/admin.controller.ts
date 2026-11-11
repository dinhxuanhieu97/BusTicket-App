import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthedRequest, AuthGuard, Perm } from '../auth/auth.guard';
import { AuthService, passwordSchema } from '../auth/auth.service';
import { UsersService } from '../auth/users.service';
import { Clock } from '../common/clock';
import { DomainError } from '../common/errors';
import { configureAccountSchema, PaymentsService } from '../payments/payments.service';
import { LOGO_MAX_BYTES, OperatorsService } from '../operators/operators.service';
import { SeatLayoutsService } from '../seat-layouts/seat-layouts.service';
import { TripsService } from '../trips/trips.service';
import { TripSchedulesService } from '../trips/trip-schedules.service';
import { TripAssistantsService } from '../trips/trip-assistants.service';
import { VehiclesService } from '../vehicles/vehicles.service';

const tripStatusBody = z.object({ status: z.enum(['OPEN', 'CLOSED']) }).strict();
const ownerPasswordBody = z
  .object({
    password: passwordSchema,
    adminPassword: z.string().min(1).max(128),
    otp: z.string().regex(/^\d{6}$/).optional(),
  })
  .strict();
const paymentAccountBody = configureAccountSchema.extend({
  password: z.string().min(1).max(128),
  otp: z.string().regex(/^\d{6}$/).optional(),
});

/** Đọc thân request thô, dừng và báo lỗi khi vượt `max` byte (body parser JSON không xử lý image/*). */
function readLimited(req: NodeJS.ReadableStream, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const fail = () => {
      if (done) return;
      done = true;
      req.removeAllListeners('data');
      req.resume();
      reject(new DomainError('VALIDATION_FAILED', 'Logo phải là ảnh PNG, JPEG hoặc WebP, tối đa 200 KB.', { field: 'logo' }));
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

/**
 * API quản trị. Mọi route đều qua AuthGuard (đăng nhập + quyền + giới hạn theo `:operatorId`).
 * Thao tác ghi được lưu nhật ký (`audit_logs`).
 */
@Controller('api/v1/admin')
@UseGuards(AuthGuard)
export class AdminController {
  constructor(
    private readonly operators: OperatorsService,
    private readonly layouts: SeatLayoutsService,
    private readonly vehicles: VehiclesService,
    private readonly trips: TripsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly schedules: TripSchedulesService,
    private readonly auth: AuthService,
    private readonly assistants: TripAssistantsService,
    private readonly clock: Clock,
  ) {}

  private log(req: AuthedRequest, operatorId: string | null, action: string, entity: string, entityId?: string, data?: object) {
    return this.audit.record({
      operatorId, actorUserId: req.auth.id, action, entity, entityId: entityId ?? null, data: data as Record<string, unknown>,
    });
  }

  @Get('operators/:operatorId/trip-schedules')
  @Perm('trip.read')
  async listSchedules(@Param('operatorId') op:string) { return {schedules:await this.schedules.list(op)}; }
  @Post('operators/:operatorId/trip-schedules')
  @Perm('trip.write')
  createSchedule(@Req() req:AuthedRequest,@Param('operatorId') op:string,@Body() body:unknown,@Headers('idempotency-key') key?:string) {
    return this.schedules.create(op,body,req.auth.id,key);
  }
  @Get('operators/:operatorId/trip-schedules/:id/preview')
  @Perm('trip.read')
  async previewSchedule(@Param('operatorId') op:string,@Param('id') id:string) { return {occurrences:await this.schedules.preview(op,id)}; }
  @Patch('operators/:operatorId/trip-schedules/:id')
  @Perm('trip.write')
  enableSchedule(@Req() req:AuthedRequest,@Param('operatorId') op:string,@Param('id') id:string,@Body() body:unknown) {
    const {enabled}=z.object({enabled:z.boolean()}).strict().parse(body);
    return this.schedules.setEnabled(op,id,enabled,req.auth.id);
  }
  @Post('operators/:operatorId/trip-schedules/:id/generate')
  @Perm('trip.write')
  generateSchedule(@Param('operatorId') op:string,@Param('id') id:string) { return this.schedules.generate(op,id); }
  @Put('operators/:operatorId/trip-schedules/:id/exception')
  @Perm('trip.write')
  exceptionSchedule(@Req() req:AuthedRequest,@Param('operatorId') op:string,@Param('id') id:string,@Body() body:unknown) {
    return this.schedules.saveException(op,id,body,req.auth.id);
  }

  @Get('operators/:operatorId/profile')
  @Perm('policy.read')
  profile(@Param('operatorId') op:string) { return this.operators.profile(op); }
  @Put('operators/:operatorId/profile')
  @Perm('policy.write')
  async updateProfile(@Req() req:AuthedRequest,@Param('operatorId') op:string,@Body() body:unknown) {
    const result=await this.operators.updateProfile(op,body);
    await this.log(req,op,'operator.profile','operator',op,{name:result.name,defaultDepartureTime:result.defaultDepartureTime});
    return result;
  }

  /**
   * Tải logo: thân request là chính tệp ảnh (Content-Type image/png|jpeg|webp), không qua JSON để không vướng
   * giới hạn 100 KB của body parser. Đọc tối đa LOGO_MAX_BYTES rồi dừng.
   */
  @Put('operators/:operatorId/logo')
  @Perm('policy.write')
  async uploadLogo(@Req() req: AuthedRequest, @Param('operatorId') op: string) {
    const type = String(req.headers['content-type'] ?? '');
    if (!/^image\/(png|jpeg|webp)\b/i.test(type)) {
      throw new DomainError('VALIDATION_FAILED', 'Logo phải là ảnh PNG, JPEG hoặc WebP, tối đa 200 KB.', { field: 'logo' });
    }
    const data = await readLimited(req, LOGO_MAX_BYTES);
    const mime = await this.operators.setLogo(op, data, type, this.clock.now());
    await this.log(req, op, 'operator.logo.update', 'operator', op, { mime, bytes: data.length });
    return this.operators.profile(op);
  }

  @Delete('operators/:operatorId/logo')
  @Perm('policy.write')
  async deleteLogo(@Req() req: AuthedRequest, @Param('operatorId') op: string) {
    await this.operators.removeLogo(op);
    await this.log(req, op, 'operator.logo.delete', 'operator', op);
    return this.operators.profile(op);
  }

  // ---- Nền tảng ------------------------------------------------------------

  @Get('operators')
  @Perm('operator.list')
  async listOperators() {
    return { operators: await this.operators.list() };
  }

  @Post('operators')
  @Perm('operator.create')
  async createOperator(@Req() req: AuthedRequest, @Body() body: unknown) {
    const op = await this.operators.create(body as never);
    await this.log(req, op.id, 'operator.create', 'operator', op.id, { code: op.code, name: op.name });
    return op;
  }

  @Get('operators/:operatorId/owners')
  @Perm('owner.password.reset')
  async listOwners(@Param('operatorId') operatorId: string) {
    await this.operators.getById(operatorId);
    return { owners: await this.users.listOwners(operatorId) };
  }

  /** Đặt mật khẩu tạm cho chủ xe — cần mật khẩu (và mã 2FA nếu có) của chính quản trị nền tảng. Nhật ký ghi trong transaction. */
  @Post('operators/:operatorId/owners/:userId/temporary-password')
  @Perm('owner.password.reset')
  @HttpCode(200)
  async setOwnerTemporaryPassword(
    @Req() req: AuthedRequest,
    @Param('operatorId') operatorId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    const { password, adminPassword, otp } = ownerPasswordBody.parse(body);
    await this.auth.verifyStepUp(req.auth, adminPassword, otp, 'Nhập mã Authenticator của bạn để đặt mật khẩu tạm.');
    return { owner: await this.users.setOwnerTemporaryPassword(req.auth, operatorId, userId, password) };
  }

  @Post('seat-layouts/library')
  @Perm('layout.library.write')
  async createLibraryLayout(@Req() req: AuthedRequest, @Body() body: unknown) {
    const layout = await this.layouts.create(null, body as never);
    await this.log(req, null, 'layout.library.create', 'seat_layout', layout.id, { code: layout.code, version: layout.version });
    return layout;
  }

  // ---- Nhân viên -----------------------------------------------------------

  @Get('operators/:operatorId/users')
  @Perm('user.manage')
  async listUsers(@Param('operatorId') operatorId: string) {
    await this.operators.getById(operatorId);
    return { users: await this.users.list(operatorId) };
  }

  @Post('operators/:operatorId/users')
  @Perm('user.manage')
  async createUser(@Req() req: AuthedRequest, @Param('operatorId') operatorId: string, @Body() body: unknown) {
    const user = await this.users.createStaff(operatorId, body as never, req.auth);
    await this.log(req, operatorId, 'user.create', 'user', user.id, { role: user.role, fullName: user.fullName });
    return user;
  }

  @Patch('operators/:operatorId/users/:userId')
  @Perm('user.manage')
  async updateUser(
    @Req() req: AuthedRequest,
    @Param('operatorId') operatorId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    const user = await this.users.update(req.auth, operatorId, userId, body as never);
    const changed = Object.keys((body ?? {}) as object);
    await this.log(req, operatorId, 'user.update', 'user', user.id, { changed, role: user.role });
    return user;
  }

  @Delete('operators/:operatorId/users/:userId')
  @Perm('user.manage')
  async archiveUser(
    @Req() req: AuthedRequest,
    @Param('operatorId') operatorId: string,
    @Param('userId') userId: string,
  ) {
    await this.users.archive(req.auth, operatorId, userId);
    return { ok: true };
  }

  // ---- Chính sách ----------------------------------------------------------

  @Get('operators/:operatorId/policy')
  @Perm('policy.read')
  policy(@Param('operatorId') operatorId: string) {
    return this.operators.currentPolicy(operatorId);
  }

  @Put('operators/:operatorId/policy')
  @Perm('policy.write')
  async updatePolicy(@Req() req: AuthedRequest, @Param('operatorId') operatorId: string, @Body() body: unknown) {
    const p = await this.operators.updatePolicy(operatorId, body as never);
    // Ghi chính sách sau khi gộp (thấy rõ cả các trường được giữ nguyên).
    await this.log(req, operatorId, 'policy.update', 'operator_policy', String(p.version), { ...p });
    return p;
  }

  // ---- Sơ đồ, xe -----------------------------------------------------------

  @Get('operators/:operatorId/seat-layouts')
  @Perm('fleet.read')
  async listLayouts(@Param('operatorId') operatorId: string) {
    await this.operators.getById(operatorId);
    return { layouts: await this.layouts.listUsable(operatorId) };
  }

  /** Đúng phiên bản sơ đồ theo ID (kể cả bản cũ mà xe đang gắn): của nhà xe hoặc thư viện dùng chung. */
  @Get('operators/:operatorId/seat-layouts/:layoutId')
  @Perm('fleet.read')
  async getLayout(@Param('operatorId') operatorId: string, @Param('layoutId') layoutId: string) {
    await this.operators.getById(operatorId);
    const layout = await this.layouts.getUsable(operatorId, layoutId);
    return { layout: { ...layout, shared: layout.operator_id === null } };
  }

  @Post('operators/:operatorId/seat-layouts')
  @Perm('fleet.write')
  async createLayout(@Req() req: AuthedRequest, @Param('operatorId') operatorId: string, @Body() body: unknown) {
    await this.operators.getById(operatorId);
    const layout = await this.layouts.create(operatorId, body as never);
    await this.log(req, operatorId, 'layout.create', 'seat_layout', layout.id, { code: layout.code, version: layout.version });
    return layout;
  }

  @Get('operators/:operatorId/vehicles')
  @Perm('fleet.read')
  async listVehicles(@Param('operatorId') operatorId: string) {
    await this.operators.getById(operatorId);
    return { vehicles: await this.vehicles.list(operatorId) };
  }

  @Post('operators/:operatorId/vehicles')
  @Perm('fleet.write')
  async createVehicle(@Req() req: AuthedRequest, @Param('operatorId') operatorId: string, @Body() body: unknown) {
    const v = await this.vehicles.create(operatorId, body as never);
    await this.log(req, operatorId, 'vehicle.create', 'vehicle', v.id, { code: v.code, type: v.type });
    return v;
  }

  @Patch('operators/:operatorId/vehicles/:vehicleId')
  @Perm('fleet.write')
  async updateVehicle(
    @Req() req: AuthedRequest,
    @Param('operatorId') operatorId: string,
    @Param('vehicleId') vehicleId: string,
    @Body() body: unknown,
  ) {
    const v = await this.vehicles.update(operatorId, vehicleId, body as never);
    await this.log(req, operatorId, 'vehicle.update', 'vehicle', v.id, body as object);
    return v;
  }

  // ---- Tuyến, chuyến -------------------------------------------------------

  @Get('operators/:operatorId/routes')
  @Perm('route.read')
  async listRoutes(@Param('operatorId') operatorId: string) {
    await this.operators.getById(operatorId);
    return { routes: await this.trips.listRoutes(operatorId) };
  }

  @Put('operators/:operatorId/routes/:routeId/stops')
  @Perm('route.write')
  async saveStops(@Req() req: AuthedRequest, @Param('operatorId') operatorId: string,
    @Param('routeId') routeId: string, @Body() body: unknown) {
    const stops = await this.trips.saveStops(operatorId, routeId, body);
    await this.log(req, operatorId, 'route.stops.update', 'route', routeId);
    return stops;
  }

  @Post('operators/:operatorId/route-pairs')
  @Perm('route.write')
  async routePair(@Req() req:AuthedRequest,@Param('operatorId') op:string,@Body() body:unknown) {
    const result=await this.trips.createRoutePair(op,body);
    await this.log(req,op,'route.pair.create','route',undefined,{count:result.routes.length});
    return result;
  }

  @Post('operators/:operatorId/routes')
  @Perm('route.write')
  async createRoute(@Req() req: AuthedRequest, @Param('operatorId') operatorId: string, @Body() body: unknown) {
    const r = await this.trips.createRoute(operatorId, body as never);
    await this.log(req, operatorId, 'route.create', 'route', r.id, { code: r.code });
    return r;
  }

  @Get('operators/:operatorId/trips')
  @Perm('trip.read')
  async listTrips(@Param('operatorId') operatorId: string, @Query() query: Record<string, string>) {
    await this.operators.getById(operatorId);
    if (Object.keys(query).length === 1 && query.date) {
      return { trips: await this.trips.listForAdmin(operatorId, query.date) };
    }
    return this.trips.listAdminRange(operatorId, query);
  }

  @Post('operators/:operatorId/trips/batch')
  @Perm('trip.write')
  async batchTrips(@Req() req:AuthedRequest,@Param('operatorId') op:string,@Body() body:unknown,@Headers('idempotency-key') key?:string) {
    const result=await this.trips.createBatch(op,body,key??'');
    for(const trip of result.trips) if(!trip.replayed) await this.log(req,op,'trip.create','trip',trip.id,{name:trip.name});
    return result;
  }

  /** Phụ xe đang hoạt động của nhà xe, để chọn khi phân công. */
  @Get('operators/:operatorId/assistants')
  @Perm('trip.write')
  async assistantCandidates(@Param('operatorId') op: string) {
    return { assistants: await this.assistants.candidates(op) };
  }

  @Get('operators/:operatorId/trips/:tripId/assistants')
  @Perm('trip.read')
  async tripAssistants(@Param('operatorId') op: string, @Param('tripId') tripId: string) {
    return { assistants: await this.assistants.listForTrip(op, tripId) };
  }

  /** Đặt lại danh sách phụ xe của chuyến (thay thế toàn bộ). */
  @Put('operators/:operatorId/trips/:tripId/assistants')
  @Perm('trip.write')
  async setTripAssistants(
    @Req() req: AuthedRequest,
    @Param('operatorId') op: string,
    @Param('tripId') tripId: string,
    @Body() body: unknown,
  ) {
    const r = await this.assistants.setForTrip(op, tripId, body, req.auth.id);
    for (const userId of r.added) await this.log(req, op, 'trip.assistant.assign', 'trip', tripId, { userId });
    for (const userId of r.removed) await this.log(req, op, 'trip.assistant.unassign', 'trip', tripId, { userId });
    return { assistants: r.assistants };
  }

  /** Chuyến được giao cho phụ xe đang đăng nhập; lọc theo người dùng của phiên. */
  @Get('operators/:operatorId/my-trips')
  @Perm('trip.assigned.read')
  async myTrips(@Req() req: AuthedRequest, @Param('operatorId') op: string) {
    return { trips: await this.assistants.assignedTrips(op, req.auth.id) };
  }

  @Get('operators/:operatorId/my-trips/:tripId/passengers')
  @Perm('trip.assigned.read')
  myTripPassengers(@Req() req: AuthedRequest, @Param('operatorId') op: string, @Param('tripId') tripId: string) {
    return this.assistants.passengers(op, req.auth.id, tripId);
  }

  @Get('operators/:operatorId/trips/:tripId')
  @Perm('trip.read')
  tripDetail(@Param('operatorId') operatorId: string, @Param('tripId') tripId: string) {
    return this.trips.adminDetail(operatorId, tripId);
  }

  /** Idempotency-Key (tùy chọn, khuyến nghị): gửi lại cùng khóa trả về chuyến đã tạo thay vì tạo trùng. */
  @Post('operators/:operatorId/trips')
  @Perm('trip.write')
  async createTrip(
    @Req() req: AuthedRequest,
    @Param('operatorId') operatorId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const t = await this.trips.createTrip(operatorId, body as never, idempotencyKey);
    if (!t.replayed) await this.log(req, operatorId, 'trip.create', 'trip', t.id, { name: t.name, status: t.status });
    return t;
  }

  @Patch('operators/:operatorId/trips/:tripId/status')
  @HttpCode(200)
  @Perm('trip.write')
  async setTripStatus(
    @Req() req: AuthedRequest,
    @Param('operatorId') operatorId: string,
    @Param('tripId') tripId: string,
    @Body() body: unknown,
  ) {
    const { status } = tripStatusBody.parse(body);
    const t = await this.trips.setStatus(operatorId, tripId, status);
    await this.log(req, operatorId, 'trip.status', 'trip', t.id, { status });
    return t;
  }

  // ---- Thanh toán (nhật ký ghi trong cùng transaction ở PaymentsService) ----

  @Get('operators/:operatorId/payment-account')
  @Perm('payment.configure')
  async paymentAccount(@Param('operatorId') operatorId: string) {
    await this.operators.getById(operatorId);
    return { account: await this.payments.getAccount(operatorId) };
  }

  @Put('operators/:operatorId/payment-account')
  @Perm('payment.configure')
  async configurePaymentAccount(@Req() req: AuthedRequest, @Param('operatorId') operatorId: string, @Body() body: unknown) {
    const { password, otp, ...account } = paymentAccountBody.parse(body);
    await this.auth.verifyPaymentCredentials(req.auth, password, otp);
    return { account: await this.payments.configureAccount(req.auth, operatorId, account) };
  }

  @Get('operators/:operatorId/payments')
  @Perm('payment.read')
  async listPayments(@Param('operatorId') operatorId: string, @Query('review') review?: string) {
    await this.operators.getById(operatorId);
    return { payments: await this.payments.list(operatorId, { review }) };
  }

  @Post('operators/:operatorId/payments/manual')
  @Perm('payment.record')
  recordManualPayment(
    @Req() req: AuthedRequest,
    @Param('operatorId') operatorId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) throw new DomainError('VALIDATION_FAILED', 'Thiếu header Idempotency-Key.', { field: 'Idempotency-Key' });
    return this.payments.recordManual(req.auth, operatorId, body as never, idempotencyKey);
  }

  @Post('operators/:operatorId/payments/reconcile')
  @HttpCode(200)
  @Perm('payment.manage')
  async reconcilePayments(@Req() req: AuthedRequest, @Param('operatorId') operatorId: string) {
    const result = await this.payments.reconcile(operatorId);
    await this.log(req, operatorId, 'payment.reconcile', 'operator', operatorId, result);
    return result;
  }

  @Post('operators/:operatorId/payments/:paymentId/allocate')
  @HttpCode(200)
  @Perm('payment.manage')
  allocatePayment(
    @Req() req: AuthedRequest,
    @Param('operatorId') operatorId: string,
    @Param('paymentId') paymentId: string,
    @Body() body: unknown,
  ) {
    return this.payments.allocate(req.auth, operatorId, paymentId, body as never);
  }

  @Post('operators/:operatorId/payments/:paymentId/resolve')
  @HttpCode(200)
  @Perm('payment.manage')
  resolvePayment(
    @Req() req: AuthedRequest,
    @Param('operatorId') operatorId: string,
    @Param('paymentId') paymentId: string,
    @Body() body: unknown,
  ) {
    return this.payments.resolve(req.auth, operatorId, paymentId, body as never);
  }

  // ---- Nhật ký -------------------------------------------------------------

  @Get('operators/:operatorId/audit-logs')
  @Perm('audit.read')
  async auditLogs(@Req() req: AuthedRequest, @Param('operatorId') operatorId: string) {
    await this.operators.getById(operatorId);
    // Quản trị nền tảng không động vào tiền của nhà xe → không xem chi tiết thao tác tiền.
    const hide = req.auth.role === 'PLATFORM_ADMIN' ? ['payment.'] : [];
    return { entries: await this.audit.list(operatorId, 100, hide) };
  }
}
