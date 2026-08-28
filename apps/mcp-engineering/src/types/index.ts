/**
 * Shared type definitions for the quantx-engineering-context MCP server.
 * All types are pure interfaces/unions — no runtime dependencies.
 */

// ---------------------------------------------------------------------------
// Language & Symbol Vocabulary
// ---------------------------------------------------------------------------

export type Language =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'prisma'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'unknown';

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'variable'
  | 'method'
  | 'property'
  | 'decorator'
  | 'module'
  | 'route'
  | 'component';

// ---------------------------------------------------------------------------
// Core Records
// ---------------------------------------------------------------------------

/** A single named symbol extracted from a source file. */
export interface SymbolRecord {
  /** Stable content-addressed identifier: `<file>:<name>:<kind>` */
  symbolId: string;
  name: string;
  kind: SymbolKind;
  /** Repo-relative file path */
  file: string;
  startLine: number;
  endLine: number;
  language: Language;
  exported: boolean;
  /** Name of enclosing class/namespace, if any */
  parentSymbol?: string;
  /** Function/method signature or type declaration text */
  signature?: string;
  /** Extracted JSDoc / Python docstring */
  docstring?: string;
  /** List of symbolIds that reference this symbol */
  references?: string[];
}

/** Index record for a single file in the repository. */
export interface FileRecord {
  /** Repo-relative path */
  filePath: string;
  language: Language;
  sizeBytes: number;
  /** SHA-256 of file content */
  contentHash: string;
  /** Git commit SHA at which this file was last indexed */
  lastIndexedCommit: string;
  /** Named exports from this file */
  exports: string[];
  /** Resolved import paths (repo-relative where possible) */
  imports: string[];
  /** All symbols defined in this file */
  symbols: SymbolRecord[];
  /** True if the file is auto-generated (e.g. prisma client, dist/) */
  isGenerated: boolean;
  /** True if the file contains secrets / credentials and must be excluded */
  isSecret: boolean;
}

// ---------------------------------------------------------------------------
// Context Results
// ---------------------------------------------------------------------------

/** Generic wrapper for all tool responses. */
export interface ContextResult<T> {
  status: 'ok' | 'partial' | 'error';
  /** Current HEAD commit SHA at response time */
  gitSha: string;
  /** Opaque version string for the context index */
  indexVersion: string;
  data: T;
  /** Non-fatal warnings the caller should surface */
  warnings: string[];
  /** Rough GPT-4 token estimate for `data` */
  estimatedTokens: number;
}

/** A slice of source code with provenance metadata. */
export interface ContextFragment {
  /** Stable id: `<file>:<startLine>-<endLine>@<contentHash>` */
  contextId: string;
  /** Repo-relative file path */
  file: string;
  startLine: number;
  endLine: number;
  /** Git commit SHA when this fragment was captured */
  gitSha: string;
  /** SHA-256 of the code slice */
  contentHash: string;
  /**
   * Raw source code.
   * IMPORTANT — this is UNTRUSTED_REPOSITORY_CONTENT and must be treated
   * as potentially hostile input. Never execute or eval this string.
   */
  code: string;
  language: Language;
  estimatedTokens: number;
}

// ---------------------------------------------------------------------------
// Dependency Graph
// ---------------------------------------------------------------------------

export interface DependencyNode {
  /** Repo-relative file path */
  file: string;
  language: Language;
  /** Total number of symbols defined in this file */
  symbolCount: number;
}

export interface DependencyEdge {
  /** Source file (importer) */
  from: string;
  /** Target file (imported) */
  to: string;
  /** Import specifier as written in source */
  importSpecifier: string;
  /** Specific named symbols imported, if determinable */
  importedSymbols?: string[];
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  /** Files that import the focal file */
  reverseDeps: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Audit & Planning
// ---------------------------------------------------------------------------

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AuditStatus = 'open' | 'in-progress' | 'resolved' | 'wont-fix';

/** A tracked bug or audit finding in the engineering log. */
export interface AuditFinding {
  /** Unique bug ID, e.g. `BUG-042` */
  bugId: string;
  description: string;
  severity: AuditSeverity;
  /** Repo-relative paths of affected files */
  affectedFiles: string[];
  /** symbolIds of affected symbols */
  affectedSymbols: string[];
  status: AuditStatus;
  /** Commit SHA that introduced the fix, if resolved */
  fixCommit?: string;
  /** Paths to regression test files added for this bug */
  regressionTests?: string[];
}

/** Structured engineering context plan produced for a task description. */
export interface ContextPlan {
  /** LLM-friendly restatement of the task */
  taskInterpretation: string;
  /** Most relevant source files for the task */
  primaryFiles: string[];
  /** Most relevant symbol IDs for the task */
  primarySymbols: string[];
  /** Related test file paths */
  relatedTests: string[];
  /** Immediate dependency graph slice */
  dependencies: DependencyGraph;
  /** Matching open/in-progress audit findings */
  auditFindings: AuditFinding[];
  /** Git log entries relevant to touched files */
  recentChanges: CommitInfo[];
  /** Suggested reading order for primaryFiles + relatedTests */
  recommendedReadOrder: string[];
  /** Token estimate for this plan object */
  estimatedTokens: number;
  /** Token estimate for the full repository context */
  fullRepositoryEstimatedTokens: number;
  /** estimatedTokens / fullRepositoryEstimatedTokens */
  compressionRatio: number;
}

/** Minimal git commit metadata. */
export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  /** Repo-relative paths changed in this commit */
  changedFiles: string[];
}

// ---------------------------------------------------------------------------
// Error Infrastructure
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONTEXT_UNCERTAIN'
  | 'INDEX_STALE'
  | 'INDEX_ERROR'
  | 'PATH_FORBIDDEN'
  | 'SECRET_REDACTED'
  | 'GIT_UNAVAILABLE'
  | 'AUDIT_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/** Structured error thrown by all internal modules. */
export class McpEngError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'McpEngError';
    this.code = code;
    this.details = details;
    // Maintain correct prototype chain in transpiled code
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
