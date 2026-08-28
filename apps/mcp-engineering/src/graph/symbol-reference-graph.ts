/**
 * SymbolReferenceGraph — tracks which symbols call / import / inherit from
 * which other symbols, enabling precise impact analysis.
 *
 * Data model:
 *  - callers map:  symbolName → SymbolRef[]  (who calls this symbol)
 *  - callees map:  symbolName → SymbolRef[]  (what does this symbol call)
 *
 * Built from indexed FileRecord / SymbolRecord data.
 * Falls back to substring search for cross-file references where AST data
 * is unavailable.
 *
 * Source file content is treated as DATA only — never executed.
 * All output goes to STDERR — never STDOUT.
 */

import type { FileRecord } from '../types/index.js';

// ---------------------------------------------------------------------------
// SymbolRef type
// ---------------------------------------------------------------------------

export interface SymbolRef {
  /** The symbol name (not id) being referenced */
  symbolName: string;
  /** Repo-relative file path where the reference occurs */
  file: string;
  /** 1-indexed line number of the reference (0 if unknown) */
  line: number;
  /** Nature of the relationship from the perspective of the referencing symbol */
  relationship: 'calls' | 'imports' | 'inherits' | 'uses';
}

// ---------------------------------------------------------------------------
// SymbolReferenceGraph
// ---------------------------------------------------------------------------

export class SymbolReferenceGraph {
  /** callers[symbol] = list of symbols that call/import/use `symbol` */
  private readonly callers: Map<string, SymbolRef[]>;
  /** callees[symbol] = list of symbols that `symbol` calls/imports/uses */
  private readonly callees: Map<string, SymbolRef[]>;

  /** Quick lookup: symbolName → defining file(s) */
  private readonly symbolFiles: Map<string, string[]>;

  /** All indexed FileRecords for text-based fallback search */
  private readonly fileRecords: FileRecord[];

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor(files: FileRecord[]) {
    this.callers = new Map();
    this.callees = new Map();
    this.symbolFiles = new Map();
    this.fileRecords = files;

    this.buildFromIndex(files);

    process.stderr.write(
      `[symbol-ref-graph] Built graph: ${this.callers.size} referenced symbols across ${files.length} files\n`,
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Return all SymbolRefs that call / import / use `symbolName`.
   *
   * @param symbolName  The symbol name to look up (exact match).
   */
  getCallers(symbolName: string): SymbolRef[] {
    const direct = this.callers.get(symbolName) ?? [];
    const textFallback = this.textSearchCallers(symbolName);

    return this.mergeRefs([...direct, ...textFallback]);
  }

  /**
   * Return all SymbolRefs that `symbolName` calls / imports / uses.
   *
   * @param symbolName  The symbol name to look up (exact match).
   */
  getCallees(symbolName: string): SymbolRef[] {
    return this.callees.get(symbolName) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Index build
  // ---------------------------------------------------------------------------

  private buildFromIndex(files: FileRecord[]): void {
    // Pass 1: register all known symbol names
    for (const file of files) {
      for (const sym of file.symbols) {
        if (!this.symbolFiles.has(sym.name)) {
          this.symbolFiles.set(sym.name, []);
        }
        this.symbolFiles.get(sym.name)!.push(file.filePath);
      }
    }

    // Pass 2: derive relationships from exports/imports and SymbolRecord.references
    for (const file of files) {
      // Import edges: any symbol exported from this file that another file imports
      for (const exportedName of file.exports) {
        this.ensureEntry(exportedName);
      }

      // Cross-file import relationships: file.imports list
      for (const importedPath of file.imports) {
        // We model "file imports from importedPath" as each exported symbol in
        // importedPath being potentially used in file — we create loose 'imports'
        // refs at the file level (symbol = module path, line 0).
        const importedFile = files.find((f) => f.filePath === importedPath);
        if (importedFile) {
          for (const sym of importedFile.exports) {
            this.addCaller(sym, {
              symbolName: `<${file.filePath}>`,
              file: file.filePath,
              line: 0,
              relationship: 'imports',
            });
          }
        }
      }

      // SymbolRecord.references field
      for (const sym of file.symbols) {
        if (sym.references && sym.references.length > 0) {
          for (const refId of sym.references) {
            // refId format: `<file>:<name>:<kind>`
            const parts = refId.split(':');
            const refName = parts[1];
            if (refName) {
              this.addCallee(sym.name, {
                symbolName: refName,
                file: parts[0] ?? file.filePath,
                line: 0,
                relationship: 'uses',
              });
              this.addCaller(refName, {
                symbolName: sym.name,
                file: file.filePath,
                line: sym.startLine,
                relationship: 'uses',
              });
            }
          }
        }

        // Inheritance: parentSymbol field indicates 'inherits' relationship
        if (sym.parentSymbol) {
          this.addCallee(sym.name, {
            symbolName: sym.parentSymbol,
            file: file.filePath,
            line: sym.startLine,
            relationship: 'inherits',
          });
          this.addCaller(sym.parentSymbol, {
            symbolName: sym.name,
            file: file.filePath,
            line: sym.startLine,
            relationship: 'inherits',
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Text-search fallback
  // ---------------------------------------------------------------------------

  /**
   * Scan all file symbol lists for any symbol whose name or signature mentions
   * `symbolName` as a substring.  This catches cross-file call sites that were
   * not captured in the AST references field.
   *
   * Source text is treated as DATA — we only read pre-indexed string fields.
   * We never eval or execute anything.
   */
  private textSearchCallers(symbolName: string): SymbolRef[] {
    const results: SymbolRef[] = [];

    for (const file of this.fileRecords) {
      // Skip secrets and generated files
      if (file.isSecret || file.isGenerated) continue;

      for (const sym of file.symbols) {
        // Check if this symbol's docstring or signature mentions the target
        const haystack = [sym.signature ?? '', sym.docstring ?? ''].join(' ');
        if (
          haystack.includes(symbolName) &&
          sym.name !== symbolName // avoid self-reference
        ) {
          results.push({
            symbolName: sym.name,
            file: file.filePath,
            line: sym.startLine,
            relationship: 'calls',
          });
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private ensureEntry(symbolName: string): void {
    if (!this.callers.has(symbolName)) this.callers.set(symbolName, []);
    if (!this.callees.has(symbolName)) this.callees.set(symbolName, []);
  }

  private addCaller(symbolName: string, ref: SymbolRef): void {
    this.ensureEntry(symbolName);
    this.callers.get(symbolName)!.push(ref);
  }

  private addCallee(symbolName: string, ref: SymbolRef): void {
    this.ensureEntry(symbolName);
    this.callees.get(symbolName)!.push(ref);
  }

  /**
   * Deduplicate refs by (symbolName, file, line, relationship) tuple.
   */
  private mergeRefs(refs: SymbolRef[]): SymbolRef[] {
    const seen = new Set<string>();
    const result: SymbolRef[] = [];
    for (const ref of refs) {
      const key = `${ref.symbolName}|${ref.file}|${ref.line}|${ref.relationship}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(ref);
      }
    }
    return result;
  }
}
