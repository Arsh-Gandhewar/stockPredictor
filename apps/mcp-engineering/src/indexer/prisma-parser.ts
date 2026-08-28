/**
 * PrismaParser — simple text parser for Prisma schema files.
 * Extracts model names, enum names, and field names without external deps.
 */

import type { SymbolRecord, Language } from '../types/index.js';

export class PrismaParser {
  parseFile(filePath: string, content: string): SymbolRecord[] {
    const language: Language = 'prisma';
    const symbols: SymbolRecord[] = [];
    const lines = content.split('\n');

    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Match: model ModelName {
      const modelMatch = trimmed.match(/^model\s+(\w+)\s*\{/);
      if (modelMatch) {
        const modelName = modelMatch[1]!;
        const startLine = i + 1;
        let endLine = startLine;
        // Find closing brace
        let depth = 1;
        let j = i + 1;
        while (j < lines.length && depth > 0) {
          const l = lines[j]!;
          if (l.includes('{')) depth++;
          if (l.includes('}')) depth--;
          if (depth > 0) endLine = j + 1;
          j++;
        }
        endLine = j;

        symbols.push({
          symbolId: `${filePath}:${modelName}:class`,
          name: modelName,
          kind: 'class',
          file: filePath,
          startLine,
          endLine,
          language,
          exported: true,
          signature: `model ${modelName}`,
        });

        // Extract fields within the model
        for (let k = i + 1; k < j - 1; k++) {
          const fieldLine = lines[k]!.trim();
          if (!fieldLine || fieldLine.startsWith('//') || fieldLine.startsWith('@@')) continue;
          const fieldMatch = fieldLine.match(/^(\w+)\s+(\w+)/);
          if (fieldMatch) {
            const fieldName = fieldMatch[1]!;
            symbols.push({
              symbolId: `${filePath}:${modelName}.${fieldName}:property`,
              name: fieldName,
              kind: 'property',
              file: filePath,
              startLine: k + 1,
              endLine: k + 1,
              language,
              exported: false,
              parentSymbol: modelName,
              signature: fieldLine,
            });
          }
        }

        i = j;
        continue;
      }

      // Match: enum EnumName {
      const enumMatch = trimmed.match(/^enum\s+(\w+)\s*\{/);
      if (enumMatch) {
        const enumName = enumMatch[1]!;
        const startLine = i + 1;
        let j = i + 1;
        while (j < lines.length && !lines[j]!.trim().startsWith('}')) j++;
        const endLine = j + 1;

        symbols.push({
          symbolId: `${filePath}:${enumName}:enum`,
          name: enumName,
          kind: 'enum',
          file: filePath,
          startLine,
          endLine,
          language,
          exported: true,
          signature: `enum ${enumName}`,
        });

        i = j + 1;
        continue;
      }

      i++;
    }

    return symbols;
  }
}
