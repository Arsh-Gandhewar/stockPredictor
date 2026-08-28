/**
 * GitClient — thin wrapper around the `git` CLI for repository introspection.
 *
 * Contract:
 *  - All methods return structured data; they NEVER throw unhandled errors.
 *  - On git failures the returned promise resolves to an `McpEngError`
 *    with code `GIT_UNAVAILABLE`.
 *  - ALL output (including diagnostics) goes to STDERR — NEVER STDOUT.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { McpEngError } from '../types/index.js';
import type { CommitInfo } from '../types/index.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maximum bytes we accept from a git subprocess before truncating. */
const MAX_OUTPUT_BYTES = 1_000_000; // 1 MB

interface ExecResult {
  stdout: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// GitClient
// ---------------------------------------------------------------------------

export class GitClient {
  private readonly repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Return the current HEAD commit SHA (40 hex chars).
   */
  async getCurrentSha(): Promise<string> {
    const result = await this.run(['rev-parse', 'HEAD']);
    if (result instanceof McpEngError) throw result;
    return result.stdout.trim();
  }

  /**
   * Return the last `n` commits, optionally scoped to a file `path`.
   *
   * Format parsed: `%H%x1f%s%x1f%an%x1f%aI` (sha, subject, author, iso date)
   * Changed files are fetched with a second `--name-only` call per commit.
   */
  async getRecentCommits(n: number, filePath?: string): Promise<CommitInfo[]> {
    const args = [
      'log',
      `--max-count=${n}`,
      '--format=%H\x1f%s\x1f%an\x1f%aI',
    ];
    if (filePath) args.push('--', filePath);

    const result = await this.run(args);
    if (result instanceof McpEngError) throw result;

    const lines = result.stdout.split('\n').filter(Boolean);
    const commits: CommitInfo[] = [];

    for (const line of lines) {
      const parts = line.split('\x1f');
      const sha = parts[0]?.trim() ?? '';
      const message = parts[1]?.trim() ?? '';
      const author = parts[2]?.trim() ?? '';
      const date = parts[3]?.trim() ?? '';

      // Fetch changed files for this commit
      const changedFiles = await this.getFilesForCommit(sha);

      commits.push({ sha, message, author, date, changedFiles });
    }

    return commits;
  }

  /**
   * Return repo-relative paths of files changed between `sinceCommit` and HEAD.
   */
  async getChangedFilesSince(sinceCommit: string): Promise<string[]> {
    const result = await this.run([
      'diff',
      '--name-only',
      sinceCommit,
      'HEAD',
    ]);
    if (result instanceof McpEngError) throw result;
    return result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  /**
   * Return `git show --stat <sha>` output (commit header + diffstat).
   */
  async getCommitDiff(sha: string): Promise<string> {
    const result = await this.run(['show', '--stat', sha]);
    if (result instanceof McpEngError) throw result;
    return result.stdout;
  }

  /**
   * Return `git diff base..target` output.
   */
  async getDiff(base: string, target: string): Promise<string> {
    const result = await this.run(['diff', `${base}..${target}`]);
    if (result instanceof McpEngError) throw result;
    return result.stdout;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Execute a git command inside `this.repoRoot`.
   *
   * Returns the raw stdout/stderr on success, or an `McpEngError` on failure.
   * The error is returned (not thrown) so callers can decide how to surface it.
   */
  private async run(args: string[]): Promise<ExecResult | McpEngError> {
    try {
      process.stderr.write(`[git-client] git ${args.join(' ')}\n`);

      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd: this.repoRoot,
        maxBuffer: MAX_OUTPUT_BYTES,
        // Ensure clean env so PAGER etc. don't interfere
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_PAGER: 'cat',
        },
      });

      if (stderr) {
        process.stderr.write(`[git-client] stderr: ${stderr}\n`);
      }

      return { stdout, stderr };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      process.stderr.write(`[git-client] ERROR: ${message}\n`);
      return new McpEngError(
        'GIT_UNAVAILABLE',
        `git ${args[0]} failed: ${message}`,
        { args, originalError: message },
      );
    }
  }

  /**
   * Fetch the list of files changed in a single commit SHA.
   * Returns an empty array on failure (non-critical path).
   */
  private async getFilesForCommit(sha: string): Promise<string[]> {
    const result = await this.run([
      'diff-tree',
      '--no-commit-id',
      '-r',
      '--name-only',
      sha,
    ]);
    if (result instanceof McpEngError) return [];
    return result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  }
}
