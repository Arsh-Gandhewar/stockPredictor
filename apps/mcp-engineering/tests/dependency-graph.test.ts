/**
 * Dependency graph and circular dependency tests.
 */

import { DependencyGraph } from '../src/graph/dependency-graph.js';
import { CircularDetector } from '../src/graph/circular-detector.js';
import { SymbolReferenceGraph } from '../src/graph/symbol-reference-graph.js';
import type { FileRecord } from '../src/types/index.js';

describe('CircularDetector', () => {
  const detector = new CircularDetector();

  test('detects simple circular dependency A -> B -> A', () => {
    const graph = new Map<string, string[]>([
      ['fileA.ts', ['fileB.ts']],
      ['fileB.ts', ['fileA.ts']],
    ]);

    const cycles = detector.detect(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });

  test('detects 3-node cycle A -> B -> C -> A', () => {
    const graph = new Map<string, string[]>([
      ['a.ts', ['b.ts']],
      ['b.ts', ['c.ts']],
      ['c.ts', ['a.ts']],
      ['d.ts', ['a.ts']],
    ]);

    const cycles = detector.detect(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });

  test('returns empty array for acyclic graph', () => {
    const graph = new Map<string, string[]>([
      ['a.ts', ['b.ts', 'c.ts']],
      ['b.ts', ['c.ts']],
      ['c.ts', []],
    ]);

    const cycles = detector.detect(graph);
    expect(cycles.length).toBe(0);
  });
});

describe('DependencyGraph', () => {
  const files: FileRecord[] = [
    {
      filePath: 'src/main.ts',
      language: 'typescript',
      sizeBytes: 100,
      contentHash: 'hash1',
      lastIndexedCommit: 'sha1',
      exports: ['main'],
      imports: ['src/service.ts', 'src/utils.ts'],
      symbols: [],
      isGenerated: false,
      isSecret: false,
    },
    {
      filePath: 'src/service.ts',
      language: 'typescript',
      sizeBytes: 100,
      contentHash: 'hash2',
      lastIndexedCommit: 'sha1',
      exports: ['Service'],
      imports: ['src/utils.ts'],
      symbols: [],
      isGenerated: false,
      isSecret: false,
    },
    {
      filePath: 'src/utils.ts',
      language: 'typescript',
      sizeBytes: 50,
      contentHash: 'hash3',
      lastIndexedCommit: 'sha1',
      exports: ['formatDate'],
      imports: [],
      symbols: [],
      isGenerated: false,
      isSecret: false,
    },
  ];

  const graph = new DependencyGraph(files);

  test('traverses forward dependencies', () => {
    const result = graph.getDependencies('src/main.ts', 2);
    expect(result.focalFile).toBe('src/main.ts');
    const importedFiles = result.graph.edges.map((e) => e.to);
    expect(importedFiles).toContain('src/service.ts');
    expect(importedFiles).toContain('src/utils.ts');
  });

  test('traverses reverse dependencies (dependents)', () => {
    const result = graph.getDependents('src/utils.ts', 2);
    const nodes = result.graph.nodes.map((n) => n.file);
    expect(nodes).toContain('src/service.ts');
    expect(nodes).toContain('src/main.ts');
  });
});

describe('SymbolReferenceGraph', () => {
  const files: FileRecord[] = [
    {
      filePath: 'src/calc.ts',
      language: 'typescript',
      sizeBytes: 100,
      contentHash: 'hash1',
      lastIndexedCommit: 'sha1',
      exports: ['calculateEV'],
      imports: [],
      symbols: [
        {
          symbolId: 'src/calc.ts:calculateEV:function',
          name: 'calculateEV',
          kind: 'function',
          file: 'src/calc.ts',
          startLine: 1,
          endLine: 5,
          language: 'typescript',
          exported: true,
        },
      ],
      isGenerated: false,
      isSecret: false,
    },
    {
      filePath: 'src/strategy.ts',
      language: 'typescript',
      sizeBytes: 150,
      contentHash: 'hash2',
      lastIndexedCommit: 'sha1',
      exports: ['executeStrategy'],
      imports: ['src/calc.ts'],
      symbols: [
        {
          symbolId: 'src/strategy.ts:executeStrategy:function',
          name: 'executeStrategy',
          kind: 'function',
          file: 'src/strategy.ts',
          startLine: 1,
          endLine: 10,
          language: 'typescript',
          exported: true,
        },
      ],
      isGenerated: false,
      isSecret: false,
    },
  ];

  const refGraph = new SymbolReferenceGraph(files);

  test('symbol reference graph builds without errors', () => {
    const callers = refGraph.getCallers('calculateEV');
    expect(Array.isArray(callers)).toBe(true);

    const callees = refGraph.getCallees('executeStrategy');
    expect(Array.isArray(callees)).toBe(true);
  });
});
