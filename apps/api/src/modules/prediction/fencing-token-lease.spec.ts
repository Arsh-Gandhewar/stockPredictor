import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { DistributedLockService } from './engines/distributed-lock.service';
import { QuantPredictionService } from './prediction.service';
import { DatabaseService } from '../../database/database.service';
import { YahooMarketDataProvider } from '../stock/providers/yahoo-market-data.provider';
import { NewsService } from '../news/news.service';

describe('P0 Invariant: Fencing Token Lease & Training Preemption Spec', () => {
  let lockService: DistributedLockService;
  let predictionService: QuantPredictionService;
  let mockDb: any;

  // In-memory representation of distributed_locks table
  let locksTable: Map<
    string,
    {
      lock_key: string;
      owner_id: string;
      acquired_at: Date;
      lease_expires_at: Date;
      fencing_token: number;
      released_at: Date | null;
    }
  >;

  beforeEach(async () => {
    locksTable = new Map();

    mockDb = {
      client: {
        $queryRawUnsafe: jest.fn(async (sql: string, ...params: any[]) => {
          if (sql.includes('SELECT lock_key FROM distributed_locks LIMIT 0')) {
            return [];
          }

          if (sql.includes('INSERT INTO distributed_locks')) {
            const [lockKey, ownerId, acquiredAtStr, expiresAtStr] = params;
            const existing = locksTable.get(lockKey);
            const now = new Date();

            if (
              !existing ||
              existing.released_at !== null ||
              existing.lease_expires_at < now
            ) {
              const fencingToken = existing ? existing.fencing_token + 1 : 1;
              const newEntry = {
                lock_key: lockKey,
                owner_id: ownerId,
                acquired_at: new Date(acquiredAtStr),
                lease_expires_at: new Date(expiresAtStr),
                fencing_token: fencingToken,
                released_at: null,
              };
              locksTable.set(lockKey, newEntry);
              return [
                {
                  lock_key: lockKey,
                  owner_id: ownerId,
                  fencing_token: fencingToken,
                },
              ];
            }
            return [];
          }

          if (sql.includes('UPDATE distributed_locks')) {
            if (sql.includes('released_at = NOW()')) {
              const [lockKey, ownerId, fencingToken] = params;
              const existing = locksTable.get(lockKey);
              if (
                existing &&
                existing.owner_id === ownerId &&
                existing.released_at === null &&
                (fencingToken === null ||
                  existing.fencing_token === Number(fencingToken))
              ) {
                existing.released_at = new Date();
                return [{ lock_key: lockKey }];
              }
              return [];
            }
          }

          if (
            sql.includes('FROM distributed_locks') &&
            sql.includes('fencing_token =')
          ) {
            const [lockKey, ownerId, fencingToken] = params;
            const existing = locksTable.get(lockKey);
            const now = new Date();
            if (
              existing &&
              existing.owner_id === ownerId &&
              existing.fencing_token === Number(fencingToken) &&
              existing.released_at === null &&
              existing.lease_expires_at >= now
            ) {
              return [
                {
                  lock_key: lockKey,
                  owner_id: ownerId,
                  fencing_token: fencingToken,
                },
              ];
            }
            return [];
          }

          return [];
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DistributedLockService,
        {
          provide: QuantPredictionService,
          useFactory: (db: DatabaseService, lock: DistributedLockService) => {
            return new (QuantPredictionService as any)(
              db,
              {} as any,
              {} as any,
              lock,
            );
          },
          inject: [DatabaseService, DistributedLockService],
        },
        { provide: DatabaseService, useValue: mockDb },
        { provide: YahooMarketDataProvider, useValue: {} },
        { provide: NewsService, useValue: {} },
      ],
    }).compile();

    lockService = module.get<DistributedLockService>(DistributedLockService);
    predictionService = module.get<QuantPredictionService>(
      QuantPredictionService,
    );
    (predictionService as any).distributedLockService = lockService;
  });

  it('1. Worker A acquires initial lease lock with fencingToken = 1', async () => {
    const resA = await lockService.acquireLock(
      'quantx:training',
      60_000,
      'worker_A',
    );
    expect(resA.acquired).toBe(true);
    expect(resA.ownerId).toBe('worker_A');
    expect(resA.fencingToken).toBe(1);

    const isValidA = await lockService.validateFencingToken(
      'quantx:training',
      'worker_A',
      1,
    );
    expect(isValidA).toBe(true);
  });

  it('2. Worker B is rejected while Worker A lease is active', async () => {
    await lockService.acquireLock('quantx:training', 60_000, 'worker_A');
    const resB = await lockService.acquireLock(
      'quantx:training',
      60_000,
      'worker_B',
    );
    expect(resB.acquired).toBe(false);
  });

  it('3. Preemption: Worker B acquires lock after lease expiry with monotonic fencingToken = 2', async () => {
    await lockService.acquireLock('quantx:training', 1000, 'worker_A');
    // Fast-forward: expire Worker A's lease
    const entry = locksTable.get('quantx:training')!;
    entry.lease_expires_at = new Date(Date.now() - 5000);

    // Worker B acquires preempting lease
    const resB = await lockService.acquireLock(
      'quantx:training',
      60_000,
      'worker_B',
    );
    expect(resB.acquired).toBe(true);
    expect(resB.ownerId).toBe('worker_B');
    expect(resB.fencingToken).toBe(2);

    // Worker A's fencing token 1 is now strictly INVALID
    const isAValid = await lockService.validateFencingToken(
      'quantx:training',
      'worker_A',
      1,
    );
    expect(isAValid).toBe(false);

    // Worker B's fencing token 2 is active
    const isBValid = await lockService.validateFencingToken(
      'quantx:training',
      'worker_B',
      2,
    );
    expect(isBValid).toBe(true);
  });

  it('4. Stale Worker A attempting commit with superseded fencing token is aborted with ConflictException', async () => {
    // Mock internal backtest engine
    (predictionService as any).backtestEngine = {
      runFullBacktest: jest.fn().mockResolvedValue({
        summary: { totalTrades: 10, totalPnl: 1000 },
        trades: [],
      }),
    };
    (predictionService as any).refreshArtifactGovernance = jest.fn();
    (predictionService as any).onnxEngine = {
      loadActiveModels: jest.fn().mockResolvedValue({}),
    };

    // Simulate preemption: lock is now held by Worker B with token 2
    locksTable.set('training_pipeline', {
      lock_key: 'training_pipeline',
      owner_id: 'worker_B',
      acquired_at: new Date(),
      lease_expires_at: new Date(Date.now() + 60_000),
      fencing_token: 2,
      released_at: null,
    });

    // Worker A attempts to run trainPipeline with stale fencing token 1
    await expect(
      predictionService.trainPipeline({ ownerId: 'worker_A', fencingToken: 1 }),
    ).rejects.toThrow(ConflictException);

    await expect(
      predictionService.trainPipeline({ ownerId: 'worker_A', fencingToken: 1 }),
    ).rejects.toThrow(/FENCING_TOKEN_SUPERSEDED/);
  });

  it('5. Stale Worker A cannot release lock held by Worker B with newer fencing token', async () => {
    // Lock held by Worker B with token 2
    locksTable.set('quantx:training', {
      lock_key: 'quantx:training',
      owner_id: 'worker_B',
      acquired_at: new Date(),
      lease_expires_at: new Date(Date.now() + 60_000),
      fencing_token: 2,
      released_at: null,
    });

    // Worker A tries to release with stale token 1
    const releasedA = await lockService.releaseLock(
      'quantx:training',
      'worker_A',
      1,
    );
    expect(releasedA).toBe(false);

    // Lock must remain active for Worker B
    const isBValid = await lockService.validateFencingToken(
      'quantx:training',
      'worker_B',
      2,
    );
    expect(isBValid).toBe(true);
  });
});
