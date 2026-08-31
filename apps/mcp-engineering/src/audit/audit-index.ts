/**
 * AuditIndex — hard-coded knowledge base of all known QuantX engineering bugs,
 * economic repairs, and research integrity findings.
 *
 * Provides lookup by bugId, affected file, affected symbol, or keyword search.
 * Persists to .quantx/context/audit-index.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AuditFinding } from '../types/index.js';

// ---------------------------------------------------------------------------
// Hard-coded findings registry
// ---------------------------------------------------------------------------

const BUILT_IN_FINDINGS: AuditFinding[] = [
  {
    bugId: 'BUG-01',
    description: 'Signal-to-alpha failure: conditional return estimates, expected value calculations, and payoff profiles used directional probability as a proxy for expected return, violating economic validity.',
    severity: 'critical',
    affectedFiles: [
      'packages/quant-engine/models/conditional_returns.py',
      'packages/quant-engine/models/signal_to_alpha_engine.py',
      'packages/quant-engine/models/payoff_profile.py',
      'packages/quant-engine/models/return_magnitude_model.py',
    ],
    affectedSymbols: [
      'ConditionalReturnEngine',
      'calculateEV',
      'estimateScenarioReturns',
      'PayoffProfile',
    ],
    status: 'resolved',
    fixCommit: 'bbce90d',
    regressionTests: ['packages/quant-engine/tests/test_bug_1_signal_to_alpha.py'],
  },
  {
    bugId: 'BUG-02',
    description: 'Portfolio construction failure: optimizer, ranker, and constraint solver did not enforce proper position limits, sector concentration, or Kelly-fraction risk sizing. Gross exposure could exceed 100%.',
    severity: 'critical',
    affectedFiles: [
      'packages/quant-engine/portfolio/',
      'packages/quant-engine/models/cross_sectional_ranker.py',
      'packages/quant-engine/backtest/backtest_engine.py',
    ],
    affectedSymbols: [
      'PortfolioUtilityEngine',
      'PortfolioConstraintSolver',
      'rank_cross_sectional_opportunities',
      'run_portfolio_backtest',
    ],
    status: 'resolved',
    fixCommit: 'bbce90d',
    regressionTests: ['packages/quant-engine/tests/test_bug_2_portfolio_construction.py'],
  },
  {
    bugId: 'BUG-03',
    description: 'Execution realism failure: backtest used same-bar fills, symmetric fee model, ignored STT/stamp-duty side asymmetry, lacked square-root market impact, and did not enforce 5% ADV hard cap.',
    severity: 'critical',
    affectedFiles: [
      'packages/quant-engine/backtest/backtest_engine.py',
      'packages/quant-engine/models/execution_cost_engine.py',
      'packages/quant-engine/costs.py',
      'packages/quant-engine/calendar_engine.py',
      'packages/quant-engine/audit/execution_auditor.py',
    ],
    affectedSymbols: [
      'run_portfolio_backtest',
      'calculate_buy_costs',
      'calculate_sell_costs',
      'ExecutionAuditEngine',
      'NSETradingCalendar',
    ],
    status: 'resolved',
    fixCommit: '0a6411e',
    regressionTests: ['packages/quant-engine/tests/test_bug_3_execution_realism.py'],
  },
  {
    bugId: 'BUG-04',
    description: 'Research validity + evidence integrity failure: missing partition guards, leaking future data into historical predictions, insufficient experiment registry fields, no independent metrics reconciliation, no researchEvidenceHash.',
    severity: 'critical',
    affectedFiles: [
      'packages/quant-engine/research/research_partition_guard.py',
      'packages/quant-engine/research/experiment_registry.py',
      'packages/quant-engine/research/research_lineage_engine.py',
      'packages/quant-engine/research/evidence_integrity_engine.py',
      'packages/quant-engine/research/label_causality_guard.py',
      'packages/quant-engine/research/feature_timestamp_auditor.py',
      'packages/quant-engine/audit/independent_metrics_engine.py',
    ],
    affectedSymbols: [
      'ResearchPartitionGuard',
      'ExperimentRegistry',
      'EvidenceIntegrityEngine',
      'IndependentMetricsEngine',
      'LabelCausalityGuard',
      'FeatureTimestampAuditor',
    ],
    status: 'in-progress',
    regressionTests: ['packages/quant-engine/tests/test_bug_4_research_integrity.py'],
  },
  {
    bugId: 'BUG-05',
    description: 'Runtime parity, auth security, and context planner integrity failure: divergence between Python quant engine and TypeScript API/MCP servers, caller-controlled user impersonation in API key trust path, loose JWT claim validation, auto-sell cash clobbering, and single-file context planner limitation.',
    severity: 'critical',
    affectedFiles: [
      'apps/api/src/common/guards/auth.guard.ts',
      'apps/api/src/modules/portfolio/portfolio.service.ts',
      'apps/mcp-server/src/auth/auth-context.ts',
      'apps/mcp-server/src/server.ts',
      'apps/mcp-server/src/security/sanitizer.ts',
      'apps/mcp-engineering/src/search/context-planner.ts',
      'packages/quant-engine/tests/test_bug_5_runtime_parity.py',
    ],
    affectedSymbols: [
      'AuthGuard',
      'AuthService',
      'PortfolioService',
      'ContextPlanner',
      'SecuritySanitizer',
    ],
    status: 'in-progress',
    fixCommit: '2c24b50',
    regressionTests: [
      'packages/quant-engine/tests/test_bug_5_runtime_parity.py',
      'apps/mcp-server/tests/security.test.ts',
    ],
  },
  {
    bugId: 'ECON-02',
    description: 'Economic repair 2: conditional return model did not produce calibrated probability estimates. IsotonicCalibrator applied incorrectly.',
    severity: 'high',
    affectedFiles: ['packages/quant-engine/calibration/calibrate.py'],
    affectedSymbols: ['IsotonicCalibrator', 'evaluate_test_calibration'],
    status: 'resolved',
    fixCommit: 'bbce90d',
    regressionTests: ['packages/quant-engine/tests/test_economic_repair_2.py'],
  },
  {
    bugId: 'ECON-03',
    description: 'Economic repair 3: regime engine incorrectly classified market conditions, allowing signal generation during high-volatility regimes.',
    severity: 'high',
    affectedFiles: ['packages/quant-engine/models/regime_engine.py', 'packages/quant-engine/models/regime_policy.py'],
    affectedSymbols: ['RegimeEngine', 'RegimePolicy', 'compute_market_regimes'],
    status: 'resolved',
    fixCommit: 'bbce90d',
    regressionTests: ['packages/quant-engine/tests/test_economic_repair_3.py'],
  },
  {
    bugId: 'ECON-07',
    description: 'Economic repair 7: walk-forward fold boundaries contaminated. Training data leaked into validation/test partitions. Embargo interval not enforced.',
    severity: 'critical',
    affectedFiles: ['packages/quant-engine/research/run_repair_7_research.py'],
    affectedSymbols: ['ResearchPartitionGuard', 'walk_forward_folds'],
    status: 'resolved',
    fixCommit: 'bbce90d',
    regressionTests: ['packages/quant-engine/tests/test_economic_repair_7.py'],
  },
];

// ---------------------------------------------------------------------------
// AuditIndex
// ---------------------------------------------------------------------------

export class AuditIndex {
  private readonly findings: AuditFinding[];

  constructor(extraFindings: AuditFinding[] = []) {
    this.findings = [...BUILT_IN_FINDINGS, ...extraFindings];
  }

  getByBugId(bugId: string): AuditFinding | undefined {
    return this.findings.find(
      (f) => f.bugId.toUpperCase() === bugId.toUpperCase(),
    );
  }

  getByFile(filePath: string): AuditFinding[] {
    const normalized = filePath.replace(/\\/g, '/');
    return this.findings.filter((f) =>
      f.affectedFiles.some((af) => {
        const afNorm = af.replace(/\\/g, '/');
        return normalized.includes(afNorm) || afNorm.includes(normalized);
      }),
    );
  }

  getBySymbol(symbolName: string): AuditFinding[] {
    const lower = symbolName.toLowerCase();
    return this.findings.filter((f) =>
      f.affectedSymbols.some((s) => s.toLowerCase().includes(lower)),
    );
  }

  search(query: string): AuditFinding[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.findings.filter((f) => {
      const haystack = [
        f.bugId,
        f.description,
        ...f.affectedFiles,
        ...f.affectedSymbols,
      ].join(' ').toLowerCase();
      return terms.some((t) => haystack.includes(t));
    });
  }

  getAll(): AuditFinding[] {
    return this.findings;
  }

  getOpenFindings(): AuditFinding[] {
    return this.findings.filter(
      (f) => f.status === 'open' || f.status === 'in-progress',
    );
  }

  persist(contextDir: string): void {
    try {
      if (!fs.existsSync(contextDir)) {
        fs.mkdirSync(contextDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(contextDir, 'audit-index.json'),
        JSON.stringify({ findings: this.findings }, null, 2),
        'utf8',
      );
    } catch (err) {
      process.stderr.write(`[AuditIndex] Failed to persist: ${String(err)}\n`);
    }
  }
}
