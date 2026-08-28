/**
 * FileScanner — walks the repository tree and yields ScannedFile records.
 *
 * Responsibilities:
 *  - Respect .gitignore patterns (read from repo root)
 *  - Exclude known non-indexable directories and file types
 *  - Detect language by extension
 *  - Compute SHA-256 content hash for each file
 *  - Skip secrets: .env, .env.* (except .env.example)
 *  - ALL diagnostics go to STDERR only
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Language } from '../types/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScannedFile {
  /** Repo-relative path (forward slashes) */
  filePath: string;
  language: Language;
  sizeBytes: number;
  /** SHA-256 hex digest of file content */
  contentHash: string;
  /** Raw file content */
  content: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directories that are ALWAYS excluded from scanning. */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '__pycache__',
  '.pytest_cache',
  'coverage',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  'env',
  '.mypy_cache',
  '.ruff_cache',
  'htmlcoverage',
]);

/** Sub-paths that should be excluded (relative to repo root, forward slashes). */
const EXCLUDED_SUBPATHS = ['.quantx/context'];

/** Binary / non-parseable file extensions to skip entirely. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.mp4', '.mp3', '.wav', '.ogg', '.avi', '.mov',
  '.parquet', '.onnx', '.pkl', '.bin', '.model',
  '.whl', '.egg', '.zip', '.tar', '.gz', '.bz2',
  '.pdf', '.docx', '.xlsx', '.pptx',
  '.pyc', '.pyo', '.pyd',
  '.so', '.dll', '.dylib', '.exe',
  '.db', '.sqlite', '.sqlite3',
  '.lock',
  '.map',
]);

/** Patterns for secret files to skip. */
const SECRET_FILE_PATTERNS: RegExp[] = [
  /^\.env$/,
  /^\.env\..+$/,
  /^\.env\.template$/,
];

/** Exception: .env.example is safe to index. */
const ENV_EXAMPLE_PATTERN = /^\.env\.example$/;

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.prisma': 'prisma',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.mdx': 'markdown',
};

function detectLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Gitignore parsing (simple pattern matcher — covers ~90 % of real patterns)
// ---------------------------------------------------------------------------

interface GitignorePattern {
  regex: RegExp;
  isNegation: boolean;
}


function parseGitignore(content: string): GitignorePattern[] {
  const patterns: GitignorePattern[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const isNegation = trimmed.startsWith('!');
    const cleanLine = isNegation ? trimmed.slice(1) : trimmed;

    let regexStr = cleanLine
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000DS\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0000DS\u0000/g, '.*');

    if (!cleanLine.includes('/')) {
      regexStr = `(^|.*/)${regexStr}(/.*)?$`;
    } else {
      if (cleanLine.startsWith('/')) regexStr = regexStr.slice(1);
      regexStr = `^${regexStr}(/.*)?$`;
    }

    try {
      patterns.push({ regex: new RegExp(regexStr), isNegation });
    } catch {
      // skip malformed pattern
    }
  }
  return patterns;
}

function isIgnoredByGitignore(
  repoRelativePath: string,
  patterns: GitignorePattern[],
): boolean {
  const normalized = repoRelativePath.replace(/\\/g, '/');
  let ignored = false;
  for (const { regex, isNegation } of patterns) {
    if (regex.test(normalized)) {
      ignored = !isNegation;
    }
  }
  return ignored;
}

// ---------------------------------------------------------------------------
// FileScanner
// ---------------------------------------------------------------------------

export class FileScanner {
  private gitignorePatterns: GitignorePattern[] = [];

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Yield every indexable file under `repoRoot`.
   */
  async *scan(repoRoot: string): AsyncGenerator<ScannedFile> {
    await this.loadGitignore(repoRoot);
    yield* this.walkDir(repoRoot, repoRoot);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async loadGitignore(repoRoot: string): Promise<void> {
    const gitignorePath = path.join(repoRoot, '.gitignore');
    try {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      this.gitignorePatterns = parseGitignore(content);
      process.stderr.write(
        `[file-scanner] Loaded .gitignore (${this.gitignorePatterns.length} patterns)\n`,
      );
    } catch {
      this.gitignorePatterns = [];
    }
  }

  private async *walkDir(
    repoRoot: string,
    currentDir: string,
  ): AsyncGenerator<ScannedFile> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      process.stderr.write(
        `[file-scanner] Cannot read dir ${currentDir}: ${String(err)}\n`,
      );
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const repoRelative = path
        .relative(repoRoot, absolutePath)
        .replace(/\\/g, '/');

      // Excluded sub-paths (e.g. .quantx/context)
      if (EXCLUDED_SUBPATHS.some((sub) => repoRelative.startsWith(sub))) {
        continue;
      }

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        if (isIgnoredByGitignore(repoRelative, this.gitignorePatterns)) continue;
        yield* this.walkDir(repoRoot, absolutePath);
      } else if (entry.isFile()) {
        const scanned = await this.processFile(
          repoRoot,
          absolutePath,
          repoRelative,
          entry.name,
        );
        if (scanned !== null) yield scanned;
      }
    }
  }

  private async processFile(
    _repoRoot: string,
    absolutePath: string,
    repoRelative: string,
    basename: string,
  ): Promise<ScannedFile | null> {
    const ext = path.extname(basename).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) return null;

    // Skip secret files (unless .env.example)
    if (
      !ENV_EXAMPLE_PATTERN.test(basename) &&
      SECRET_FILE_PATTERNS.some((p) => p.test(basename))
    ) {
      process.stderr.write(
        `[file-scanner] Skipping secret file: ${repoRelative}\n`,
      );
      return null;
    }

    if (isIgnoredByGitignore(repoRelative, this.gitignorePatterns)) {
      return null;
    }

    let content: string;
    let sizeBytes: number;
    try {
      const buffer = await fs.readFile(absolutePath);
      sizeBytes = buffer.length;
      // Binary heuristic: null byte in first 8 KB
      const sample = buffer.subarray(0, 8192);
      if (sample.includes(0)) return null;
      content = buffer.toString('utf-8');
    } catch (err) {
      process.stderr.write(
        `[file-scanner] Cannot read file ${repoRelative}: ${String(err)}\n`,
      );
      return null;
    }

    const contentHash = crypto
      .createHash('sha256')
      .update(content, 'utf-8')
      .digest('hex');

    return {
      filePath: repoRelative,
      language: detectLanguage(repoRelative),
      sizeBytes,
      contentHash,
      content,
    };
  }
}
