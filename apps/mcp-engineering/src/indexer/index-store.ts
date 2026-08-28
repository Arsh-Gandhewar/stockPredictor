/**
 * IndexStore — in-memory repository index with JSON persistence.
 *
 * Stores FileRecords and SymbolRecords. Persists to .quantx/context/.
 * Write operations are lock-protected (single-process flag).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FileRecord, SymbolRecord } from '../types/index.js';

const INDEX_VERSION = '1.0.0';

interface PersistedIndex {
  indexVersion: string;
  lastIndexedCommit: string | null;
  indexedAt: string;
  files: FileRecord[];
}

interface PersistedSymbols {
  indexVersion: string;
  symbols: SymbolRecord[];
}

export class IndexStore {
  private fileIndex = new Map<string, FileRecord>();
  private symbolIndex = new Map<string, SymbolRecord>();
  private symbolNameIndex = new Map<string, string[]>();  // name → symbolIds[]
  private lastIndexedCommit: string | null = null;
  private writing = false;

  // ---------------------------------------------------------------------------
  // File Records
  // ---------------------------------------------------------------------------

  setFile(record: FileRecord): void {
    this.fileIndex.set(record.filePath, record);
    for (const sym of record.symbols) {
      this.setSymbol(sym);
    }
  }

  getFile(filePath: string): FileRecord | undefined {
    return this.fileIndex.get(filePath);
  }

  getAllFiles(): FileRecord[] {
    return Array.from(this.fileIndex.values());
  }

  deleteFile(filePath: string): void {
    const existing = this.fileIndex.get(filePath);
    if (existing) {
      for (const sym of existing.symbols) {
        this.symbolIndex.delete(sym.symbolId);
        const ids = this.symbolNameIndex.get(sym.name);
        if (ids) {
          const filtered = ids.filter((id) => id !== sym.symbolId);
          if (filtered.length === 0) {
            this.symbolNameIndex.delete(sym.name);
          } else {
            this.symbolNameIndex.set(sym.name, filtered);
          }
        }
      }
    }
    this.fileIndex.delete(filePath);
  }

  // ---------------------------------------------------------------------------
  // Symbol Records
  // ---------------------------------------------------------------------------

  setSymbol(record: SymbolRecord): void {
    this.symbolIndex.set(record.symbolId, record);
    const existing = this.symbolNameIndex.get(record.name) ?? [];
    if (!existing.includes(record.symbolId)) {
      this.symbolNameIndex.set(record.name, [...existing, record.symbolId]);
    }
  }

  getSymbol(symbolId: string): SymbolRecord | undefined {
    return this.symbolIndex.get(symbolId);
  }

  findSymbolsByName(name: string): SymbolRecord[] {
    const ids = this.symbolNameIndex.get(name) ?? [];
    return ids.map((id) => this.symbolIndex.get(id)).filter(Boolean) as SymbolRecord[];
  }

  findSymbolsByNamePartial(partial: string): SymbolRecord[] {
    const lower = partial.toLowerCase();
    const results: SymbolRecord[] = [];
    for (const [name, ids] of this.symbolNameIndex) {
      if (name.toLowerCase().includes(lower)) {
        for (const id of ids) {
          const sym = this.symbolIndex.get(id);
          if (sym) results.push(sym);
        }
      }
    }
    return results;
  }

  getAllSymbols(): SymbolRecord[] {
    return Array.from(this.symbolIndex.values());
  }

  // ---------------------------------------------------------------------------
  // Commit tracking
  // ---------------------------------------------------------------------------

  getLastIndexedCommit(): string | null {
    return this.lastIndexedCommit;
  }

  setLastIndexedCommit(sha: string): void {
    this.lastIndexedCommit = sha;
  }

  getIndexVersion(): string {
    return INDEX_VERSION;
  }

  getStats(): { files: number; symbols: number; uniqueNames: number } {
    return {
      files: this.fileIndex.size,
      symbols: this.symbolIndex.size,
      uniqueNames: this.symbolNameIndex.size,
    };
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  async save(contextDir: string): Promise<void> {
    if (this.writing) {
      process.stderr.write('[IndexStore] Write lock held — skipping concurrent save\n');
      return;
    }
    this.writing = true;
    try {
      if (!fs.existsSync(contextDir)) {
        fs.mkdirSync(contextDir, { recursive: true });
      }

      const indexPayload: PersistedIndex = {
        indexVersion: INDEX_VERSION,
        lastIndexedCommit: this.lastIndexedCommit,
        indexedAt: new Date().toISOString(),
        files: Array.from(this.fileIndex.values()),
      };

      fs.writeFileSync(
        path.join(contextDir, 'index.json'),
        JSON.stringify(indexPayload, null, 2),
        'utf8',
      );

      const symbolPayload: PersistedSymbols = {
        indexVersion: INDEX_VERSION,
        symbols: Array.from(this.symbolIndex.values()),
      };

      fs.writeFileSync(
        path.join(contextDir, 'symbols.json'),
        JSON.stringify(symbolPayload, null, 2),
        'utf8',
      );
    } finally {
      this.writing = false;
    }
  }

  async load(contextDir: string): Promise<boolean> {
    const indexPath = path.join(contextDir, 'index.json');
    const symbolsPath = path.join(contextDir, 'symbols.json');

    if (!fs.existsSync(indexPath) || !fs.existsSync(symbolsPath)) {
      return false;
    }

    try {
      const indexRaw = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as PersistedIndex;
      const symbolsRaw = JSON.parse(fs.readFileSync(symbolsPath, 'utf8')) as PersistedSymbols;

      if (indexRaw.indexVersion !== INDEX_VERSION || symbolsRaw.indexVersion !== INDEX_VERSION) {
        process.stderr.write('[IndexStore] Index version mismatch — rebuilding\n');
        return false;
      }

      this.lastIndexedCommit = indexRaw.lastIndexedCommit;
      this.fileIndex.clear();
      this.symbolIndex.clear();
      this.symbolNameIndex.clear();

      for (const file of indexRaw.files) {
        this.fileIndex.set(file.filePath, file);
      }

      for (const sym of symbolsRaw.symbols) {
        this.symbolIndex.set(sym.symbolId, sym);
        const existing = this.symbolNameIndex.get(sym.name) ?? [];
        if (!existing.includes(sym.symbolId)) {
          this.symbolNameIndex.set(sym.name, [...existing, sym.symbolId]);
        }
      }

      process.stderr.write(
        `[IndexStore] Loaded index: ${this.fileIndex.size} files, ${this.symbolIndex.size} symbols (commit: ${this.lastIndexedCommit ?? 'unknown'})\n`,
      );
      return true;
    } catch (err) {
      process.stderr.write(`[IndexStore] Failed to load index — will rebuild: ${String(err)}\n`);
      return false;
    }
  }
}
