import { ExecutionContext, UnauthorizedException, ForbiddenException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as crypto from 'crypto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PredictionController } from './prediction.controller';

describe('Tier 2: Institutional Auth Matrix & Role Permutations Spec', () => {
  let authGuard: AuthGuard;
  let reflector: Reflector;
  let rolesGuard: RolesGuard;

  const testSecret = 'quantx_institutional_test_jwt_secret_32bytes_long!';
  const prevEnv = { ...process.env };

  beforeAll(() => {
    process.env.JWT_SECRET = testSecret;
    process.env.QUANTX_API_KEY = 'test-service-key-9999';
    process.env.ADMIN_USER_IDS = 'user_admin_001,user_admin_002';
    process.env.ALLOW_LOCAL_MOCK_AUTH = 'false';
  });

  afterAll(() => {
    process.env = prevEnv;
  });

  beforeEach(() => {
    authGuard = new AuthGuard();
    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);
  });

  function createSignedJwt(payload: Record<string, any>, secret: string = testSecret): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${hB64}.${pB64}`;
    const sig = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
    return `${signingInput}.${sig}`;
  }

  function mockContext(req: Record<string, any>, handler?: any, targetClass?: any): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
      getHandler: () => handler || (() => {}),
      getClass: () => targetClass || class DummyController {},
    } as unknown as ExecutionContext;
  }

  describe('AuthGuard Boundary Enforcement', () => {
    it('should reject requests with missing Authorization header (401)', () => {
      const req = { headers: {} };
      const ctx = mockContext(req);
      expect(() => authGuard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('should reject requests with empty Bearer token (401)', () => {
      const req = { headers: { authorization: 'Bearer ' } };
      const ctx = mockContext(req);
      expect(() => authGuard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('should reject malformed tokens with fewer than 3 segments (401)', () => {
      const req = { headers: { authorization: 'Bearer abc.def' } };
      const ctx = mockContext(req);
      expect(() => authGuard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('should reject tokens with invalid cryptographic signature (401)', () => {
      const token = createSignedJwt(
        {
          sub: 'user_123',
          iat: Math.floor(Date.now() / 1000) - 10,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        'wrong_secret_tampered'
      );
      const req = { headers: { authorization: `Bearer ${token}` } };
      const ctx = mockContext(req);
      expect(() => authGuard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('should reject expired tokens (401)', () => {
      const token = createSignedJwt({
        sub: 'user_123',
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
      });
      const req = { headers: { authorization: `Bearer ${token}` } };
      const ctx = mockContext(req);
      expect(() => authGuard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('should reject future-issued tokens exceeding clock skew threshold (401)', () => {
      const token = createSignedJwt({
        sub: 'user_123',
        iat: Math.floor(Date.now() / 1000) + 120, // 2 minutes in future
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const req = { headers: { authorization: `Bearer ${token}` } };
      const ctx = mockContext(req);
      expect(() => authGuard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('should reject user impersonation when x-user-id does not match token sub (403)', () => {
      const token = createSignedJwt({
        sub: 'user_real_alice',
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const req = {
        headers: {
          authorization: `Bearer ${token}`,
          'x-user-id': 'user_victim_bob',
        },
      };
      const ctx = mockContext(req);
      expect(() => authGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should authenticate standard user and assign USER role when sub is not in ADMIN_USER_IDS', () => {
      const token = createSignedJwt({
        sub: 'user_regular_trader',
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const req: any = {
        headers: { authorization: `Bearer ${token}` },
      };
      const ctx = mockContext(req);
      const allowed = authGuard.canActivate(ctx);
      expect(allowed).toBe(true);
      expect(req.userRole).toBe('USER');
      expect(req.userId).toBe('user_regular_trader');
    });

    it('should authenticate admin user and assign ADMIN role when sub is in ADMIN_USER_IDS', () => {
      const token = createSignedJwt({
        sub: 'user_admin_001',
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const req: any = {
        headers: { authorization: `Bearer ${token}` },
      };
      const ctx = mockContext(req);
      const allowed = authGuard.canActivate(ctx);
      expect(allowed).toBe(true);
      expect(req.userRole).toBe('ADMIN');
      expect(req.userId).toBe('user_admin_001');
    });

    it('should authenticate valid Service API Key and assign SERVICE role', () => {
      const req: any = {
        headers: { 'x-api-key': 'test-service-key-9999' },
      };
      const ctx = mockContext(req);
      const allowed = authGuard.canActivate(ctx);
      expect(allowed).toBe(true);
      expect(req.userRole).toBe('SERVICE');
      expect(req.userId).toBe('quantx_service');
    });

    it('should block Service API Key if caller attempts arbitrary user impersonation', () => {
      const req: any = {
        headers: {
          'x-api-key': 'test-service-key-9999',
          'x-user-id': 'user_victim_bob',
        },
      };
      const ctx = mockContext(req);
      expect(() => authGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('RolesGuard Boundary Enforcement', () => {
    it('should allow access if no roles are required on endpoint', () => {
      const req = { user: { role: 'USER' } };
      const ctx = mockContext(req);
      expect(rolesGuard.canActivate(ctx)).toBe(true);
    });

    it('should forbid USER role from accessing ADMIN/SERVICE endpoint (403)', () => {
      const handler = () => {};
      Reflect.defineMetadata(ROLES_KEY, ['ADMIN', 'SERVICE'], handler);
      const req = { user: { role: 'USER' }, userRole: 'USER' };
      const ctx = mockContext(req, handler);
      expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should allow ADMIN role to access ADMIN/SERVICE endpoint', () => {
      const handler = () => {};
      Reflect.defineMetadata(ROLES_KEY, ['ADMIN', 'SERVICE'], handler);
      const req = { user: { role: 'ADMIN' }, userRole: 'ADMIN' };
      const ctx = mockContext(req, handler);
      expect(rolesGuard.canActivate(ctx)).toBe(true);
    });

    it('should allow SERVICE role to access ADMIN/SERVICE endpoint', () => {
      const handler = () => {};
      Reflect.defineMetadata(ROLES_KEY, ['ADMIN', 'SERVICE'], handler);
      const req = { user: { role: 'SERVICE' }, userRole: 'SERVICE' };
      const ctx = mockContext(req, handler);
      expect(rolesGuard.canActivate(ctx)).toBe(true);
    });
  });

  describe('PredictionController Guard & Role Metadata Verification', () => {
    const protectedMethods: (keyof PredictionController)[] = [
      'trainModel',
      'getGovernance',
      'getScorecard',
      'getModelAudit',
      'getModelArtifact',
      'getWalkForward',
      'getCalibration',
      'getHoldout',
    ];

    const publicMethods: (keyof PredictionController)[] = [
      'getModelStatus',
      'getModelPerformance',
      'getTopRanked',
      'getHighRisk',
      'getRegime',
      'getPrediction',
    ];

    it.each(protectedMethods)('protected endpoint %s should require ADMIN or SERVICE role', (methodName) => {
      const target = PredictionController.prototype[methodName];
      expect(target).toBeDefined();
      const requiredRoles = reflector.get(ROLES_KEY, target);
      expect(requiredRoles).toBeDefined();
      expect(requiredRoles).toEqual(expect.arrayContaining(['ADMIN', 'SERVICE']));
    });

    it.each(publicMethods)('public client endpoint %s should NOT require ADMIN or SERVICE role', (methodName) => {
      const target = PredictionController.prototype[methodName];
      expect(target).toBeDefined();
      const requiredRoles = reflector.get(ROLES_KEY, target);
      expect(requiredRoles).toBeUndefined();
    });

    it('should reject concurrent training in the same process with 409 ConflictException', async () => {
      let resolveTraining: any;
      const mockService = {
        trainPipeline: jest.fn().mockImplementation(() => new Promise((resolve) => {
          resolveTraining = resolve;
        })),
      };
      const controller = new PredictionController(mockService as any);
      const promise1 = controller.trainModel();

      let caughtError: any;
      try {
        await controller.trainModel();
      } catch (err) {
        caughtError = err;
      }
      expect(caughtError).toBeInstanceOf(ConflictException);
      expect(caughtError.message).toContain('TRAINING_IN_PROGRESS');

      resolveTraining();
      await promise1;
    });

    it('should reject training with 409 ConflictException when distributed DB lock is already held by another instance', async () => {
      const mockService = { trainPipeline: jest.fn() };
      const mockLockService = {
        acquireLock: jest.fn().mockResolvedValue({ acquired: false, ownerId: 'other-worker' }),
        releaseLock: jest.fn(),
      };
      const controller = new PredictionController(mockService as any, mockLockService as any);
      let caughtError: any;
      try {
        await controller.trainModel();
      } catch (err) {
        caughtError = err;
      }
      expect(caughtError).toBeInstanceOf(ConflictException);
      expect(caughtError.message).toContain('DISTRIBUTED_TRAINING_IN_PROGRESS');
      expect(mockService.trainPipeline).not.toHaveBeenCalled();
    });

    it('should fail closed with 503 ServiceUnavailableException and never train if distributed lock provider errors', async () => {
      const mockService = { trainPipeline: jest.fn() };
      const mockLockService = {
        acquireLock: jest.fn().mockRejectedValue(
          new ServiceUnavailableException('DISTRIBUTED_LOCK_UNAVAILABLE: Database lock provider is unreachable.')
        ),
        releaseLock: jest.fn(),
      };
      const controller = new PredictionController(mockService as any, mockLockService as any);
      let caughtError: any;
      try {
        await controller.trainModel();
      } catch (err) {
        caughtError = err;
      }
      expect(caughtError).toBeInstanceOf(ServiceUnavailableException);
      expect(caughtError.message).toContain('DISTRIBUTED_LOCK_UNAVAILABLE');
      expect(mockService.trainPipeline).not.toHaveBeenCalled();
    });
  });
});
