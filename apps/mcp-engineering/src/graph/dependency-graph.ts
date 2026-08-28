/**
 * DependencyGraph — builds and queries the import/export dependency graph
 * derived from indexed FileRecord data.
 *
 * Supports:
 *  - Forward traversal  (getDependencies):  what does this file import?
 *  - Reverse traversal  (getDependents):    what files import this file?
 *  - Bidirectional full graph (getFullGraph): bounded-depth neighbourhood
 *  - Circular dependency detection via CircularDetector
 *
 * All output goes to STDERR — never STDOUT.
 * Source file content is treated as DATA only and is never executed.
 */

import type {
  FileRecord,
  DependencyGraph as DependencyGraphResult,
  DependencyNode,
  DependencyEdge,
} from '../types/index.js';
import { CircularDetector } from './circular-detector.js';

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export interface DependencyResult {
  /** The focal file that was queried */
  focalFile: string;
  /** Graph slice reachable within maxDepth */
  graph: DependencyGraphResult;
  /** Circular dependency paths discovered during traversal */
  circularDependencies: string[][];
  /** Actual depth traversed (may be less than maxDepth if graph is shallow) */
  traversalDepth: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_DEPTH = 2;
const ABSOLUTE_MAX_DEPTH = 5;

// ---------------------------------------------------------------------------
// DependencyGraph class
// ---------------------------------------------------------------------------

export class DependencyGraph {
  /** Map from repo-relative filePath → FileRecord */
  private readonly fileIndex: Map<string, FileRecord>;

  /** Forward adjacency: filePath → files it imports */
  private readonly forwardEdges: Map<string, DependencyEdge[]>;

  /** Reverse adjacency: filePath → files that import it */
  private readonly reverseEdges: Map<string, string[]>;

  private readonly detector: CircularDetector;

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor(files: FileRecord[]) {
    this.fileIndex = new Map();
    this.forwardEdges = new Map();
    this.reverseEdges = new Map();
    this.detector = new CircularDetector();

    for (const file of files) {
      this.fileIndex.set(file.filePath, file);
      this.forwardEdges.set(file.filePath, []);
      if (!this.reverseEdges.has(file.filePath)) {
        this.reverseEdges.set(file.filePath, []);
      }
    }

    this.buildEdges(files);

    process.stderr.write(
      `[dependency-graph] Built graph: ${this.fileIndex.size} files, ` +
        `${this.countEdges()} edges\n`,
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Return everything this file imports, up to maxDepth hops away.
   *
   * @param filePath  Repo-relative path of the focal file.
   * @param maxDepth  How many import hops to follow (default 2, max 5).
   */
  getDependencies(filePath: string, maxDepth?: number): DependencyResult {
    const depth = this.clampDepth(maxDepth ?? DEFAULT_MAX_DEPTH);
    const visited = new Set<string>();
    const nodes: DependencyNode[] = [];
    const edges: DependencyEdge[] = [];

    this.traverseForward(filePath, depth, 0, visited, nodes, edges);

    const graph = this.buildGraphResult(nodes, edges);
    const circularDependencies = this.detectCycles(graph);

    return {
      focalFile: filePath,
      graph,
      circularDependencies,
      traversalDepth: depth,
    };
  }

  /**
   * Return everything that imports this file, up to maxDepth hops away.
   *
   * @param filePath  Repo-relative path of the focal file.
   * @param maxDepth  How many reverse-import hops to follow (default 2, max 5).
   */
  getDependents(filePath: string, maxDepth?: number): DependencyResult {
    const depth = this.clampDepth(maxDepth ?? DEFAULT_MAX_DEPTH);
    const visited = new Set<string>();
    const nodes: DependencyNode[] = [];
    const edges: DependencyEdge[] = [];

    this.traverseReverse(filePath, depth, 0, visited, nodes, edges);

    const graph = this.buildGraphResult(nodes, edges);
    const circularDependencies = this.detectCycles(graph);

    return {
      focalFile: filePath,
      graph,
      circularDependencies,
      traversalDepth: depth,
    };
  }

  /**
   * Return the bounded-depth bidirectional neighbourhood of a file:
   * its dependencies AND its dependents merged into one graph.
   *
   * @param filePath  Repo-relative path of the focal file.
   * @param maxDepth  Bidirectional hop limit (default 2, max 5).
   */
  getFullGraph(filePath: string, maxDepth: number = DEFAULT_MAX_DEPTH): DependencyResult {
    const depth = this.clampDepth(maxDepth);

    const visited = new Set<string>();
    const edgeSet = new Set<string>();
    const nodes: DependencyNode[] = [];
    const edges: DependencyEdge[] = [];

    // Forward pass
    this.traverseForward(filePath, depth, 0, visited, nodes, edges, edgeSet);

    // Reset only visited set for reverse pass, keep accumulated nodes/edges
    const visitedReverse = new Set<string>();
    this.traverseReverse(filePath, depth, 0, visitedReverse, nodes, edges, edgeSet);

    const graph = this.buildGraphResult(nodes, edges);
    const circularDependencies = this.detectCycles(graph);

    return {
      focalFile: filePath,
      graph,
      circularDependencies,
      traversalDepth: depth,
    };
  }

  // ---------------------------------------------------------------------------
  // Build helpers
  // ---------------------------------------------------------------------------

  private buildEdges(files: FileRecord[]): void {
    for (const file of files) {
      for (const importedPath of file.imports) {
        // Normalise to repo-relative path if it exists in our index
        const resolvedPath = this.resolveImportPath(importedPath, file.filePath);

        const edge: DependencyEdge = {
          from: file.filePath,
          to: resolvedPath,
          importSpecifier: importedPath,
          importedSymbols: undefined, // populated by symbol-reference-graph if needed
        };

        this.forwardEdges.get(file.filePath)?.push(edge);

        if (!this.reverseEdges.has(resolvedPath)) {
          this.reverseEdges.set(resolvedPath, []);
        }
        this.reverseEdges.get(resolvedPath)?.push(file.filePath);
      }
    }
  }

  /**
   * Attempt to map an import specifier to a known repo-relative path.
   * Falls back to the raw specifier if not found in the index.
   */
  private resolveImportPath(importSpecifier: string, _fromFile: string): string {
    // Direct hit
    if (this.fileIndex.has(importSpecifier)) return importSpecifier;

    // Try common extension variants
    const variants = [
      importSpecifier,
      `${importSpecifier}.ts`,
      `${importSpecifier}.py`,
      `${importSpecifier}/index.ts`,
    ];
    for (const v of variants) {
      if (this.fileIndex.has(v)) return v;
    }

    // Return as-is (external/unresolved dependency)
    return importSpecifier;
  }

  // ---------------------------------------------------------------------------
  // Traversal
  // ---------------------------------------------------------------------------

  private traverseForward(
    filePath: string,
    maxDepth: number,
    currentDepth: number,
    visited: Set<string>,
    nodes: DependencyNode[],
    edges: DependencyEdge[],
    edgeSet?: Set<string>,
  ): void {
    if (currentDepth > maxDepth || visited.has(filePath)) return;
    visited.add(filePath);

    const record = this.fileIndex.get(filePath);
    nodes.push({
      file: filePath,
      language: record?.language ?? 'unknown',
      symbolCount: record?.symbols.length ?? 0,
    });

    if (currentDepth < maxDepth) {
      const outEdges = this.forwardEdges.get(filePath) ?? [];
      for (const edge of outEdges) {
        const edgeKey = `${edge.from}→${edge.to}`;
        if (!edgeSet || !edgeSet.has(edgeKey)) {
          edges.push(edge);
          edgeSet?.add(edgeKey);
        }
        this.traverseForward(edge.to, maxDepth, currentDepth + 1, visited, nodes, edges, edgeSet);
      }
    }
  }

  private traverseReverse(
    filePath: string,
    maxDepth: number,
    currentDepth: number,
    visited: Set<string>,
    nodes: DependencyNode[],
    edges: DependencyEdge[],
    edgeSet?: Set<string>,
  ): void {
    if (currentDepth > maxDepth || visited.has(filePath)) return;
    visited.add(filePath);

    const record = this.fileIndex.get(filePath);
    // Avoid duplicate nodes (might already be added by forward pass)
    if (!nodes.some((n) => n.file === filePath)) {
      nodes.push({
        file: filePath,
        language: record?.language ?? 'unknown',
        symbolCount: record?.symbols.length ?? 0,
      });
    }

    if (currentDepth < maxDepth) {
      const inNodes = this.reverseEdges.get(filePath) ?? [];
      for (const parent of inNodes) {
        // Reconstruct a synthetic edge for the reverse direction
        const parentEdges = this.forwardEdges.get(parent) ?? [];
        const originalEdge = parentEdges.find((e) => e.to === filePath);
        if (originalEdge) {
          const edgeKey = `${originalEdge.from}→${originalEdge.to}`;
          if (!edgeSet || !edgeSet.has(edgeKey)) {
            edges.push(originalEdge);
            edgeSet?.add(edgeKey);
          }
        }
        this.traverseReverse(parent, maxDepth, currentDepth + 1, visited, nodes, edges, edgeSet);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Graph assembly
  // ---------------------------------------------------------------------------

  private buildGraphResult(
    nodes: DependencyNode[],
    edges: DependencyEdge[],
  ): DependencyGraphResult {
    // Deduplicate nodes
    const uniqueNodes = Array.from(
      new Map(nodes.map((n) => [n.file, n])).values(),
    );

    // Build reverseDeps index
    const reverseDeps: Record<string, string[]> = {};
    for (const edge of edges) {
      if (!reverseDeps[edge.to]) {
        reverseDeps[edge.to] = [];
      }
      if (!reverseDeps[edge.to]!.includes(edge.from)) {
        reverseDeps[edge.to]!.push(edge.from);
      }
    }

    return { nodes: uniqueNodes, edges, reverseDeps };
  }

  private detectCycles(graph: DependencyGraphResult): string[][] {
    const adjacency = new Map<string, string[]>();
    for (const node of graph.nodes) {
      adjacency.set(node.file, []);
    }
    for (const edge of graph.edges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from)!.push(edge.to);
    }
    return this.detector.detect(adjacency);
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  private clampDepth(depth: number): number {
    return Math.min(Math.max(1, depth), ABSOLUTE_MAX_DEPTH);
  }

  private countEdges(): number {
    let total = 0;
    for (const edges of this.forwardEdges.values()) {
      total += edges.length;
    }
    return total;
  }
}
