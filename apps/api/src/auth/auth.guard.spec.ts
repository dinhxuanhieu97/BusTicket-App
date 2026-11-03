import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminController } from '../admin/admin.controller';
import { DomainError } from '../common/errors';
import { AuthController } from './auth.controller';
import { AllowScopes, AuthGuard, AuthOnly, Perm } from './auth.guard';
import { AuthService, AuthUser } from './auth.service';

class Fixture {
  noDecorator() {}
  @Perm('fleet.write') write() {}
  @AuthOnly() me() {}
  @AuthOnly() @AllowScopes('full', 'mfa_setup') setup() {}
}

const OP_A = '11111111-1111-4111-8111-111111111111';
const OP_B = '22222222-2222-4222-8222-222222222222';

function ctxFor(handler: keyof Fixture, params: Record<string, string> = {}, auth = 'Bearer t') {
  const req = { headers: { authorization: auth }, params } as Record<string, unknown>;
  const ctx = {
    getHandler: () => Fixture.prototype[handler],
    getClass: () => Fixture,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function guardFor(user: Partial<AuthUser>) {
  const auth = { authenticate: jest.fn().mockResolvedValue({ scope: 'full', operatorId: OP_A, role: 'OWNER', ...user }) };
  return { guard: new AuthGuard(new Reflector(), auth as unknown as AuthService), auth };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ALLOWED';
  } catch (e) {
    return (e as DomainError).code;
  }
}

describe('AuthGuard', () => {
  it('denies a route without @Perm or @AuthOnly before even checking the token (fail closed)', async () => {
    const { guard, auth } = guardFor({});
    expect(await codeOf(guard.canActivate(ctxFor('noDecorator').ctx))).toBe('FORBIDDEN');
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('requires a Bearer token', async () => {
    const { guard } = guardFor({});
    expect(await codeOf(guard.canActivate(ctxFor('me', {}, '').ctx))).toBe('UNAUTHENTICATED');
    expect(await codeOf(guard.canActivate(ctxFor('me', {}, 'Basic abc').ctx))).toBe('UNAUTHENTICATED');
  });

  it('allows a permitted role inside its own operator and attaches the user', async () => {
    const { guard } = guardFor({});
    const { ctx, req } = ctxFor('write', { operatorId: OP_A });
    expect(await codeOf(guard.canActivate(ctx))).toBe('ALLOWED');
    expect(req.auth).toMatchObject({ operatorId: OP_A });
  });

  it("hides another operator's resources behind NOT_FOUND", async () => {
    const { guard } = guardFor({});
    expect(await codeOf(guard.canActivate(ctxFor('write', { operatorId: OP_B }).ctx))).toBe('NOT_FOUND');
    expect(await codeOf(guard.canActivate(ctxFor('write', { operatorId: 'x' }).ctx))).toBe('NOT_FOUND');
  });

  it('lets the platform admin reach any operator for setup', async () => {
    const { guard } = guardFor({ role: 'PLATFORM_ADMIN', operatorId: null });
    expect(await codeOf(guard.canActivate(ctxFor('write', { operatorId: OP_B }).ctx))).toBe('ALLOWED');
  });

  it('denies a role without the permission', async () => {
    const { guard } = guardFor({ role: 'SELLER' });
    expect(await codeOf(guard.canActivate(ctxFor('write', { operatorId: OP_A }).ctx))).toBe('FORBIDDEN');
  });

  it('accepts an mfa_setup token on a route that explicitly allows it', async () => {
    const { guard } = guardFor({ scope: 'mfa_setup' });
    expect(await codeOf(guard.canActivate(ctxFor('setup').ctx))).toBe('ALLOWED');
  });

  it('treats an upper-case spelling of the own operator id as the same operator', async () => {
    const { guard } = guardFor({});
    expect(await codeOf(guard.canActivate(ctxFor('write', { operatorId: OP_A.toUpperCase() }).ctx))).toBe('ALLOWED');
  });

  it('rejects an mfa_setup token on routes that only allow full tokens', async () => {
    const { guard } = guardFor({ scope: 'mfa_setup' });
    expect(await codeOf(guard.canActivate(ctxFor('write', { operatorId: OP_A }).ctx))).toBe('MFA_SETUP_REQUIRED');
  });
});

describe('every admin and authenticated auth route declares its access rule', () => {
  type Proto = Record<string, (...a: unknown[]) => unknown>;
  const protoOf = (cls: { prototype: object }) => cls.prototype as unknown as Proto;
  const routeMethods = (cls: { prototype: object }) =>
    Object.getOwnPropertyNames(cls.prototype).filter((name) => {
      const fn = protoOf(cls)[name];
      return name !== 'constructor' && typeof fn === 'function' && Reflect.getMetadata('method', fn) !== undefined;
    });
  const meta = (key: string, fn: unknown) => Reflect.getMetadata(key, fn as object);

  it('AdminController: each route has @Perm', () => {
    const routes = routeMethods(AdminController);
    const missing = routes.filter((name) => !meta('pnticket:perm', protoOf(AdminController)[name]));
    expect(routes.length).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });

  it('AuthController: only login is public', () => {
    const open = routeMethods(AuthController).filter((name) => {
      const fn = protoOf(AuthController)[name];
      return !meta('pnticket:perm', fn) && !meta('pnticket:auth-only', fn);
    });
    expect(open).toEqual(['login']);
  });
});
