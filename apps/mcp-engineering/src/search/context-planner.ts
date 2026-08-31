/**
 * ContextPlanner — THE core intelligence of the Engineering MCP.
 *
 * Maps a natural-language task description to the minimum sufficient context:
 *   primaryFiles, primarySymbols, relatedTests, dependencies, auditFindings,
 *   recentChanges, recommendedReadOrder, estimatedTokens, compressionRatio.
 *
 * NEVER dumps the entire repository. Targets compressionRatio < 0.05 for
 * single-component tasks.
 *
 * All output goes to STDERR — never STDOUT.
 */

import type { ContextPlan, AuditFinding, CommitInfo, DependencyGraph } from '../types/index.js';
import type { IndexStore } from '../indexer/index-store.js';
import type { AuditIndex } from '../audit/audit-index.js';
import type { GitClient } from '../git/git-client.js';
import { DependencyGraph as DepGraph } from '../graph/dependency-graph.js';

// ---------------------------------------------------------------------------
// Token estimation (rough GPT-4 approximation: ~4 chars per token)
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;
const FULL_REPO_ESTIMATED_TOKENS = 280_000; // empirical for this repo

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Keyword → module mapping
// ---------------------------------------------------------------------------

interface ModuleHint {
  keywords: string[];
  files: string[];
  symbols: string[];
  testFiles: string[];
  bugIds: string[];
}

const MODULE_HINTS: ModuleHint[] = [
  {
    keywords: ['calibrat'],
    files: [
      'packages/quant-engine/calibration/calibrate.py',
      'packages/quant-engine/models/conditional_returns.py',
    ],
    symbols: ['IsotonicCalibrator', 'evaluate_test_calibration', 'ConditionalReturnEngine'],
    testFiles: ['packages/quant-engine/tests/test_economic_repair_2.py'],
    bugIds: ['BUG-04', 'ECON-02'],
  },
  {
    keywords: ['expected value', 'ev calculation', 'ev model', 'calculateev'],
    files: [
      'packages/quant-engine/models/signal_to_alpha_engine.py',
      'packages/quant-engine/models/cross_sectional_ranker.py',
    ],
    symbols: ['calculateEV', 'SignalToAlphaEngine', 'rank_cross_sectional_opportunities'],
    testFiles: [
      'packages/quant-engine/tests/test_bug_1_signal_to_alpha.py',
      'packages/quant-engine/tests/test_bug_2_portfolio_construction.py',
    ],
    bugIds: ['BUG-01', 'BUG-02'],
  },
  {
    keywords: ['runtime parity', 'parity', 'bug 5', 'auth guard', 'impersonation', 'idempotency'],
    files: [
      'apps/api/src/common/guards/auth.guard.ts',
      'apps/api/src/modules/portfolio/portfolio.service.ts',
      'apps/mcp-server/src/auth/auth-context.ts',
      'apps/mcp-server/src/server.ts',
      'apps/mcp-engineering/src/search/context-planner.ts',
      'packages/quant-engine/tests/test_bug_5_runtime_parity.py',
    ],
    symbols: ['AuthGuard', 'AuthService', 'PortfolioService', 'ContextPlanner'],
    testFiles: [
      'packages/quant-engine/tests/test_bug_5_runtime_parity.py',
      'apps/mcp-server/tests/security.test.ts',
    ],
    bugIds: ['BUG-05'],
  },
  {
    keywords: ['portfolio', 'risk', 'optimizer', 'allocation', 'exposure'],
    files: [
      'packages/quant-engine/models/cross_sectional_ranker.py',
      'packages/quant-engine/portfolio/',
    ],
    symbols: ['PortfolioUtilityEngine', 'PortfolioConstraintSolver', 'rank_cross_sectional_opportunities'],
    testFiles: ['packages/quant-engine/tests/test_bug_2_portfolio_construction.py'],
    bugIds: ['BUG-02'],
  },
  {
    keywords: ['backtest', 'execution', 'fill', 'slippage', 'transaction cost', 'fee', 'adv'],
    files: [
      'packages/quant-engine/backtest/backtest_engine.py',
      'packages/quant-engine/models/execution_cost_engine.py',
      'packages/quant-engine/costs.py',
    ],
    symbols: ['run_portfolio_backtest', 'calculate_buy_costs', 'calculate_sell_costs', 'ExecutionAuditEngine'],
    testFiles: ['packages/quant-engine/tests/test_bug_3_execution_realism.py'],
    bugIds: ['BUG-03'],
  },
  {
    keywords: ['feature', 'indicator', 'lookback', 'rolling', 'technical'],
    files: ['packages/quant-engine/features/'],
    symbols: ['calculate_features', 'FEATURE_NAMES'],
    testFiles: ['packages/quant-engine/tests/test_features.py'],
    bugIds: [],
  },
  {
    keywords: ['universe', 'ticker', 'stock selection', 'pit', 'point-in-time'],
    files: [
      'packages/quant-engine/universe.py',
      'packages/quant-engine/models/universe_engine.py',
    ],
    symbols: ['NSE_UNIVERSE', 'UniverseEngine'],
    testFiles: [],
    bugIds: [],
  },
  {
    keywords: ['distribution', 'return distribution', 'tail', 'conditional'],
    files: ['packages/quant-engine/models/conditional_returns.py'],
    symbols: ['ConditionalReturnEngine', 'DistributionParams'],
    testFiles: [],
    bugIds: ['BUG-01'],
  },
  {
    keywords: ['regime', 'market condition', 'bull', 'bear', 'volatility'],
    files: [
      'packages/quant-engine/models/regime_engine.py',
      'packages/quant-engine/models/regime_policy.py',
    ],
    symbols: ['RegimeEngine', 'RegimePolicy', 'compute_market_regimes'],
    testFiles: ['packages/quant-engine/tests/test_economic_repair_3.py'],
    bugIds: ['ECON-03'],
  },
  {
    keywords: ['leakage', 'data leakage', 'lookahead', 'future data', 'partition', 'holdout', 'train test'],
    files: [
      'packages/quant-engine/research/research_partition_guard.py',
      'packages/quant-engine/research/label_causality_guard.py',
      'packages/quant-engine/research/feature_timestamp_auditor.py',
    ],
    symbols: ['ResearchPartitionGuard', 'LabelCausalityGuard', 'FeatureTimestampAuditor'],
    testFiles: [
      'packages/quant-engine/tests/test_bug_4_research_integrity.py',
      'packages/quant-engine/tests/test_leakage.py',
    ],
    bugIds: ['BUG-04', 'ECON-07'],
  },
  {
    keywords: ['stop loss', 'stop', 'exit', 'target', 'gap'],
    files: ['packages/quant-engine/backtest/backtest_engine.py'],
    symbols: ['run_portfolio_backtest'],
    testFiles: ['packages/quant-engine/tests/test_bug_3_execution_realism.py'],
    bugIds: ['BUG-03'],
  },
  {
    keywords: ['pipeline', 'training', 'train model', 'walk forward', 'fold'],
    files: [
      'packages/quant-engine/run_pipeline.py',
      'packages/quant-engine/models/train_model.py',
    ],
    symbols: ['run_full_pipeline', 'train_horizon_model'],
    testFiles: ['packages/quant-engine/tests/test_p0_invariants.py'],
    bugIds: [],
  },
  {
    keywords: ['prediction', 'prediction service', 'api', 'controller', 'endpoint'],
    files: [
      'apps/api/src/',
    ],
    symbols: ['PredictionService', 'PredictionController', 'QuantPredictionService'],
    testFiles: [],
    bugIds: [],
  },
  {
    keywords: ['audit', 'evidence', 'hash', 'lineage', 'integrity'],
    files: [
      'packages/quant-engine/research/evidence_integrity_engine.py',
      'packages/quant-engine/research/research_lineage_engine.py',
      'packages/quant-engine/audit/',
    ],
    symbols: ['EvidenceIntegrityEngine', 'ArtifactLineageRecord', 'IndependentMetricsEngine'],
    testFiles: ['packages/quant-engine/tests/test_bug_4_research_integrity.py'],
    bugIds: ['BUG-04'],
  },
];

// ---------------------------------------------------------------------------
// ContextPlanner
// ---------------------------------------------------------------------------

export class ContextPlanner {
  constructor(
    private readonly store: IndexStore,
    private readonly auditIndex: AuditIndex,
    private readonly git: GitClient,
  ) {}

  async plan(task: string): Promise<ContextPlan> {
    const taskLower = task.toLowerCase();

    // 1. Match keyword hints
    const matchedHints = MODULE_HINTS.filter((hint) =>
      hint.keywords.some((kw) => taskLower.includes(kw)),
    );

    // 2. Collect primary files & symbols from hints
    const primaryFilesSet = new Set<string>();
    const primarySymbolsSet = new Set<string>();
    const relatedTestsSet = new Set<string>();
    const bugIds = new Set<string>();

    for (const hint of matchedHints) {
      for (const f of hint.files) primaryFilesSet.add(f);
      for (const s of hint.symbols) primarySymbolsSet.add(s);
      for (const t of hint.testFiles) relatedTestsSet.add(t);
      for (const b of hint.bugIds) bugIds.add(b);
    }

    // 3. Supplement with symbol index search if few results
    if (primaryFilesSet.size === 0) {
      const terms = task.split(/\s+/).filter((t) => t.length > 3);
      for (const term of terms.slice(0, 3)) {
        const symbols = this.store.findSymbolsByNamePartial(term);
        for (const sym of symbols.slice(0, 5)) {
          primaryFilesSet.add(sym.file);
          primarySymbolsSet.add(sym.symbolId);
        }
      }
    }

    // 4. Audit findings
    const auditFindings: AuditFinding[] = [];
    for (const bugId of bugIds) {
      const finding = this.auditIndex.getByBugId(bugId);
      if (finding) auditFindings.push(finding);
    }
    // Also text-search audit index
    const extraFindings = this.auditIndex.search(task);
    for (const f of extraFindings) {
      if (!auditFindings.some((af) => af.bugId === f.bugId)) {
        auditFindings.push(f);
      }
    }

    // 5. Dependencies (bounded depth 1 across all primary files)
    const allFiles = this.store.getAllFiles();
    const depGraph = new DepGraph(allFiles);
    let dependencies: DependencyGraph = { nodes: [], edges: [], reverseDeps: {} };

    const initialPrimaryFiles = Array.from(primaryFilesSet);
    for (const primaryFile of initialPrimaryFiles) {
      const depResult = depGraph.getDependencies(primaryFile, 1);
      // Merge nodes
      for (const node of depResult.graph.nodes) {
        if (!dependencies.nodes.some((n) => n.file === node.file)) {
          dependencies.nodes.push(node);
        }
      }
      // Merge edges
      for (const edge of depResult.graph.edges) {
        if (!dependencies.edges.some((e) => e.from === edge.from && e.to === edge.to)) {
          dependencies.edges.push(edge);
        }
      }
      // Add dependency files to primary context (bounded to top 3 per primary file)
      for (const node of depResult.graph.nodes.slice(0, 3)) {
        primaryFilesSet.add(node.file);
      }
    }

    // 6. Recent changes for relevant files
    let recentChanges: CommitInfo[] = [];
    try {
      const commits = await this.git.getRecentCommits(10);
      recentChanges = commits.filter((c) => {
        return c.changedFiles.some((cf) => {
          const cfNorm = cf.replace(/\\/g, '/');
          return Array.from(primaryFilesSet).some((pf) =>
            cfNorm.includes(pf) || pf.includes(cfNorm),
          );
        });
      });
    } catch {
      recentChanges = [];
    }

    // 7. Recommended read order
    const recommendedReadOrder = this.buildReadOrder(
      Array.from(primaryFilesSet),
      Array.from(relatedTestsSet),
    );

    // 8. Token estimates & dynamic full repo baseline calculation
    const planText = JSON.stringify({
      primaryFiles: Array.from(primaryFilesSet),
      primarySymbols: Array.from(primarySymbolsSet),
      relatedTests: Array.from(relatedTestsSet),
    });
    const estimatedTokens = estimateTokens(planText) + auditFindings.length * 200;

    let dynamicRepoTokens = 0;
    for (const file of allFiles) {
      dynamicRepoTokens += Math.ceil((file.sizeBytes || 0) / CHARS_PER_TOKEN);
    }
    const fullRepositoryEstimatedTokens = dynamicRepoTokens > 0 ? dynamicRepoTokens : FULL_REPO_ESTIMATED_TOKENS;
    const compressionRatio = estimatedTokens / fullRepositoryEstimatedTokens;

    // 9. Interpretation
    const taskInterpretation = this.interpretTask(task, matchedHints);

    return {
      taskInterpretation,
      primaryFiles: Array.from(primaryFilesSet),
      primarySymbols: Array.from(primarySymbolsSet),
      relatedTests: Array.from(relatedTestsSet),
      dependencies,
      auditFindings,
      recentChanges,
      recommendedReadOrder,
      estimatedTokens,
      fullRepositoryEstimatedTokens: FULL_REPO_ESTIMATED_TOKENS,
      compressionRatio: Math.round(compressionRatio * 10000) / 10000,
    };
  }

  private interpretTask(task: string, hints: ModuleHint[]): string {
    if (hints.length === 0) {
      return `Task: "${task}" — no specific module matched. Suggest starting with quantx_search_code or quantx_find_symbol.`;
    }
    const modules = hints.map((h) => h.keywords[0]).join(', ');
    return `Task relates to: ${modules}. Primary implementation files identified.`;
  }

  private buildReadOrder(primaryFiles: string[], testFiles: string[]): string[] {
    // Order: implementation files → test files
    const impl = primaryFiles.filter((f) => !f.includes('test'));
    const tests = [...testFiles, ...primaryFiles.filter((f) => f.includes('test'))];
    return [...impl, ...tests];
  }
}
