/**
 * Configuration loader for quantx-engineering-context MCP server.
 *
 * Reads environment variables and auto-detects the repository root when
 * QUANTX_REPO_ROOT is not explicitly set.
 *
 * ALL logging goes to STDERR — never to STDOUT (which is protocol-only).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EngConfig {
  /** Absolute path to the repository root (contains the root package.json). */
  repoRoot: string;
  /**
   * Repo-relative path to the context index directory.
   * Default: `.quantx/context`
   */
  contextIndex: string;
  /** Absolute path to the context index directory. */
  contextIndexDir: string;
  /** MCP server display name. */
  serverName: string;
  /** MCP server version string. */
  serverVersion: string;
  /** Log level for STDERR output. */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// ---------------------------------------------------------------------------
// Auto-detection helpers
// ---------------------------------------------------------------------------

/**
 * Walk up the directory tree from `startDir` until we find a `package.json`
 * whose `"name"` field is `"stock-predictor"`.
 *
 * Returns the directory containing that package.json, or `null` if not found.
 */
function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf8');
        const pkg = JSON.parse(raw) as { name?: string };
        if (pkg.name === 'stock-predictor') {
          return dir;
        }
      } catch {
        // malformed package.json — keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Resolve the `__dirname` equivalent for this module regardless of whether
 * it is loaded as ESM (`import.meta.url`) or CJS (`__dirname`).
 *
 * We use a runtime check so the code compiles cleanly for both module
 * systems under TypeScript `NodeNext`.
 */
function resolveThisDir(): string {
  // ESM: `import.meta` is defined
  if (typeof __filename !== 'undefined') {
    // CJS path
    return path.dirname(__filename);
  }
  // Fallback: walk from cwd
  return process.cwd();
}

// ---------------------------------------------------------------------------
// Log-level validation
// ---------------------------------------------------------------------------

const VALID_LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error']);

function parseLogLevel(raw: string | undefined): EngConfig['logLevel'] {
  const level = (raw ?? 'info').toLowerCase();
  if (VALID_LOG_LEVELS.has(level)) {
    return level as EngConfig['logLevel'];
  }
  process.stderr.write(
    `[quantx-engineering-context] Unknown MCP_LOG_LEVEL "${raw}", defaulting to "info"\n`,
  );
  return 'info';
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Load and validate server configuration from environment variables.
 * Throws if a required value cannot be determined.
 */
export function loadConfig(): EngConfig {
  // ---- QUANTX_REPO_ROOT ----
  let repoRoot: string;
  if (process.env['QUANTX_REPO_ROOT']) {
    repoRoot = path.resolve(process.env['QUANTX_REPO_ROOT']);
    if (!fs.existsSync(repoRoot)) {
      throw new Error(
        `[quantx-engineering-context] QUANTX_REPO_ROOT does not exist on disk: ${repoRoot}`,
      );
    }
  } else {
    const thisDir = resolveThisDir();
    const detected = findRepoRoot(thisDir);
    if (!detected) {
      throw new Error(
        '[quantx-engineering-context] Could not auto-detect repo root. ' +
          'Set QUANTX_REPO_ROOT to the absolute path of the stockPredictor repo.',
      );
    }
    repoRoot = detected;
    process.stderr.write(
      `[quantx-engineering-context] Auto-detected repoRoot: ${repoRoot}\n`,
    );
  }

  // ---- QUANTX_CONTEXT_INDEX ----
  const contextIndex =
    process.env['QUANTX_CONTEXT_INDEX'] ?? '.quantx/context';

  // ---- Server identity ----
  const serverName =
    process.env['MCP_SERVER_NAME'] ?? 'quantx-engineering-context';
  const serverVersion = process.env['MCP_SERVER_VERSION'] ?? '1.0.0';

  // ---- Log level ----
  const logLevel = parseLogLevel(process.env['MCP_LOG_LEVEL']);

  const config: EngConfig = {
    repoRoot,
    contextIndex,
    contextIndexDir: path.join(repoRoot, contextIndex),
    serverName,
    serverVersion,
    logLevel,
  };

  process.stderr.write(
    `[quantx-engineering-context] Config loaded — server=${serverName}@${serverVersion}, ` +
      `repoRoot=${repoRoot}, logLevel=${logLevel}\n`,
  );

  return config;
}

// ---------------------------------------------------------------------------
// ESM-safe __filename shim (needed because tsconfig uses NodeNext)
// ---------------------------------------------------------------------------

// When compiled to CJS, `__filename` is available natively.
// Declare it so TypeScript does not complain when targeting NodeNext.
declare const __filename: string;
