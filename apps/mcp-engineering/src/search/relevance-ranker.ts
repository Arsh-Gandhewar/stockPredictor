/**
 * RelevanceRanker — multi-factor scoring engine for search results.
 *
 * Scores each SearchMatch on a 0.0–1.0 scale using a weighted combination of:
 *  - exactSymbolMatch    (1.00) — symbol name in index exactly matches query
 *  - exactTextMatch      (0.80) — literal text match anywhere in the file
 *  - pathRelevance       (0.30) — file path contains a task keyword
 *  - dependencyRelevance (0.20) — file is in the dependency chain of a primary symbol
 *  - recentChangeBoost   (0.15) — file was modified in the last 10 commits
 *  - auditIssueBoost     (0.25) — file is linked to a known bug matching the task
 *
 * Task-aware: keywords extracted from the task string influence which modules
 * rank higher via the keyword→module mapping.
 *
 * Financial/trading files do NOT rank above engineering files for
 * code-structure tasks (e.g. "refactor", "extract", "interface").
 *
 * All output goes to STDERR — never STDOUT.
 */

import type { AuditFinding } from '../types/index.js';
import type { SearchMatch } from './exact-searcher.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RankingContext {
  /** Repo-relative paths of files known to be in the dependency chain */
  dependencyChainFiles?: string[];
  /** Repo-relative paths of files changed in the last N commits */
  recentlyChangedFiles?: string[];
  /** Audit findings related to the current task */
  relatedAuditFindings?: AuditFinding[];
  /** All symbol names found in the index (for exact-symbol detection) */
  knownSymbolNames?: string[];
}

export interface RankedResult extends SearchMatch {
  /** Final composite score in [0.0, 1.0] */
  finalScore: number;
  /** Breakdown of individual factor contributions */
  scoreBreakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  exactSymbolMatch: number;
  exactTextMatch: number;
  pathRelevance: number;
  dependencyRelevance: number;
  recentChangeBoost: number;
  auditIssueBoost: number;
  baseScore: number;
}

// ---------------------------------------------------------------------------
// Factor weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  exactSymbolMatch: 1.0,
  exactTextMatch: 0.8,
  pathRelevance: 0.3,
  dependencyRelevance: 0.2,
  recentChangeBoost: 0.15,
  auditIssueBoost: 0.25,
} as const;

// ---------------------------------------------------------------------------
// Task keyword → relevant module path fragments
// ---------------------------------------------------------------------------
const KEYWORD_MODULE_MAP: Array<{ pattern: RegExp; modules: string[] }> = [
  {
    pattern: /calibrat/i,
    modules: ['calibration', 'train_model'],
  },
  {
    pattern: /expected.?value|(\bev\b)/i,
    modules: ['signal_to_alpha_engine', 'cross_sectional_ranker'],
  },
  {
    pattern: /portfolio|risk/i,
    modules: ['portfolio', 'cross_sectional_ranker'],
  },
  {
    pattern: /backtest|execution/i,
    modules: ['backtest', 'execution_cost_engine'],
  },
  {
    pattern: /feature/i,
    modules: ['features'],
  },
  {
    pattern: /universe/i,
    modules: ['universe', 'universe_engine'],
  },
  {
    pattern: /distribution/i,
    modules: ['conditional_returns'],
  },
  {
    pattern: /regime/i,
    modules: ['regime_engine'],
  },
];

/** Tasks that are primarily code-structure tasks — financial files don't rank above engineering */
const CODE_STRUCTURE_KEYWORDS = /refactor|extract|interface|abstract|decouple|migrate|rename|type/i;

/** Financial file path fragments */
const FINANCIAL_PATH_PATTERNS = /portfolio|backtest|alpha|signal|regime|universe|payoff/i;

// ---------------------------------------------------------------------------
// RelevanceRanker
// ---------------------------------------------------------------------------

export class RelevanceRanker {
  /**
   * Rank an array of SearchMatch results for a given task and context.
   *
   * @param results  Raw search matches to rank.
   * @param task     Natural-language task description.
   * @param context  Contextual data to enrich scoring.
   * @returns        Results sorted by finalScore descending.
   */
  rank(
    results: SearchMatch[],
    task: string,
    context: RankingContext,
  ): RankedResult[] {
    const taskKeywords = this.extractKeywords(task);
    const relevantModules = this.resolveRelevantModules(task);
    const isCodeStructureTask = CODE_STRUCTURE_KEYWORDS.test(task);

    const ranked: RankedResult[] = results.map((match) => {
      const breakdown = this.scoreMatch(
        match,
        task,
        taskKeywords,
        relevantModules,
        context,
        isCodeStructureTask,
      );

      const finalScore = this.computeFinalScore(breakdown);

      return {
        ...match,
        finalScore,
        scoreBreakdown: breakdown,
      };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);

    process.stderr.write(
      `[relevance-ranker] Ranked ${ranked.length} result(s) for task="${task.slice(0, 60)}"\n`,
    );

    return ranked;
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  private scoreMatch(
    match: SearchMatch,
    task: string,
    taskKeywords: string[],
    relevantModules: string[],
    context: RankingContext,
    isCodeStructureTask: boolean,
  ): ScoreBreakdown {
    const filePath = match.file;

    // ---- exactSymbolMatch ----
    const exactSymbolMatch = this.scoreExactSymbol(match, context.knownSymbolNames ?? []);

    // ---- exactTextMatch ----
    // The base searcher already found a literal match; we re-check if the full
    // task string or a primary keyword appears verbatim in the snippet.
    const exactTextMatch = taskKeywords.some((kw) =>
      match.snippet.toLowerCase().includes(kw.toLowerCase()),
    )
      ? 0.8
      : 0;

    // ---- pathRelevance ----
    const pathRelevance = this.scorePathRelevance(filePath, taskKeywords, relevantModules);

    // ---- dependencyRelevance ----
    const dependencyRelevance =
      context.dependencyChainFiles?.some((dep) => dep === filePath ||
        filePath.includes(dep) || dep.includes(filePath))
        ? WEIGHTS.dependencyRelevance
        : 0;

    // ---- recentChangeBoost ----
    const recentChangeBoost =
      context.recentlyChangedFiles?.some((f) => f === filePath) ? WEIGHTS.recentChangeBoost : 0;

    // ---- auditIssueBoost ----
    const auditIssueBoost = this.scoreAuditBoost(filePath, task, context.relatedAuditFindings ?? []);

    // ---- Financial penalty for code-structure tasks ----
    let financialPenalty = 0;
    if (isCodeStructureTask && FINANCIAL_PATH_PATTERNS.test(filePath)) {
      financialPenalty = 0.1;
    }

    return {
      exactSymbolMatch,
      exactTextMatch,
      pathRelevance,
      dependencyRelevance,
      recentChangeBoost,
      auditIssueBoost: Math.max(0, auditIssueBoost - financialPenalty),
      baseScore: match.relevanceScore,
    };
  }

  private computeFinalScore(breakdown: ScoreBreakdown): number {
    const raw =
      breakdown.baseScore * 0.5 +
      breakdown.exactSymbolMatch * WEIGHTS.exactSymbolMatch +
      breakdown.exactTextMatch * WEIGHTS.exactTextMatch +
      breakdown.pathRelevance * WEIGHTS.pathRelevance +
      breakdown.dependencyRelevance * WEIGHTS.dependencyRelevance +
      breakdown.recentChangeBoost * WEIGHTS.recentChangeBoost +
      breakdown.auditIssueBoost * WEIGHTS.auditIssueBoost;

    // Normalise: max theoretical sum is roughly 3.2; cap at 1.0
    const normalised = raw / 3.2;
    return Math.min(1.0, Math.max(0.0, normalised));
  }

  // ---------------------------------------------------------------------------
  // Individual factor scorers
  // ---------------------------------------------------------------------------

  private scoreExactSymbol(match: SearchMatch, knownSymbolNames: string[]): number {
    for (const sym of knownSymbolNames) {
      // Check if the symbol name appears as a whole word in the matching snippet
      const wordBoundary = new RegExp(`\\b${escapeRegex(sym)}\\b`);
      if (wordBoundary.test(match.snippet)) {
        return WEIGHTS.exactSymbolMatch;
      }
    }
    return 0;
  }

  private scorePathRelevance(
    filePath: string,
    taskKeywords: string[],
    relevantModules: string[],
  ): number {
    const filePathLower = filePath.toLowerCase();

    // Check task keywords against path
    const keywordHit = taskKeywords.some((kw) => filePathLower.includes(kw.toLowerCase()));
    // Check resolved module fragments against path
    const moduleHit = relevantModules.some((mod) => filePathLower.includes(mod.toLowerCase()));

    if (keywordHit || moduleHit) {
      return WEIGHTS.pathRelevance;
    }
    return 0;
  }

  private scoreAuditBoost(
    filePath: string,
    task: string,
    findings: AuditFinding[],
  ): number {
    for (const finding of findings) {
      const fileMatch = finding.affectedFiles.some(
        (af) => filePath.includes(af) || af.includes(filePath),
      );
      const taskMatch =
        task.toLowerCase().includes(finding.bugId.toLowerCase()) ||
        finding.description.toLowerCase().split(' ').some((w) => w.length > 4 && task.toLowerCase().includes(w));

      if (fileMatch && taskMatch) {
        return WEIGHTS.auditIssueBoost;
      }
      if (fileMatch) {
        return WEIGHTS.auditIssueBoost * 0.5;
      }
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Keyword extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract meaningful keywords from a natural-language task string.
   * Strips stop words and returns tokens of length ≥ 4.
   */
  private extractKeywords(task: string): string[] {
    const STOP_WORDS = new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'have',
      'will', 'should', 'must', 'when', 'then', 'make', 'also', 'more',
      'fix', 'add', 'get', 'set', 'use', 'run',
    ]);

    return task
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  }

  /**
   * Resolve task keywords through the KEYWORD_MODULE_MAP to get a list of
   * relevant module path fragments that should rank higher.
   */
  private resolveRelevantModules(task: string): string[] {
    const modules: string[] = [];
    for (const { pattern, modules: mods } of KEYWORD_MODULE_MAP) {
      if (pattern.test(task)) {
        modules.push(...mods);
      }
    }
    return [...new Set(modules)];
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
