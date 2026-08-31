/**
 * ContextPlanner tests — maps tasks to minimal targeted context with compression ratio.
 */

import { ContextPlanner } from '../src/search/context-planner.js';
import { IndexStore } from '../src/indexer/index-store.js';
import { AuditIndex } from '../src/audit/audit-index.js';
import { GitClient } from '../src/git/git-client.js';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('ContextPlanner', () => {
  const store = new IndexStore();
  const audit = new AuditIndex();
  const git = new GitClient(REPO_ROOT);
  const planner = new ContextPlanner(store, audit, git);

  test('plans targeted context for calibration task', async () => {
    const plan = await planner.plan('Fix calibration leakage in probability model');

    expect(plan.taskInterpretation).toBeDefined();
    expect(plan.primaryFiles).toEqual(
      expect.arrayContaining([expect.stringContaining('calibrate.py')])
    );
    expect(plan.auditFindings.length).toBeGreaterThan(0);
    expect(plan.fullRepositoryEstimatedTokens).toBe(280000);
    expect(plan.estimatedTokens).toBeLessThan(5000);
    expect(plan.compressionRatio).toBeLessThan(0.05);
  });

  test('plans targeted context for portfolio risk task', async () => {
    const plan = await planner.plan('Fix portfolio construction and position limit optimizer');

    expect(plan.primarySymbols).toEqual(
      expect.arrayContaining(['PortfolioUtilityEngine'])
    );
    expect(plan.auditFindings.some((f) => f.bugId === 'BUG-02')).toBe(true);
    expect(plan.compressionRatio).toBeLessThan(0.05);
  });

  test('plans targeted context for execution realism task', async () => {
    const plan = await planner.plan('Improve execution cost model and slippage simulation');

    expect(plan.primaryFiles).toEqual(
      expect.arrayContaining([expect.stringContaining('execution_cost_engine.py')])
    );
    expect(plan.auditFindings.some((f) => f.bugId === 'BUG-03')).toBe(true);
    expect(plan.relatedTests).toContain('packages/quant-engine/tests/test_bug_3_execution_realism.py');
    expect(plan.compressionRatio).toBeLessThan(0.05);
  });

  test('dynamically computes repository token baseline from file records', async () => {
    const storeWithFiles = new IndexStore();
    storeWithFiles.setFile({
      filePath: 'packages/quant-engine/research/alpha.py',
      language: 'python',
      sizeBytes: 16000,
      contentHash: 'mock-hash',
      lastIndexedCommit: 'mock-commit',
      exports: ['AlphaEngine'],
      imports: [],
      isGenerated: false,
      isSecret: false,
      symbols: [{
        symbolId: 'AlphaEngine',
        name: 'AlphaEngine',
        kind: 'class',
        file: 'packages/quant-engine/research/alpha.py',
        language: 'python',
        exported: true,
        startLine: 1,
        endLine: 50,
      }],
    });

    const dynamicPlanner = new ContextPlanner(storeWithFiles, audit, git);
    const plan = await dynamicPlanner.plan('Refactor AlphaEngine');

    expect(plan.fullRepositoryEstimatedTokens).toBe(4000); // 16000 bytes / 4 chars per token
    expect(plan.primarySymbols).toContain('AlphaEngine');
    expect(plan.primaryFiles).toContain('packages/quant-engine/research/alpha.py');
  });
});
