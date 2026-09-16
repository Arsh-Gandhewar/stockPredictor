import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import * as crypto from 'crypto';
import { PredictionController } from './prediction.controller';
import { QuantPredictionService } from './prediction.service';
import { PortfolioController } from '../portfolio/portfolio.controller';
import { PortfolioService } from '../portfolio/portfolio.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GlobalExceptionFilter } from '../../common/filters/http-exception.filter';
import { DatabaseService } from '../../database/database.service';

describe('Tier 2.5: Full-Chain HTTP E2E Pipeline (Supertest)', () => {
  let app: INestApplication;
  const testSecret = 'quantx_institutional_test_jwt_secret_32bytes_long!';
  const prevEnv = { ...process.env };

  const mockPredictionService = {
    trainPipeline: jest.fn().mockResolvedValue({ success: true, message: 'Model trained successfully' }),
    getProductionGovernanceStatus: jest.fn().mockReturnValue({ status: 'HEALTHY', activeArtifactId: 'art_123' }),
    getProductionScorecard: jest.fn().mockReturnValue({ totalChecks: 18, passedChecks: 18 }),
    getModelStatus: jest.fn().mockReturnValue({ isOnline: true, version: '5.1.0' }),
    getModelPerformance: jest.fn().mockResolvedValue({ winRate: 0.72 }),
    getPrediction: jest.fn().mockResolvedValue({ ticker: 'RELIANCE.NS', decision: 'STRONG_BUY' }),
  };

  const mockPortfolioService = {
    getPortfolio: jest.fn().mockResolvedValue({ totalPortfolioValue: 1050000, availableCash: 950000, positions: [] }),
    executeTrade: jest.fn().mockImplementation((userId, ticker, type, quantity, orderType, idempotencyKey, limitPrice) => {
      return Promise.resolve({
        success: true,
        ticker,
        type,
        orderType,
        executionModel: 'IMMEDIATE_OR_CANCEL',
        orderStatus: 'FILLED',
        quantity,
      });
    }),
    getAllTrades: jest.fn().mockResolvedValue([]),
    processAutoSell: jest.fn().mockResolvedValue({ executedTrades: [] }),
  };

  const mockDb = {
    client: {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ pg_try_advisory_lock: true }]),
      portfolio: { findUnique: jest.fn() },
    },
  };

  function createSignedJwt(payload: Record<string, any>, secret: string = testSecret): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${hB64}.${pB64}`;
    const sig = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
    return `${signingInput}.${sig}`;
  }

  let userToken: string;
  let adminToken: string;
  let expiredToken: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    process.env.ADMIN_USER_IDS = 'user_admin_001,user_admin_002';
    process.env.ALLOW_LOCAL_MOCK_AUTH = 'false';
    process.env.NODE_ENV = 'development';

    userToken = createSignedJwt({
      sub: 'user_regular_123',
      role: 'USER',
      iat: Math.floor(Date.now() / 1000) - 10,
      nbf: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    adminToken = createSignedJwt({
      sub: 'user_admin_001',
      role: 'ADMIN',
      iat: Math.floor(Date.now() / 1000) - 10,
      nbf: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    expiredToken = createSignedJwt({
      sub: 'user_regular_123',
      role: 'USER',
      iat: Math.floor(Date.now() / 1000) - 7200,
      nbf: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60000, limit: 300 },
          { name: 'expensive', ttl: 60000, limit: 30 },
          { name: 'training', ttl: 600000, limit: 3 },
        ]),
      ],
      controllers: [PredictionController, PortfolioController],
      providers: [
        { provide: QuantPredictionService, useValue: mockPredictionService },
        { provide: PortfolioService, useValue: mockPortfolioService },
        { provide: DatabaseService, useValue: mockDb },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = prevEnv;
  });

  describe('Full HTTP Auth & Endpoint Boundaries', () => {
    it('GET /portfolio without Bearer token should return 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .get('/portfolio')
        .expect(401);

      expect(res.body.error.message).toContain('Bearer authentication token is required');
    });

    it('GET /portfolio with expired Bearer token should return 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .get('/portfolio')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(res.body.error.message).toContain('expired');
    });

    it('GET /portfolio with valid user Bearer token should return 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/portfolio')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.totalPortfolioValue).toBe(1050000);
      expect(mockPortfolioService.getPortfolio).toHaveBeenCalledWith('user_regular_123');
    });

    it('GET /prediction/governance without token should return 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .get('/prediction/governance')
        .expect(401);
    });

    it('GET /prediction/governance with regular USER role should return 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get('/prediction/governance')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(res.body.error.message).toContain('FORBIDDEN');
    });

    it('GET /prediction/governance with ADMIN role should return 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/prediction/governance')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.status).toBe('HEALTHY');
      expect(res.body.activeArtifactId).toBe('art_123');
    });

    it('POST /prediction/train with regular USER role should return 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(res.body.error.message).toContain('FORBIDDEN');
    });

    it('POST /prediction/train with ADMIN role should return 201 Created', async () => {
      const res = await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(mockPredictionService.trainPipeline).toHaveBeenCalled();
    });

    it('POST /prediction/train should enforce rate limit and return 429 after exceeding limit', async () => {
      // 2 more requests within limit
      await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${adminToken}`);

      await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${adminToken}`);

      // 4th request exceeds limit of 3
      const res = await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(429);

      expect(res.body.error.statusCode).toBe(429);
    });

    it('GET /prediction/model-status (public endpoint) should return 200 without token', async () => {
      const res = await request(app.getHttpServer())
        .get('/prediction/model-status')
        .expect(200);

      expect(res.body.isOnline).toBe(true);
    });

    it('POST /portfolio/trade with invalid limit price should return 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/portfolio/trade')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          ticker: 'RELIANCE.NS',
          type: 'BUY',
          quantity: 10,
          orderType: 'LIMIT',
          limitPrice: -50,
        })
        .expect(400);
    });
  });
});
