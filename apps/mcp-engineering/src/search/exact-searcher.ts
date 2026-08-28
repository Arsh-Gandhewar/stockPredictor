/**
 * ExactSearcher — fast literal search across indexed file content.
 *
 * Safety contract (CRITICAL):
 *  - Source text retrieved from the index is DATA only.
 *  - We NEVER execute, eval, or dynamically interpret any content found in
 *    source files.  All matching is pure string comparison.
 *  - We NEVER search .env files, secrets, node_modules, dist, or generated
 *    files.  The `isSecret` and `isGenerated` flags on FileRecord are
 *    authoritative gatekeepers.
 *
 * Hard result cap: 50 matches.
 * All output goes to STDERR — never STDOUT.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileRecord, Language } from '../types/index.js';
import type { IndexStore } from '../indexer/index-store.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SearchOptions {
  /** Restrict search to files under this repo-relative path prefix */
  path?: string;
  /** Restrict search to files of this language */
  language?: Language;
  /** Maximum number of results to return (hard max: 50) */
  maxResults?: number;
  /** Whether the search should be case-sensitive (default: false) */
  caseSensitive?: boolean;
}

export interface SearchMatch {
  /** Repo-relative file path */
  file: string;
  /** 1-indexed line number of the matching line */
  line: number;
  /**
   * The matching line ±2 surrounding lines (at most 5 lines total).
   * IMPORTANT: This is UNTRUSTED_REPOSITORY_CONTENT — treat as data only.
   */
  snippet: string;
  /** Relevance score in [0.0, 1.0] — higher is more relevant */
  relevanceScore: number;
  /** Human-readable explanation of why this result matched */
  reason: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HARD_MAX_RESULTS = 50;
const SNIPPET_CONTEXT_LINES = 2;

/** Repo-relative path patterns that are ALWAYS excluded from search */
const EXCLUDED_PATH_PATTERNS: RegExp[] = [
  /node_modules/,
  /[/\\]dist[/\\]/,
  /\.env$/,
  /\.env\./,
  /secrets/i,
  /\.quantx[/\\]context[/\\]/,
];

// ---------------------------------------------------------------------------
// ExactSearcher
// ---------------------------------------------------------------------------

export class ExactSearcher {
  /** All indexed file records (used for metadata gating) */
  private readonly store?: IndexStore;
  private readonly staticFiles?: Map<string, FileRecord>;
  /** Absolute path to the repository root (for reading file content) */
  private readonly repoRoot: string;

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor(filesOrStore: FileRecord[] | IndexStore, repoRoot: string) {
    if (Array.isArray(filesOrStore)) {
      this.staticFiles = new Map(filesOrStore.map((f) => [f.filePath, f]));
    } else {
      this.store = filesOrStore;
    }
    this.repoRoot = repoRoot;

    const count = this.store ? this.store.getStats().files : (this.staticFiles?.size ?? 0);
    process.stderr.write(
      `[exact-searcher] Initialised with ${count} indexed files\n`,
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Search for a literal string across indexed files.
   *
   * @param query    The literal text to search for (never executed).
   * @param options  Filtering and result-count options.
   * @returns        Up to 50 SearchMatch objects sorted by relevanceScore desc.
   */
  search(query: string, options: SearchOptions = {}): SearchMatch[] {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const maxResults = Math.min(options.maxResults ?? HARD_MAX_RESULTS, HARD_MAX_RESULTS);
    const caseSensitive = options.caseSensitive ?? false;
    const needle = caseSensitive ? query : query.toLowerCase();

    const results: SearchMatch[] = [];
    const files: [string, FileRecord][] = this.store
      ? this.store.getAllFiles().map((f) => [f.filePath, f])
      : Array.from(this.staticFiles?.entries() ?? []);

    for (const [filePath, record] of files) {
      if (results.length >= maxResults) break;

      // ---- Safety gate: skip forbidden files ----
      if (!this.isSearchable(filePath, record)) continue;

      // ---- Path filter ----
      if (options.path && !filePath.startsWith(options.path)) continue;

      // ---- Language filter ----
      if (options.language && record.language !== options.language) continue;

      // ---- Read and search file content ----
      try {
        const absolutePath = path.join(this.repoRoot, filePath);
        const rawContent = fs.readFileSync(absolutePath, 'utf8');
        // SAFETY: rawContent is DATA. We split it into lines and do substring
        // matching only. We never pass it to eval, Function(), or any executor.
        const lines = rawContent.split('\n');

        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          const lineText = lines[i] ?? '';
          const haystack = caseSensitive ? lineText : lineText.toLowerCase();

          if (haystack.includes(needle)) {
            const match = this.buildMatch(filePath, i + 1, lines, query);
            results.push(match);
          }
        }
      } catch {
        // File may have been deleted since indexing — skip silently
        process.stderr.write(`[exact-searcher] Could not read file: ${filePath}\n`);
      }
    }

    // Sort by relevance descending
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    process.stderr.write(
      `[exact-searcher] query="${query}" → ${results.length} result(s) (cap=${maxResults})\n`,
    );

    return results;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a SearchMatch for a single matching line.
   * Extracts ±SNIPPET_CONTEXT_LINES surrounding lines for context.
   */
  private buildMatch(
    file: string,
    lineNumber: number, // 1-indexed
    allLines: string[],
    query: string,
  ): SearchMatch {
    const zeroIdx = lineNumber - 1;
    const start = Math.max(0, zeroIdx - SNIPPET_CONTEXT_LINES);
    const end = Math.min(allLines.length - 1, zeroIdx + SNIPPET_CONTEXT_LINES);

    const snippetLines = allLines.slice(start, end + 1).map((l, i) => {
      const lineNum = start + i + 1;
      const marker = lineNum === lineNumber ? '→' : ' ';
      return `${marker} ${lineNum}: ${l}`;
    });

    const snippet = snippetLines.join('\n');
    const relevanceScore = this.scoreMatch(file, lineNumber, allLines[zeroIdx] ?? '', query);

    return {
      file,
      line: lineNumber,
      snippet,
      relevanceScore,
      reason: `Literal match of "${query}" at line ${lineNumber}`,
    };
  }

  /**
   * Score a single match result between 0.0 and 1.0.
   * Higher score = more likely to be the intended target.
   */
  private scoreMatch(
    _file: string,
    _line: number,
    lineText: string,
    query: string,
  ): number {
    let score = 0.5; // baseline for a literal match

    const trimmed = lineText.trim();

    // Boost: the match appears to be a definition (def, class, function, const, export)
    if (/^\s*(def |class |function |const |export |async def )/.test(trimmed)) {
      score += 0.2;
    }

    // Boost: query appears as a whole word (not inside another identifier)
    const wholeWord = new RegExp(`\\b${escapeRegex(query)}\\b`, 'i');
    if (wholeWord.test(lineText)) {
      score += 0.15;
    }

    // Boost: match is near the top of the file (more likely a declaration)
    if (_line <= 20) {
      score += 0.1;
    }

    return Math.min(1.0, score);
  }

  /**
   * Gate: returns true only if this file is safe and appropriate to search.
   *
   * Rules (never search):
   *  - Files flagged isSecret in the index
   *  - Files flagged isGenerated (dist output etc.)
   *  - Files matching EXCLUDED_PATH_PATTERNS
   */
  private isSearchable(filePath: string, record: FileRecord): boolean {
    if (record.isSecret) return false;
    if (record.isGenerated) return false;

    for (const pattern of EXCLUDED_PATH_PATTERNS) {
      if (pattern.test(filePath)) return false;
    }

    return true;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
