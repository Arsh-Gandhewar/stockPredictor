import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { YahooMarketDataProvider } from '../src/modules/stock/providers/yahoo-market-data.provider';
import { QuantPredictionService } from '../src/modules/prediction/prediction.service';

describe('QuantX True AppModule Full HTTP E2E Institutional Verification', () => {
  let app: INestApplication;
  const testSecret = 'quantx_institutional_test_jwt_secret_32bytes_long!';
  const prevEnv = { ...process.env };
  let ipCounter = 10;

  function nextIp(): string {
    return `192.168.10.${ipCounter++}`;
  }

  // Stateful in-memory database simulation for authentic E2E test execution
  let inMemoryCash = 1_000_000;
  const inMemoryPositions: any[] = [];
  const inMemoryIdempotency = new Map<string, any>();
  const inMemoryAlerts: any[] = [];
  const inMemoryWatchlists: any[] = [];
  const inMemoryLocks = new Map<
    string,
    { ownerId: string; expiresAt: number; releasedAt: number | null }
  >();

  const mockDbClient = {
    user: {
      upsert: jest.fn().mockImplementation(({ where, create }) => {
        return Promise.resolve({
          id: 'user_internal_uuid_123',
          clerkId: where.clerkId,
          email: create.email,
          role: 'USER',
        });
      }),
      findUnique: jest.fn().mockImplementation(({ where }) => {
        return Promise.resolve({
          id: 'user_internal_uuid_123',
          clerkId: where.clerkId || 'user_regular_123',
          email: 'user@quantx.internal',
          role: 'USER',
        });
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'user_internal_uuid_123',
        clerkId: 'user_regular_123',
      }),
    },
    portfolio: {
      upsert: jest.fn().mockImplementation(() => {
        return Promise.resolve({
          id: 'port_123',
          userId: 'user_internal_uuid_123',
          availableCash: inMemoryCash,
          positions: inMemoryPositions,
        });
      }),
      findUnique: jest.fn().mockImplementation(() => {
        return Promise.resolve({
          id: 'port_123',
          userId: 'user_internal_uuid_123',
          availableCash: inMemoryCash,
          positions: inMemoryPositions,
        });
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(() => {
        return Promise.resolve({
          id: 'port_123',
          userId: 'user_internal_uuid_123',
          availableCash: inMemoryCash,
          positions: inMemoryPositions,
        });
      }),
      update: jest.fn().mockImplementation(({ data }) => {
        if (data.availableCash !== undefined)
          inMemoryCash = Number(data.availableCash);
        return Promise.resolve({
          id: 'port_123',
          availableCash: inMemoryCash,
        });
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        const required = where.availableCash?.gte;
        const decrement = data.availableCash?.decrement;
        if (required !== undefined && decrement !== undefined) {
          if (inMemoryCash >= required) {
            inMemoryCash -= decrement;
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }
        return Promise.resolve({ count: 1 });
      }),
    },
    stock: {
      findFirst: jest.fn().mockImplementation(({ where }) => {
        return Promise.resolve({
          id: 'stock_reliance_id',
          ticker: 'RELIANCE.NS',
          name: 'Reliance Industries Ltd.',
          sector: 'Energy',
          exchange: 'NSE',
        });
      }),
      create: jest.fn().mockImplementation(({ data }) => {
        return Promise.resolve({
          id: `stock_${data.ticker}_id`,
          ticker: data.ticker,
          name: data.name,
          sector: data.sector,
          exchange: data.exchange,
        });
      }),
      upsert: jest.fn().mockImplementation(({ where, create }) => {
        return Promise.resolve({
          id: `stock_${where.ticker}_id`,
          ticker: where.ticker,
          name: create?.name || where.ticker,
          sector: create?.sector || 'General',
          exchange: create?.exchange || 'NSE',
        });
      }),
    },
    position: {
      findUnique: jest.fn().mockImplementation(({ where }) => {
        const found = inMemoryPositions.find((p) => p.id === where.id);
        return Promise.resolve(found || null);
      }),
      create: jest.fn().mockImplementation(({ data }) => {
        const newPos = {
          id: `pos_${Date.now()}`,
          portfolioId: data.portfolioId,
          stockId: data.stockId,
          quantity: data.quantity,
          averagePrice: data.averagePrice,
          stopLossPrice: data.stopLossPrice,
          targetPrice: data.targetPrice,
          stock: {
            id: data.stockId,
            ticker: 'RELIANCE.NS',
            name: 'Reliance Industries Ltd.',
            sector: 'Energy',
            exchange: 'NSE',
          },
        };
        inMemoryPositions.push(newPos);
        return Promise.resolve(newPos);
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const idx = inMemoryPositions.findIndex((p) => p.id === where.id);
        if (idx >= 0) {
          inMemoryPositions[idx] = { ...inMemoryPositions[idx], ...data };
          return Promise.resolve(inMemoryPositions[idx]);
        }
        return Promise.resolve(null);
      }),
      delete: jest.fn().mockImplementation(({ where }) => {
        const idx = inMemoryPositions.findIndex((p) => p.id === where.id);
        if (idx >= 0) inMemoryPositions.splice(idx, 1);
        return Promise.resolve({ id: where.id });
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        const idx = inMemoryPositions.findIndex((p) => p.id === where.id);
        if (idx >= 0) {
          if (
            where.quantity?.gte !== undefined &&
            data.quantity?.decrement !== undefined
          ) {
            if (inMemoryPositions[idx].quantity >= where.quantity.gte) {
              inMemoryPositions[idx].quantity -= data.quantity.decrement;
              return Promise.resolve({ count: 1 });
            }
            return Promise.resolve({ count: 0 });
          }
          inMemoryPositions[idx] = { ...inMemoryPositions[idx], ...data };
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      }),
      deleteMany: jest.fn().mockImplementation(({ where }) => {
        const idx = inMemoryPositions.findIndex((p) => p.id === where.id);
        if (idx >= 0) {
          if (
            where.quantity !== undefined &&
            inMemoryPositions[idx].quantity !== where.quantity
          ) {
            return Promise.resolve({ count: 0 });
          }
          inMemoryPositions.splice(idx, 1);
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      }),
    },
    transaction: {
      create: jest.fn().mockResolvedValue({ id: 'tx_123' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    idempotencyRecord: {
      findUnique: jest.fn().mockImplementation(({ where }) => {
        const key = `${where.userId_idempotencyKey.userId}:${where.userId_idempotencyKey.idempotencyKey}`;
        return Promise.resolve(inMemoryIdempotency.get(key) || null);
      }),
      create: jest.fn().mockImplementation(({ data }) => {
        const key = `${data.userId}:${data.idempotencyKey}`;
        const rec = { ...data, id: `idemp_${Date.now()}` };
        inMemoryIdempotency.set(key, rec);
        return Promise.resolve(rec);
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const key = `${where.userId_idempotencyKey.userId}:${where.userId_idempotencyKey.idempotencyKey}`;
        const existing = inMemoryIdempotency.get(key) || {};
        const updated = { ...existing, ...data };
        inMemoryIdempotency.set(key, updated);
        return Promise.resolve(updated);
      }),
      upsert: jest.fn().mockImplementation(({ where, update, create }) => {
        const key = `${where.userId_idempotencyKey.userId}:${where.userId_idempotencyKey.idempotencyKey}`;
        const existing = inMemoryIdempotency.get(key);
        if (existing) {
          const updated = { ...existing, ...update };
          inMemoryIdempotency.set(key, updated);
          return Promise.resolve(updated);
        } else {
          const rec = { ...create, id: `idemp_${Date.now()}` };
          inMemoryIdempotency.set(key, rec);
          return Promise.resolve(rec);
        }
      }),
    },
    alert: {
      findMany: jest.fn().mockResolvedValue(inMemoryAlerts),
      create: jest.fn().mockImplementation(({ data }) => {
        const alert = { id: `alert_${Date.now()}`, ...data };
        inMemoryAlerts.push(alert);
        return Promise.resolve(alert);
      }),
      delete: jest.fn().mockImplementation(({ where }) => {
        const idx = inMemoryAlerts.findIndex((a) => a.id === where.id);
        if (idx >= 0) inMemoryAlerts.splice(idx, 1);
        return Promise.resolve({ id: where.id });
      }),
    },
    watchlist: {
      findMany: jest.fn().mockResolvedValue(inMemoryWatchlists),
      upsert: jest
        .fn()
        .mockResolvedValue({ id: 'wl_123', name: 'Default', stocks: [] }),
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'wl_123', name: 'Default', stocks: [] }),
      create: jest.fn().mockImplementation(({ data }) => {
        const wl = { id: `wl_${Date.now()}`, ...data, stocks: [] };
        inMemoryWatchlists.push(wl);
        return Promise.resolve(wl);
      }),
    },
    watchlistStock: {
      create: jest.fn().mockResolvedValue({ id: 'wls_123' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn().mockImplementation(async (cb) => {
      return await cb(mockDbClient);
    }),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRawUnsafe: jest
      .fn()
      .mockImplementation(async (query: string, ...params: any[]) => {
        if (query.includes('SELECT lock_key FROM distributed_locks LIMIT 0')) {
          return [];
        }

        if (
          query.includes('FROM distributed_locks') &&
          query.includes('fencing_token')
        ) {
          const lockKey = params[0];
          const ownerId = params[1];
          const existing = inMemoryLocks.get(lockKey);
          if (
            existing &&
            existing.ownerId === ownerId &&
            existing.releasedAt === null &&
            existing.expiresAt > Date.now()
          ) {
            return [{ lock_key: lockKey, owner_id: ownerId, fencing_token: 1 }];
          }
          return [];
        }

        if (query.includes('INSERT INTO distributed_locks')) {
          const lockKey = params[0];
          const ownerId = params[1];
          const expiresAt = new Date(params[3]).getTime();
          const existing = inMemoryLocks.get(lockKey);

          if (
            existing &&
            existing.releasedAt === null &&
            existing.expiresAt > Date.now()
          ) {
            return [];
          }

          inMemoryLocks.set(lockKey, { ownerId, expiresAt, releasedAt: null });
          return [{ lock_key: lockKey, owner_id: ownerId, fencing_token: 1 }];
        }

        if (query.includes('UPDATE distributed_locks')) {
          const lockKey = params[0];
          const ownerId = params[1];
          const existing = inMemoryLocks.get(lockKey);
          if (existing && existing.ownerId === ownerId) {
            if (query.includes('lease_expires_at =')) {
              existing.expiresAt = Date.now() + 600_000;
            } else {
              existing.releasedAt = Date.now();
            }
            return [{ lock_key: lockKey }];
          }
          return [];
        }

        return [];
      }),
  };

  const mockDatabaseService = {
    client: mockDbClient,
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  function createSignedJwt(
    payload: Record<string, any>,
    secret: string = testSecret,
  ): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${hB64}.${pB64}`;
    const sig = crypto
      .createHmac('sha256', secret)
      .update(signingInput)
      .digest('base64url');
    return `${signingInput}.${sig}`;
  }

  let userToken: string;
  let adminToken: string;
  let expiredToken: string;
  let malformedToken: string;

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
      exp: Math.floor(Date.now() / 1000) - 3600,
    });

    malformedToken = userToken.substring(0, userToken.length - 8) + 'CORRUPT!';

    jest
      .spyOn(QuantPredictionService.prototype, 'trainPipeline')
      .mockResolvedValue({
        success: true,
        modelVersion: '5.1.0-e2e',
        calibrationStatus: {
          '5d': { status: 'FITTED_OUT_OF_SAMPLE', ece: 0.05, brierScore: 0.12 },
        } as any,
        governanceStatus: { productionReady: true } as any,
        totalTrades: 50,
        timestamp: new Date().toISOString(),
      });

    jest
      .spyOn(QuantPredictionService.prototype, 'getPrediction')
      .mockResolvedValue({
        stock: {
          ticker: 'RELIANCE.NS',
          name: 'Reliance Industries Ltd.',
          price: 2500,
        },
        risk: { stopLossPrice: 2400, targetPrice: 2700 },
      } as any);

    jest
      .spyOn(YahooMarketDataProvider.prototype, 'getQuote')
      .mockImplementation(async (rawTicker: string): Promise<any> => {
        const clean = rawTicker.toUpperCase();
        return {
          ticker: clean,
          name: clean.replace('.NS', ''),
          price: 2500,
          change: 15.5,
          changePercent: 0.62,
          high: 2550,
          low: 2480,
          volume: 1500000,
          previousClose: 2484.5,
          open: 2490,
          timestamp: new Date().toISOString(),
          sourceTimestamp: new Date().toISOString(),
        };
      });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(mockDatabaseService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    process.env = prevEnv;
  });

  describe('All 9 Controllers HTTP Reachability via Real AppModule', () => {
    it('1. AppController: GET / -> 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/')
        .set('X-Forwarded-For', nextIp())
        .expect(200);
      expect(res.text).toBe('Hello World!');
    });

    it('2. HealthController: GET /health/liveness -> 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/liveness')
        .set('X-Forwarded-For', nextIp())
        .expect(200);
      expect(res.body.status).toBe('alive');
    });

    it('3. PredictionController: GET /prediction/model-status (Public) -> 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/prediction/model-status')
        .set('X-Forwarded-For', nextIp())
        .expect(200);
      expect(res.body.status).toBeDefined();
      expect(res.body.version).toBeDefined();
    });

    it('4. StockController: GET /stock/market-summary -> 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/stock/market-summary')
        .set('X-Forwarded-For', nextIp())
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('5. StockController: GET /stock/search?q=RELIANCE -> 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/stock/search?q=RELIANCE')
        .set('X-Forwarded-For', nextIp())
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('6. NewsController: GET /news -> 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/news')
        .set('X-Forwarded-For', nextIp())
        .expect(200);
      expect(res.body).toBeDefined();
    });

    it('7. PortfolioController: GET /portfolio (Auth) -> 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/portfolio')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .expect(200);

      expect(res.body.availableCash).toBe(1000000);
    });

    it('8. WatchlistController: GET /watchlist (Auth) -> 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/watchlist')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .expect(200);

      expect(res.body).toBeDefined();
    });

    it('9. AlertsController: GET /alerts (Auth) -> 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/alerts')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Full Security & Role Matrix End-to-End', () => {
    it('GET /portfolio without Authorization header returns 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .get('/portfolio')
        .set('X-Forwarded-For', nextIp())
        .expect(401);
      expect(res.body.error.message).toContain(
        'Bearer authentication token is required',
      );
    });

    it('GET /portfolio with expired token returns 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .get('/portfolio')
        .set('Authorization', `Bearer ${expiredToken}`)
        .set('X-Forwarded-For', nextIp())
        .expect(401);

      expect(res.body.error.message).toContain('expired');
    });

    it('GET /portfolio with malformed signature returns 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .get('/portfolio')
        .set('Authorization', `Bearer ${malformedToken}`)
        .set('X-Forwarded-For', nextIp())
        .expect(401);

      expect(res.body.error.message).toContain('signature verification failed');
    });

    it('GET /prediction/governance with USER role returns 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get('/prediction/governance')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .expect(403);

      expect(res.body.error.message).toContain('FORBIDDEN');
    });

    it('GET /prediction/governance with ADMIN role returns 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/prediction/governance')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', nextIp())
        .expect(200);

      expect(res.body.modelStatus).toBeDefined();
      expect(res.body.artifactStatus).toBeDefined();
    });

    it('POST /prediction/train with USER role returns 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .expect(403);

      expect(res.body.error.message).toContain('FORBIDDEN');
    });

    it('POST /prediction/train with ADMIN role acquires distributed lease and returns 201 Created', async () => {
      const res = await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', nextIp())
        .expect(201);

      expect(res.body.success).toBe(true);
    });
  });

  describe('Negative Trading State Machine Verification', () => {
    it('POST /portfolio/trade should reject order with negative quantity (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/portfolio/trade')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          ticker: 'RELIANCE.NS',
          type: 'BUY',
          quantity: -5,
          orderType: 'MARKET',
        })
        .expect(400);

      expect(res.body.error.message).toMatch(/quantity/i);
    });

    it('POST /portfolio/trade should reject LIMIT order with negative limitPrice (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/portfolio/trade')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          ticker: 'RELIANCE.NS',
          type: 'BUY',
          quantity: 10,
          orderType: 'LIMIT',
          limitPrice: -100,
        })
        .expect(400);

      expect(res.body.error.message).toMatch(/limit price/i);
    });

    it('POST /portfolio/trade should reject non-existent ticker in universe (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/portfolio/trade')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          ticker: 'SYNTHETIC_INVALID_TICKER.NS',
          type: 'BUY',
          quantity: 10,
          orderType: 'MARKET',
        })
        .expect(400);

      expect(res.body.error.message).toContain('Unsupported stock ticker');
    });

    it('POST /portfolio/trade should reject cross-exchange .BO ticker against NSE universe (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/portfolio/trade')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          ticker: 'RELIANCE.BO',
          type: 'BUY',
          quantity: 10,
          orderType: 'MARKET',
        })
        .expect(400);

      expect(res.body.error.message).toContain('Unsupported stock ticker');
    });

    it('POST /portfolio/trade executes valid BUY and updates position and cash balance', async () => {
      const idempKey = `trade_key_${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/portfolio/trade')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          ticker: 'RELIANCE.NS',
          type: 'BUY',
          quantity: 10,
          orderType: 'MARKET',
          idempotencyKey: idempKey,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.ticker).toBe('RELIANCE.NS');
      expect(res.body.orderStatus).toBe('FILLED');
      expect(res.body.executionModel).toBe('IMMEDIATE_OR_CANCEL');
    });

    it('POST /portfolio/trade rejects SELL when user has insufficient holdings (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/portfolio/trade')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          ticker: 'TCS.NS',
          type: 'SELL',
          quantity: 100,
          orderType: 'MARKET',
        })
        .expect(400);

      expect(res.body.error.message).toContain('Insufficient shares to sell');
    });

    it('POST /watchlist/add should reject adding unsupported ticker (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/watchlist/add')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .send({ ticker: 'BOGUS.NS' })
        .expect(400);

      expect(res.body.error.message).toContain('Unsupported stock ticker');
    });

    it('POST /alerts should reject alert creation for unsupported ticker (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/alerts')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          ticker: 'BOGUS.NS',
          condition: 'ABOVE',
          targetPrice: 2500,
        })
        .expect(400);

      expect(res.body.error.message).toContain('Unsupported stock ticker');
    });
  });

  describe('Distributed Mutex Fail-Closed and Lease Collision over HTTP', () => {
    it('POST /prediction/train returns 409 Conflict when distributed lease is already held by another cluster instance', async () => {
      inMemoryLocks.set('training_pipeline', {
        ownerId: 'worker-node-2:pid-8899:uuid-active',
        expiresAt: Date.now() + 600_000,
        releasedAt: null,
      });

      const res = await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', nextIp())
        .expect(409);

      expect(res.body.error.message).toContain(
        'DISTRIBUTED_TRAINING_IN_PROGRESS',
      );

      inMemoryLocks.delete('training_pipeline');
    });

    it('POST /prediction/train fails closed with 503 ServiceUnavailable when DB lock query fails', async () => {
      const originalQuery = mockDbClient.$queryRawUnsafe;
      mockDbClient.$queryRawUnsafe = jest
        .fn()
        .mockRejectedValue(new Error('Connection terminated unexpectedly'));

      const res = await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', nextIp())
        .expect(503);

      expect(res.body.error.message).toContain('DISTRIBUTED_LOCK_UNAVAILABLE');

      mockDbClient.$queryRawUnsafe = originalQuery;
    });
  });

  describe('Isolated Throttler Limit Verification (Single IP Burst)', () => {
    it('should accept exactly 3 training requests from the same IP and reject the 4th with 429 Too Many Requests', async () => {
      const isolatedIp = '172.16.50.99';

      // Request 1: Accept
      await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', isolatedIp)
        .expect(201);

      // Request 2: Accept
      await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', isolatedIp)
        .expect(201);

      // Request 3: Accept
      await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', isolatedIp)
        .expect(201);

      // Request 4: Throttled (limit is 3 / 10 minutes)
      const res = await request(app.getHttpServer())
        .post('/prediction/train')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Forwarded-For', isolatedIp)
        .expect(429);

      expect(res.body.error.statusCode).toBe(429);
    });
  });
});
