import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthedRequest, AuthGuard, Perm } from '../auth/auth.guard';
import { UsersService } from '../auth/users.service';
import { DomainError } from '../common/errors';
import { OperatorsService } from '../operators/operators.service';
import { SeatLayoutsService } from '../seat-layouts/seat-layouts.service';
import { TripsService } from '../trips/trips.service';
import { VehiclesService } from '../vehicles/vehicles.service';

const tripStatusBody = z.object({ status: z.enum(['OPEN', 'CLOSED']) }).strict();

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
  ) {}

  private log(req: AuthedRequest, operatorId: string | null, action: string, entity: string, entityId?: string, data?: object) {
    return this.audit.record({
      operatorId, actorUserId: req.auth.id, action, entity, entityId: entityId ?? null, data: data as Record<string, unknown>,
    });
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
    const user = await this.users.createStaff(operatorId, body as never);
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
    await this.log(req, operatorId, 'policy.update', 'operator_policy', String(p.version), body as object);
    return p;
  }

  // ---- Sơ đồ, xe -----------------------------------------------------------

  @Get('operators/:operatorId/seat-layouts')
  @Perm('fleet.read')
  async listLayouts(@Param('operatorId') operatorId: string) {
    await this.operators.getById(operatorId);
    return { layouts: await this.layouts.listUsable(operatorId) };
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

  @Post('operators/:operatorId/routes')
  @Perm('route.write')
  async createRoute(@Req() req: AuthedRequest, @Param('operatorId') operatorId: string, @Body() body: unknown) {
    const r = await this.trips.createRoute(operatorId, body as never);
    await this.log(req, operatorId, 'route.create', 'route', r.id, { code: r.code });
    return r;
  }

  @Get('operators/:operatorId/trips')
  @Perm('trip.read')
  async listTrips(@Param('operatorId') operatorId: string, @Query('date') date?: string) {
    if (!date) throw new DomainError('VALIDATION_FAILED', 'Thiếu ngày (date=YYYY-MM-DD).', { field: 'date' });
    await this.operators.getById(operatorId);
    return { trips: await this.trips.listForAdmin(operatorId, date) };
  }

  @Post('operators/:operatorId/trips')
  @Perm('trip.write')
  async createTrip(@Req() req: AuthedRequest, @Param('operatorId') operatorId: string, @Body() body: unknown) {
    const t = await this.trips.createTrip(operatorId, body as never);
    await this.log(req, operatorId, 'trip.create', 'trip', t.id, { name: t.name, status: t.status });
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

  // ---- Nhật ký -------------------------------------------------------------

  @Get('operators/:operatorId/audit-logs')
  @Perm('audit.read')
  async auditLogs(@Param('operatorId') operatorId: string) {
    await this.operators.getById(operatorId);
    return { entries: await this.audit.list(operatorId) };
  }
}
