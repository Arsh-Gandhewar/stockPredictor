/**
 * RepositoryIndexer — orchestrates incremental, Git-aware indexing of the repository.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { FileRecord, Language, SymbolRecord } from '../types/index.js';
import { IndexStore } from './index-store.js';
import { FileScanner } from './file-scanner.js';
import { TsAstParser } from './ts-ast-parser.js';
import { PythonAstParser } from './python-ast-parser.js';
import { PrismaParser } from './prisma-parser.js';
import { JsonYamlParser } from './json-yaml-parser.js';
import { GitClient } from '../git/git-client.js';
import { ChangeDetector } from '../git/change-detector.js';
import { SecretRedactor } from '../security/secret-redactor.js';

export interface IndexResult {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  changedFiles: number;
  gitSha: string;
  indexVersion: string;
  durationMs: number;
  isIncremental: boolean;
}

function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function detectLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts': case '.tsx': return 'typescript';
    case '.js': case '.jsx': case '.mjs': case '.cjs': return 'javascript';
    case '.py': return 'python';
    case '.prisma': return 'prisma';
    case '.json': return 'json';
    case '.yaml': case '.yml': return 'yaml';
    case '.md': return 'markdown';
    default: return 'unknown';
  }
}

export class RepositoryIndexer {
  private readonly store: IndexStore;
  private readonly scanner: FileScanner;
  private readonly tsParser: TsAstParser;
  private readonly pyParser: PythonAstParser;
  private readonly prismaParser: PrismaParser;
  private readonly jsonYamlParser: JsonYamlParser;
  private readonly redactor: SecretRedactor;
  private changeDetector!: ChangeDetector;
  private git!: GitClient;

  constructor(store: IndexStore) {
    this.store = store;
    this.scanner = new FileScanner();
    this.tsParser = new TsAstParser();
    this.pyParser = new PythonAstParser();
    this.prismaParser = new PrismaParser();
    this.jsonYamlParser = new JsonYamlParser();
    this.redactor = new SecretRedactor();
  }

  async initialize(repoRoot: string, contextDir: string): Promise<IndexResult> {
    const start = Date.now();
    // Create git client and change detector with the actual repoRoot
    this.git = new GitClient(repoRoot);
    this.changeDetector = new ChangeDetector(repoRoot);

    const currentSha = await this.git.getCurrentSha();

    // Try to load persisted index
    const loaded = await this.store.load(contextDir);
    const lastCommit = this.store.getLastIndexedCommit();

    if (loaded && lastCommit && !this.changeDetector.isIndexStale(lastCommit, currentSha)) {
      process.stderr.write(`[RepositoryIndexer] Index is current (commit: ${currentSha})\n`);
      const stats = this.store.getStats();
      return {
        totalFiles: stats.files,
        indexedFiles: 0,
        skippedFiles: stats.files,
        changedFiles: 0,
        gitSha: currentSha,
        indexVersion: this.store.getIndexVersion(),
        durationMs: Date.now() - start,
        isIncremental: true,
      };
    }

    // Determine which files to reindex
    let changedFiles: Set<string> | null = null;
    if (loaded && lastCommit) {
      try {
        const changed = await this.changeDetector.getChangedFiles(lastCommit, repoRoot);
        changedFiles = new Set(changed.map((f) => path.join(repoRoot, f)));
        process.stderr.write(`[RepositoryIndexer] Incremental reindex: ${changedFiles.size} changed files\n`);
      } catch {
        changedFiles = null; // Fall back to full reindex
      }
    }

    const isIncremental = changedFiles !== null;
    let indexed = 0;
    let skipped = 0;
    let total = 0;

    for await (const scanned of this.scanner.scan(repoRoot)) {
      total++;
      const absPath = path.join(repoRoot, scanned.filePath);

      // Incremental: skip unchanged files
      if (isIncremental && changedFiles && !changedFiles.has(absPath)) {
        skipped++;
        continue;
      }

      try {
        const content = fs.readFileSync(absPath, 'utf8');
        const contentHash = computeContentHash(content);
        const existing = this.store.getFile(scanned.filePath);

        // Skip if hash unchanged
        if (existing && existing.contentHash === contentHash) {
          skipped++;
          continue;
        }

        const record = await this.buildFileRecord(scanned.filePath, content, contentHash, currentSha);
        this.store.setFile(record);
        indexed++;
      } catch {
        skipped++;
      }
    }

    this.store.setLastIndexedCommit(currentSha);
    await this.store.save(contextDir);

    const durationMs = Date.now() - start;
    process.stderr.write(
      `[RepositoryIndexer] Index complete: ${indexed} indexed, ${skipped} skipped, ${durationMs}ms\n`,
    );

    return {
      totalFiles: total,
      indexedFiles: indexed,
      skippedFiles: skipped,
      changedFiles: changedFiles?.size ?? total,
      gitSha: currentSha,
      indexVersion: this.store.getIndexVersion(),
      durationMs,
      isIncremental,
    };
  }

  async refresh(repoRoot: string, contextDir: string): Promise<IndexResult> {
    return this.initialize(repoRoot, contextDir);
  }

  private async buildFileRecord(
    relativePath: string,
    content: string,
    contentHash: string,
    gitSha: string,
  ): Promise<FileRecord> {
    const language = detectLanguage(relativePath);
    const isSecret = this.redactor.hasSecrets(content);

    let symbols: SymbolRecord[] = [];
    const safeContent = isSecret ? this.redactor.redact(content) : content;

    if (!isSecret) {
      switch (language) {
        case 'typescript':
        case 'javascript':
          symbols = this.tsParser.parseFile(relativePath, safeContent);
          break;
        case 'python':
          symbols = await this.pyParser.parseFile(relativePath, safeContent);
          break;
        case 'prisma':
          symbols = this.prismaParser.parseFile(relativePath, safeContent);
          break;
        case 'json':
        case 'yaml':
          symbols = this.jsonYamlParser.parseFile(relativePath, safeContent);
          break;
        default:
          symbols = [];
      }
    }

    const imports = symbols
      .filter((s) => s.kind === 'module' && s.symbolId.includes('import:'))
      .map((s) => s.signature?.replace(/^import from '|'$/g, '') ?? '');

    const exports = symbols
      .filter((s) => s.exported && s.kind !== 'module')
      .map((s) => s.name);

    return {
      filePath: relativePath,
      language,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      contentHash,
      lastIndexedCommit: gitSha,
      exports,
      imports,
      symbols,
      isGenerated: false,
      isSecret,
    };
  }
}
