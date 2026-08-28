/**
 * Tool registry — registers and dispatches all 25 MCP tool handlers.
 */

import { z } from 'zod';
import type { EngineeringMcpServer } from '../server.js';
import { DependencyGraph } from '../graph/dependency-graph.js';
import { SymbolReferenceGraph } from '../graph/symbol-reference-graph.js';

// Tool base interface
export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
  execute(args: unknown, server: EngineeringMcpServer): Promise<unknown>;
}

class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDef[] {
    return Array.from(this.tools.values());
  }
}

// ---------------------------------------------------------------------------
// Tool schemas (zod)
// ---------------------------------------------------------------------------

const FilePathInput = z.object({
  filePath: z.string().describe('Repo-relative file path'),
  maxDepth: z.number().int().min(1).max(5).optional().describe('Dependency traversal depth (default 2)'),
  level: z.number().int().min(0).max(7).optional().describe('Context retrieval level (0=metadata, 6=full file)'),
});

const SymbolInput = z.object({
  name: z.string().describe('Symbol name or partial match'),
  file: z.string().optional().describe('Optional file to scope search'),
});

const SearchInput = z.object({
  query: z.string().describe('Search query (text or symbol name)'),
  path: z.string().optional().describe('Restrict to repo-relative path prefix'),
  language: z.string().optional().describe('Filter by language: typescript | python | prisma | json'),
  maxResults: z.number().int().min(1).max(50).optional(),
  caseSensitive: z.boolean().optional(),
});

const TaskInput = z.object({
  task: z.string().describe('Natural-language description of the engineering task'),
});

const CommitInput = z.object({
  sha: z.string().optional().describe('Commit SHA (omit for HEAD)'),
  n: z.number().int().min(1).max(100).optional().describe('Number of commits (default 10)'),
});

const BugInput = z.object({
  bugId: z.string().optional().describe('Bug ID, e.g. BUG-04'),
  query: z.string().optional().describe('Keyword search over audit findings'),
});

const ContextIdInput = z.object({
  contextId: z.string().describe('contextId returned by a previous tool call'),
  expandLevel: z.number().int().min(1).max(4).optional().describe('Expansion level'),
});

// ---------------------------------------------------------------------------
// Tool factory helpers
// ---------------------------------------------------------------------------

function makeFileTool(name: string, description: string): ToolDef {
  return {
    name,
    description,
    schema: FilePathInput,
    async execute(args, server) {
      const { filePath, maxDepth = 2, level = 2 } = FilePathInput.parse(args);
      server.pathGuard.resolve(filePath);

      const fileRecord = server.store.getFile(filePath);
      if (!fileRecord) {
        return {
          status: 'error',
          gitSha: server.currentGitSha,
          indexVersion: server.store.getIndexVersion(),
          data: null,
          warnings: [`File not in index: ${filePath}`],
          estimatedTokens: 0,
        };
      }

      const symbols = fileRecord.symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        startLine: s.startLine,
        endLine: s.endLine,
        exported: s.exported,
        signature: s.signature,
        docstring: s.docstring,
      }));

      const depResult = server.depGraph?.getDependencies(filePath, maxDepth);

      return {
        status: 'ok',
        gitSha: server.currentGitSha,
        indexVersion: server.store.getIndexVersion(),
        data: {
          file: filePath,
          language: fileRecord.language,
          sizeBytes: fileRecord.sizeBytes,
          contentHash: fileRecord.contentHash,
          symbolCount: symbols.length,
          symbols: level >= 1 ? symbols : undefined,
          exports: fileRecord.exports,
          imports: fileRecord.imports.slice(0, 20),
          dependencies: depResult?.graph ?? null,
          auditFindings: server.auditIndex.getByFile(filePath),
          retrievalLevel: level,
        },
        warnings: [],
        estimatedTokens: symbols.length * 80 + 200,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Create and register all 25 tools
// ---------------------------------------------------------------------------

export function createToolRegistry(_server?: EngineeringMcpServer): ToolRegistry {
  const registry = new ToolRegistry();

  // ── 1. quantx_context_plan ─────────────────────────────────────────────────
  registry.register({
    name: 'quantx_context_plan',
    description: 'START HERE for any non-trivial task. Maps a task description to the minimum necessary context: files, symbols, tests, dependencies, audit findings. Returns compressionRatio so you know how targeted the context is.',
    schema: TaskInput,
    async execute(args, server) {
      const { task } = TaskInput.parse(args);
      const plan = await server.planner.plan(task);
      return {
        status: 'ok',
        gitSha: server.currentGitSha,
        indexVersion: server.store.getIndexVersion(),
        data: plan,
        warnings: plan.primaryFiles.length === 0 ? ['No matching module found — try quantx_search_code'] : [],
        estimatedTokens: plan.estimatedTokens,
      };
    },
  });

  // ── 2. quantx_search_code ─────────────────────────────────────────────────
  registry.register({
    name: 'quantx_search_code',
    description: 'Ranked code search across the repository. Returns file, line, snippet, and relevance score. Max 50 results.',
    schema: SearchInput,
    async execute(args, server) {
      const input = SearchInput.parse(args);
      const matches = await server.searcher.search(input.query, {
        path: input.path,
        language: input.language as never,
        maxResults: input.maxResults ?? 20,
        caseSensitive: input.caseSensitive ?? false,
      });
      return {
        status: 'ok',
        gitSha: server.currentGitSha,
        indexVersion: server.store.getIndexVersion(),
        data: { matches, totalFound: matches.length },
        warnings: [],
        estimatedTokens: matches.length * 60,
      };
    },
  });

  // ── 3. quantx_find_symbol ─────────────────────────────────────────────────
  registry.register({
    name: 'quantx_find_symbol',
    description: 'Look up a symbol by name (exact or partial). Returns all matching symbols with their definition location, kind, signature, and docstring.',
    schema: SymbolInput,
    async execute(args, server) {
      const { name, file } = SymbolInput.parse(args);
      let symbols = server.store.findSymbolsByNamePartial(name);
      if (file) symbols = symbols.filter((s) => s.file.includes(file));
      return {
        status: 'ok',
        gitSha: server.currentGitSha,
        indexVersion: server.store.getIndexVersion(),
        data: { symbols: symbols.slice(0, 20), totalFound: symbols.length },
        warnings: symbols.length === 0 ? [`No symbols matching "${name}" found`] : [],
        estimatedTokens: symbols.length * 100,
      };
    },
  });

  // ── 4. quantx_get_file_context ────────────────────────────────────────────
  registry.register(makeFileTool(
    'quantx_get_file_context',
    'Get targeted file context: symbols, imports, exports, dependencies, audit findings. Use level param to control detail (0=metadata, 2=symbols, 6=full file).',
  ));

  // ── 5. quantx_get_symbol_context ─────────────────────────────────────────
  registry.register({
    name: 'quantx_get_symbol_context',
    description: 'Get full context for a symbol: definition, callers, callees, related tests, audit findings.',
    schema: SymbolInput,
    async execute(args, server) {
      const { name, file } = SymbolInput.parse(args);
      let symbols = server.store.findSymbolsByNamePartial(name);
      if (file) symbols = symbols.filter((s) => s.file.includes(file));
      const sym = symbols[0];
      if (!sym) {
        return { status: 'error', data: null, warnings: [`Symbol "${name}" not found`], gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), estimatedTokens: 0 };
      }
      const callers = server.symRefGraph?.getCallers(sym.name) ?? [];
      const callees = server.symRefGraph?.getCallees(sym.name) ?? [];
      const auditFindings = server.auditIndex.getBySymbol(sym.name);
      return {
        status: 'ok',
        gitSha: server.currentGitSha,
        indexVersion: server.store.getIndexVersion(),
        data: { symbol: sym, callers: callers.slice(0, 10), callees: callees.slice(0, 10), auditFindings },
        warnings: [],
        estimatedTokens: 300,
      };
    },
  });

  // ── 6. quantx_find_callers ────────────────────────────────────────────────
  registry.register({
    name: 'quantx_find_callers',
    description: 'Find all symbols that call or import a given symbol.',
    schema: SymbolInput,
    async execute(args, server) {
      const { name } = SymbolInput.parse(args);
      const callers = server.symRefGraph?.getCallers(name) ?? [];
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { callers }, warnings: [], estimatedTokens: callers.length * 60 };
    },
  });

  // ── 7. quantx_find_callees ────────────────────────────────────────────────
  registry.register({
    name: 'quantx_find_callees',
    description: 'Find all symbols called or imported by a given symbol.',
    schema: SymbolInput,
    async execute(args, server) {
      const { name } = SymbolInput.parse(args);
      const callees = server.symRefGraph?.getCallees(name) ?? [];
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { callees }, warnings: [], estimatedTokens: callees.length * 60 };
    },
  });

  // ── 8. quantx_get_dependencies ────────────────────────────────────────────
  registry.register({
    name: 'quantx_get_dependencies',
    description: 'Get the import/export dependency graph for a file (bounded depth). Shows what this file imports and what imports it.',
    schema: FilePathInput,
    async execute(args, server) {
      const { filePath, maxDepth = 2 } = FilePathInput.parse(args);
      server.pathGuard.resolve(filePath);
      const result = server.depGraph?.getFullGraph(filePath, maxDepth) ?? null;
      return {
        status: 'ok',
        gitSha: server.currentGitSha,
        indexVersion: server.store.getIndexVersion(),
        data: result,
        warnings: !result ? ['Dependency graph not yet built'] : [],
        estimatedTokens: (result?.graph.nodes.length ?? 0) * 50,
      };
    },
  });

  // ── 9. quantx_trace_flow ─────────────────────────────────────────────────
  registry.register({
    name: 'quantx_trace_flow',
    description: 'Trace the execution flow from an entry point symbol, following dependency chains.',
    schema: z.object({ entryPoint: z.string(), maxDepth: z.number().int().min(1).max(4).optional() }),
    async execute(args, server) {
      const { entryPoint, maxDepth = 2 } = z.object({ entryPoint: z.string(), maxDepth: z.number().int().min(1).max(4).optional() }).parse(args);
      const symbols = server.store.findSymbolsByNamePartial(entryPoint);
      const sym = symbols[0];
      if (!sym) return { status: 'error', data: null, warnings: [`Symbol "${entryPoint}" not found`], gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), estimatedTokens: 0 };
      const deps = server.depGraph?.getDependencies(sym.file, maxDepth);
      const callees = server.symRefGraph?.getCallees(sym.name) ?? [];
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { entrySymbol: sym, callChain: callees.slice(0, 10), fileDependencies: deps?.graph ?? null }, warnings: [], estimatedTokens: 400 };
    },
  });

  // ── 10. quantx_get_module_context ─────────────────────────────────────────
  registry.register({
    name: 'quantx_get_module_context',
    description: 'Get a summary of a module/directory: files, exported symbols, purpose.',
    schema: z.object({ modulePath: z.string().describe('Repo-relative module path or directory') }),
    async execute(args, server) {
      const { modulePath } = z.object({ modulePath: z.string() }).parse(args);
      const allFiles = server.store.getAllFiles().filter((f) => f.filePath.startsWith(modulePath));
      const allSymbols = allFiles.flatMap((f) => f.symbols.filter((s) => s.exported));
      return {
        status: 'ok',
        gitSha: server.currentGitSha,
        indexVersion: server.store.getIndexVersion(),
        data: { modulePath, fileCount: allFiles.length, files: allFiles.map((f) => f.filePath), exportedSymbols: allSymbols.slice(0, 30).map((s) => ({ name: s.name, kind: s.kind, file: s.file })) },
        warnings: allFiles.length === 0 ? [`No indexed files found under "${modulePath}"`] : [],
        estimatedTokens: allFiles.length * 40 + allSymbols.length * 30,
      };
    },
  });

  // ── 11. quantx_get_architecture ───────────────────────────────────────────
  registry.register({
    name: 'quantx_get_architecture',
    description: 'Get the high-level repository architecture map: packages, apps, key modules, file counts.',
    schema: z.object({}),
    async execute(_args, server) {
      const allFiles = server.store.getAllFiles();
      const moduleMap = new Map<string, number>();
      for (const f of allFiles) {
        const parts = f.filePath.split('/');
        const module = parts.slice(0, 2).join('/');
        moduleMap.set(module, (moduleMap.get(module) ?? 0) + 1);
      }
      const stats = server.store.getStats();
      return {
        status: 'ok',
        gitSha: server.currentGitSha,
        indexVersion: server.store.getIndexVersion(),
        data: {
          totalFiles: stats.files,
          totalSymbols: stats.symbols,
          modules: Object.fromEntries(moduleMap),
          knownBugs: server.auditIndex.getOpenFindings().map((f) => ({ bugId: f.bugId, status: f.status, severity: f.severity })),
        },
        warnings: [],
        estimatedTokens: 500,
      };
    },
  });

  // ── 12. quantx_find_tests ─────────────────────────────────────────────────
  registry.register({
    name: 'quantx_find_tests',
    description: 'Find test files that cover a given symbol or file.',
    schema: SymbolInput,
    async execute(args, server) {
      const { name, file } = SymbolInput.parse(args);
      const allFiles = server.store.getAllFiles();
      const testFiles = allFiles.filter((f) => f.filePath.includes('test'));
      const matching = testFiles.filter((tf) => {
        const hasSymbol = tf.symbols.some((s) => s.name.toLowerCase().includes(name.toLowerCase()));
        const importsFile = file ? tf.imports.some((i) => i.includes(file)) : false;
        return hasSymbol || importsFile;
      });
      return {
        status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(),
        data: { tests: matching.map((f) => ({ file: f.filePath, symbolCount: f.symbols.length })) },
        warnings: [], estimatedTokens: matching.length * 50,
      };
    },
  });

  // ── 13. quantx_get_test_context ───────────────────────────────────────────
  registry.register({
    name: 'quantx_get_test_context',
    description: 'Get the test symbols (test classes and functions) from a test file.',
    schema: z.object({ filePath: z.string() }),
    async execute(args, server) {
      const { filePath } = z.object({ filePath: z.string() }).parse(args);
      server.pathGuard.resolve(filePath);
      const record = server.store.getFile(filePath);
      if (!record) return { status: 'error', data: null, warnings: [`File not found: ${filePath}`], gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), estimatedTokens: 0 };
      const testSymbols = record.symbols.filter((s) => s.name.toLowerCase().startsWith('test'));
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { file: filePath, testSymbols }, warnings: [], estimatedTokens: testSymbols.length * 80 };
    },
  });

  // ── 14. quantx_get_recent_changes ─────────────────────────────────────────
  registry.register({
    name: 'quantx_get_recent_changes',
    description: 'Get recent git commits with changed files.',
    schema: CommitInput,
    async execute(args, server) {
      const { n = 10 } = CommitInput.parse(args);
      const commits = await server.git.getRecentCommits(n);
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { commits }, warnings: [], estimatedTokens: commits.length * 100 };
    },
  });

  // ── 15. quantx_get_commit_context ─────────────────────────────────────────
  registry.register({
    name: 'quantx_get_commit_context',
    description: 'Get the changed files and diff summary for a specific commit SHA.',
    schema: z.object({ sha: z.string() }),
    async execute(args, server) {
      const { sha } = z.object({ sha: z.string() }).parse(args);
      const diff = await server.git.getCommitDiff(sha);
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { sha, diff }, warnings: [], estimatedTokens: Math.ceil(diff.length / 4) };
    },
  });

  // ── 16. quantx_get_diff_context ───────────────────────────────────────────
  registry.register({
    name: 'quantx_get_diff_context',
    description: 'Get a diff between two commits or branches.',
    schema: z.object({ base: z.string(), target: z.string().optional() }),
    async execute(args, server) {
      const { base, target = 'HEAD' } = z.object({ base: z.string(), target: z.string().optional() }).parse(args);
      const diff = await server.git.getDiff(base, target);
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { base, target, diff: diff.slice(0, 4000) }, warnings: diff.length > 4000 ? ['Diff truncated to 4000 chars'] : [], estimatedTokens: 1000 };
    },
  });

  // ── 17. quantx_get_audit_context ──────────────────────────────────────────
  registry.register({
    name: 'quantx_get_audit_context',
    description: 'Get engineering audit findings for a bug ID or keyword query.',
    schema: BugInput,
    async execute(args, server) {
      const { bugId, query } = BugInput.parse(args);
      let findings: import('../types/index.js').AuditFinding[] = bugId ? [server.auditIndex.getByBugId(bugId)].filter((f): f is import('../types/index.js').AuditFinding => f !== undefined) : [];
      if (query) findings = [...findings, ...server.auditIndex.search(query)];
      if (!bugId && !query) findings = server.auditIndex.getAll();
      // Deduplicate
      const seen = new Set<string>();
      const unique = findings.filter((f) => { if (seen.has(f.bugId)) return false; seen.add(f.bugId); return true; });
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { findings: unique }, warnings: [], estimatedTokens: unique.length * 200 };
    },
  });

  // ── 18. quantx_trace_bug ─────────────────────────────────────────────────
  registry.register({
    name: 'quantx_trace_bug',
    description: 'For a bug ID, return: affected files, affected symbols, callers of those symbols, regression tests, and fix commit context.',
    schema: z.object({ bugId: z.string() }),
    async execute(args, server) {
      const { bugId } = z.object({ bugId: z.string() }).parse(args);
      const finding = server.auditIndex.getByBugId(bugId);
      if (!finding) return { status: 'error', data: null, warnings: [`Bug "${bugId}" not found`], gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), estimatedTokens: 0 };
      const callerMap: Record<string, unknown[]> = {};
      for (const sym of finding.affectedSymbols) {
        callerMap[sym] = server.symRefGraph?.getCallers(sym) ?? [];
      }
      return {
        status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(),
        data: { finding, callers: callerMap, regressionTests: finding.regressionTests ?? [] },
        warnings: [], estimatedTokens: 400,
      };
    },
  });

  // ── 19. quantx_impact_analysis ────────────────────────────────────────────
  registry.register({
    name: 'quantx_impact_analysis',
    description: 'Before editing a file or symbol, get the blast radius: all files that depend on it, callers, related tests.',
    schema: z.object({ target: z.string().describe('File path or symbol name') }),
    async execute(args, server) {
      const { target } = z.object({ target: z.string() }).parse(args);
      // Try as file first, then symbol
      const fileRecord = server.store.getFile(target);
      const symbols = server.store.findSymbolsByNamePartial(target);
      const dependents = server.depGraph?.getDependents(target, 2)?.graph ?? null;
      const callers = symbols[0] ? server.symRefGraph?.getCallers(symbols[0].name) ?? [] : [];
      const testFiles = server.store.getAllFiles().filter((f) => f.filePath.includes('test') && f.imports.some((i) => i.includes(target)));
      return {
        status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(),
        data: {
          target,
          isKnownFile: !!fileRecord,
          symbolsFound: symbols.length,
          dependentFiles: dependents?.nodes.map((n) => n.file) ?? [],
          callers: callers.slice(0, 10),
          relatedTests: testFiles.map((f) => f.filePath),
          auditFindings: fileRecord ? server.auditIndex.getByFile(target) : [],
        },
        warnings: [], estimatedTokens: 300,
      };
    },
  });

  // ── 20. quantx_expand_context ─────────────────────────────────────────────
  registry.register({
    name: 'quantx_expand_context',
    description: 'Progressively expand context from a file or symbol, moving outward by one dependency hop.',
    schema: ContextIdInput,
    async execute(args, server) {
      const { contextId, expandLevel = 1 } = ContextIdInput.parse(args);
      // contextId format: file:startLine-endLine@hash OR file:name:kind
      const [file] = contextId.split(':');
      if (!file) return { status: 'error', data: null, warnings: ['Invalid contextId'], gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), estimatedTokens: 0 };
      const deps = server.depGraph?.getFullGraph(file, expandLevel);
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { expandedFrom: contextId, expansionLevel: expandLevel, graph: deps?.graph ?? null }, warnings: [], estimatedTokens: 400 };
    },
  });

  // ── 21. quantx_get_model_lineage ─────────────────────────────────────────
  registry.register({
    name: 'quantx_get_model_lineage',
    description: 'Get the lineage chain for a predictive model: dataset → features → training → calibration → export.',
    schema: z.object({}),
    async execute(_args, server) {
      const lineageFiles = [
        'packages/quant-engine/data/',
        'packages/quant-engine/features/',
        'packages/quant-engine/models/',
        'packages/quant-engine/calibration/',
        'packages/quant-engine/export/',
        'packages/quant-engine/research/research_lineage_engine.py',
      ];
      const records = lineageFiles.map((path) => {
        const files = server.store.getAllFiles().filter((f) => f.filePath.startsWith(path));
        return { stage: path, fileCount: files.length, files: files.map((f) => f.filePath) };
      });
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { lineageStages: records }, warnings: [], estimatedTokens: 300 };
    },
  });

  // ── 22. quantx_get_strategy_lineage ──────────────────────────────────────
  registry.register({
    name: 'quantx_get_strategy_lineage',
    description: 'Get the lineage chain for the trading strategy: signal → EV → ranking → portfolio → execution.',
    schema: z.object({}),
    async execute(_args, server) {
      const stages = [
        { stage: 'signal', path: 'models/signal_to_alpha_engine.py' },
        { stage: 'ev_calculation', path: 'models/conditional_returns.py' },
        { stage: 'cross_sectional_ranking', path: 'models/cross_sectional_ranker.py' },
        { stage: 'portfolio_construction', path: 'portfolio/' },
        { stage: 'execution', path: 'backtest/backtest_engine.py' },
        { stage: 'execution_costs', path: 'models/execution_cost_engine.py' },
      ];
      const result = stages.map((s) => {
        const files = server.store.getAllFiles().filter((f) => f.filePath.includes(s.path));
        return { ...s, fileCount: files.length, symbols: files.flatMap((f) => f.symbols.filter((sym) => sym.exported).map((sym) => sym.name)).slice(0, 5) };
      });
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { strategyStages: result }, warnings: [], estimatedTokens: 400 };
    },
  });

  // ── 23. quantx_get_artifact_lineage ───────────────────────────────────────
  registry.register({
    name: 'quantx_get_artifact_lineage',
    description: 'Get lineage of research artifacts: hash engines, experiment registry, evidence integrity.',
    schema: z.object({}),
    async execute(_args, server) {
      const artifacts = server.store.getAllFiles().filter((f) => f.filePath.includes('research_lineage_engine') || f.filePath.includes('evidence_integrity') || f.filePath.includes('experiment_registry'));
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: { artifactFiles: artifacts.map((f) => ({ file: f.filePath, contentHash: f.contentHash, symbols: f.exports })) }, warnings: [], estimatedTokens: 200 };
    },
  });

  // ── 24. quantx_health ────────────────────────────────────────────────────
  registry.register({
    name: 'quantx_health',
    description: 'Server health check: index status, git SHA, file/symbol counts.',
    schema: z.object({}),
    async execute(_args, server) {
      const stats = server.store.getStats();
      return {
        status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(),
        data: {
          serverName: server.config.serverName,
          serverVersion: server.config.serverVersion,
          repoRoot: server.config.repoRoot,
          indexedFiles: stats.files,
          indexedSymbols: stats.symbols,
          uniqueSymbolNames: stats.uniqueNames,
          lastIndexedCommit: server.store.getLastIndexedCommit(),
          openAuditFindings: server.auditIndex.getOpenFindings().length,
          uptime: process.uptime(),
        },
        warnings: [], estimatedTokens: 100,
      };
    },
  });

  // ── 25. quantx_start_full_audit ───────────────────────────────────────────
  registry.register({
    name: 'quantx_start_full_audit',
    description: 'Exception-only: trigger a full repository re-index and return architecture summary. Use only when the index is stale or corrupted.',
    schema: z.object({ confirm: z.boolean().describe('Must be true to trigger full audit') }),
    async execute(args, server) {
      const { confirm } = z.object({ confirm: z.boolean() }).parse(args);
      if (!confirm) return { status: 'error', data: null, warnings: ['Set confirm=true to trigger full audit'], gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), estimatedTokens: 0 };
      const result = await server.indexer.refresh(server.config.repoRoot, server.config.contextIndexDir);
      server.currentGitSha = result.gitSha;
      const allFiles = server.store.getAllFiles();
      server.depGraph = new DependencyGraph(allFiles);
      server.symRefGraph = new SymbolReferenceGraph(allFiles);
      return { status: 'ok', gitSha: server.currentGitSha, indexVersion: server.store.getIndexVersion(), data: result, warnings: [], estimatedTokens: 200 };
    },
  });

  return registry;
}
