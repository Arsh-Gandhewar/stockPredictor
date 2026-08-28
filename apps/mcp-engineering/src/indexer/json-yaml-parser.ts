/**
 * JsonYamlParser — extracts top-level keys from JSON and YAML files.
 * Uses JSON.parse for JSON; simple line-based parsing for YAML.
 * Redacts secrets before parsing.
 */

import type { SymbolRecord, Language } from '../types/index.js';
import { SecretRedactor } from '../security/secret-redactor.js';

export class JsonYamlParser {
  private readonly redactor = new SecretRedactor();

  parseFile(filePath: string, content: string): SymbolRecord[] {
    const language: Language = filePath.endsWith('.json') ? 'json' : 'yaml';
    const safe = this.redactor.redact(content);

    if (language === 'json') {
      return this.parseJson(filePath, safe);
    }
    return this.parseYaml(filePath, safe);
  }

  private parseJson(filePath: string, content: string): SymbolRecord[] {
    try {
      const obj = JSON.parse(content) as Record<string, unknown>;
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [];

      return Object.keys(obj).map((key) => ({
        symbolId: `${filePath}:${key}:constant`,
        name: key,
        kind: 'constant' as const,
        file: filePath,
        startLine: 1,
        endLine: 1,
        language: 'json' as Language,
        exported: true,
        signature: `"${key}": ${typeof obj[key]}`,
      }));
    } catch {
      return [];
    }
  }

  private parseYaml(filePath: string, content: string): SymbolRecord[] {
    const symbols: SymbolRecord[] = [];
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      // Top-level keys: lines not starting with spaces and containing ':'
      if (!line.startsWith(' ') && !line.startsWith('\t') && !line.startsWith('#')) {
        const match = line.match(/^([a-zA-Z_][\w-]*)\s*:/);
        if (match) {
          const key = match[1]!;
          symbols.push({
            symbolId: `${filePath}:${key}:constant`,
            name: key,
            kind: 'constant',
            file: filePath,
            startLine: idx + 1,
            endLine: idx + 1,
            language: 'yaml',
            exported: true,
            signature: `${key}:`,
          });
        }
      }
    });

    return symbols;
  }
}
