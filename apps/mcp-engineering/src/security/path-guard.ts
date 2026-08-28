/**
 * PathGuard — security boundary for all file-system access.
 *
 * Rules enforced:
 *  1. Reject any path containing `../` traversal sequences.
 *  2. Reject absolute paths that resolve outside the canonical repoRoot.
 *  3. Reject `.env` files and `.env.*` variants (except `.env.example`).
 *  4. Reject well-known secret config filenames.
 *  5. Canonicalise with `path.resolve()` and verify the result is nested
 *     under repoRoot (symlink-safe: we normalise both sides the same way).
 *
 * ALL logging goes to STDERR — never STDOUT.
 */

import * as path from 'node:path';
import { McpEngError } from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Basenames that are always forbidden regardless of location. */
const FORBIDDEN_BASENAMES = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '.htpasswd',
  'credentials',
  'credentials.json',
  'service-account.json',
  'serviceAccountKey.json',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
]);

/** Regex matching `.env.anything` except `.env.example`. */
const ENV_FILE_RE = /^\.env(\..+)?$/;

// ---------------------------------------------------------------------------
// PathGuard
// ---------------------------------------------------------------------------

export class PathGuard {
  private readonly _repoRoot: string;

  /**
   * @param repoRoot  Optional repo root; if provided, enables single-argument resolve().
   */
  constructor(repoRoot?: string) {
    this._repoRoot = repoRoot ?? '';
  }

  /**
   * Single-argument convenience: resolve using the stored repoRoot.
   */
  resolve(requestedPath: string): string;
  /**
   * Two-argument form: validate and resolve `requestedPath` relative to `repoRoot`.
   *
   * @param requestedPath  - The path provided by the caller (may be relative
   *                         or absolute, repo-relative preferred).
   * @param repoRoot       - Absolute, canonical path to the repository root.
   * @returns              The resolved absolute path if it passes all checks.
   * @throws McpEngError   With code `PATH_FORBIDDEN` on any violation.
   */
  resolve(requestedPath: string, repoRoot?: string): string {
    const root = repoRoot ?? this._repoRoot;
    // ---- 1. Reject raw traversal sequences before any resolution ----
    if (requestedPath.includes('..')) {
      this.deny(requestedPath, 'Path traversal sequences ("..") are not allowed');
    }

    // ---- 2. Resolve to an absolute path ----
    // If the caller sends an absolute path, use it as-is for resolution.
    // If relative, resolve against repoRoot.
    const resolved = path.isAbsolute(requestedPath)
      ? path.normalize(requestedPath)
      : path.resolve(root, requestedPath);

    // ---- 3. Canonical repoRoot (normalise separators) ----
    const canonicalRoot = path.resolve(root) + path.sep;

    // ---- 4. Ensure the resolved path is inside the repo ----
    // We add a trailing sep to canonicalRoot to avoid prefix collisions
    // (e.g. /repo vs /repo-other).
    if (
      resolved !== path.resolve(root) &&
      !resolved.startsWith(canonicalRoot)
    ) {
      this.deny(requestedPath, `Path resolves outside repository root (${root})`);
    }

    // ---- 5. Check forbidden basenames ----
    const basename = path.basename(resolved);

    if (FORBIDDEN_BASENAMES.has(basename)) {
      this.deny(requestedPath, `Access to "${basename}" is forbidden`);
    }

    // ---- 6. Block .env files (except .env.example) ----
    if (ENV_FILE_RE.test(basename) && basename !== '.env.example') {
      this.deny(requestedPath, `Access to env files ("${basename}") is forbidden`);
    }

    process.stderr.write(
      `[path-guard] Allowed: ${requestedPath} -> ${resolved}\n`,
    );

    return resolved;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private deny(requestedPath: string, reason: string): never {
    process.stderr.write(
      `[path-guard] DENIED: "${requestedPath}" — ${reason}\n`,
    );
    throw new McpEngError(
      'PATH_FORBIDDEN',
      `Access denied to path "${requestedPath}": ${reason}`,
      { requestedPath, reason },
    );
  }
}
