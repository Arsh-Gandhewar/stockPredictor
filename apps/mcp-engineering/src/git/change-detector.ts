/**
 * ChangeDetector — determines which files have changed since the last index
 * and whether the current index is stale relative to HEAD.
 *
 * Delegates git operations to GitClient so network / subprocess concerns are
 * isolated.  All output goes to STDERR — never STDOUT.
 */

import { GitClient } from './git-client.js';

// ---------------------------------------------------------------------------
// ChangeDetector
// ---------------------------------------------------------------------------

export class ChangeDetector {
  private readonly client: GitClient;

  /**
   * @param repoRoot  Absolute path to the repository root.
   */
  constructor(repoRoot: string) {
    this.client = new GitClient(repoRoot);
  }

  /**
   * Return the repo-relative paths of all files changed between
   * `sinceCommit` and the current HEAD.
   *
   * @param sinceCommit  The commit SHA that was current when the index was built.
   * @param repoRoot     Unused here (kept for interface symmetry); the GitClient
   *                     is already scoped to the repo root provided in the
   *                     constructor.  Pass the same value as the constructor.
   * @returns            Array of repo-relative file paths (may be empty).
   * @throws McpEngError With code `GIT_UNAVAILABLE` if git is unreachable.
   */
  async getChangedFiles(
    sinceCommit: string,
    repoRoot: string, // intentionally kept for API symmetry
  ): Promise<string[]> {
    process.stderr.write(
      `[change-detector] Fetching changed files since ${sinceCommit} (repoRoot=${repoRoot})\n`,
    );

    const files = await this.client.getChangedFilesSince(sinceCommit);

    process.stderr.write(
      `[change-detector] ${files.length} file(s) changed since ${sinceCommit}\n`,
    );

    return files;
  }

  /**
   * Check whether the index is stale by comparing the commit SHA stored in
   * the index against the current HEAD.
   *
   * This is a pure string comparison — intentionally synchronous and cheap
   * so callers can gate expensive re-indexing operations.
   *
   * @param lastIndexedCommit  The HEAD SHA recorded when the index was built.
   * @param currentSha         The current HEAD SHA.
   * @returns                  `true` if the SHAs differ (index is stale).
   */
  isIndexStale(lastIndexedCommit: string, currentSha: string): boolean {
    const stale =
      lastIndexedCommit.trim().toLowerCase() !==
      currentSha.trim().toLowerCase();

    process.stderr.write(
      `[change-detector] isIndexStale(${lastIndexedCommit.slice(0, 8)}, ` +
        `${currentSha.slice(0, 8)}) = ${stale}\n`,
    );

    return stale;
  }
}
