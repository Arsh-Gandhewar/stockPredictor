/**
 * CircularDetector — DFS-based cycle detection for arbitrary directed graphs.
 *
 * Input:  Map<string, string[]>  (node → neighbours adjacency list)
 * Output: string[][]             (each inner array is one complete cycle path)
 *
 * Returns ALL cycles, not just the first one found.
 * All output goes to STDERR — never STDOUT.
 */

// ---------------------------------------------------------------------------
// CircularDetector
// ---------------------------------------------------------------------------

export class CircularDetector {
  /**
   * Detect all cycles in the supplied directed graph.
   *
   * @param graph  Adjacency list: each key maps to an array of neighbour keys.
   * @returns      Array of cycle paths.  Each path is a list of node identifiers
   *               that form a loop; the last element repeats the first to make
   *               the cycle explicit (e.g. ['A', 'B', 'C', 'A']).
   *               Returns an empty array if the graph is acyclic.
   */
  detect(graph: Map<string, string[]>): string[][] {
    const cycles: string[][] = [];

    // visited:    nodes whose entire DFS subtree has been explored
    // onStack:    nodes currently on the active DFS recursion stack
    // stackPath:  ordered list of nodes on the current DFS path
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const stackPath: string[] = [];

    // We track cycles by their canonical representation to deduplicate.
    const seenCycleKeys = new Set<string>();

    const dfs = (node: string): void => {
      visited.add(node);
      onStack.add(node);
      stackPath.push(node);

      const neighbours = graph.get(node) ?? [];
      for (const neighbour of neighbours) {
        if (!visited.has(neighbour)) {
          dfs(neighbour);
        } else if (onStack.has(neighbour)) {
          // We found a back-edge → reconstruct the cycle
          const cycleStart = stackPath.indexOf(neighbour);
          if (cycleStart !== -1) {
            const cyclePath = stackPath.slice(cycleStart);
            // Close the loop: repeat the start node
            cyclePath.push(neighbour);

            // Canonicalise: rotate so the lexicographically smallest node is first
            const canonical = CircularDetector.canonicaliseCycle(cyclePath);
            const key = canonical.join('→');
            if (!seenCycleKeys.has(key)) {
              seenCycleKeys.add(key);
              cycles.push(canonical);
            }
          }
        }
      }

      stackPath.pop();
      onStack.delete(node);
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    process.stderr.write(
      `[circular-detector] Detection complete — ${cycles.length} cycle(s) found across ${graph.size} node(s)\n`,
    );

    return cycles;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Rotate the cycle path so that the lexicographically smallest node appears
   * first, enabling reliable deduplication across different traversal orders.
   *
   * The closing repetition of the start node is stripped before rotation and
   * re-appended after.
   */
  private static canonicaliseCycle(cyclePath: string[]): string[] {
    // Strip the repeated tail before rotating
    const loop = cyclePath.slice(0, -1);
    if (loop.length === 0) return cyclePath;

    let minIdx = 0;
    for (let i = 1; i < loop.length; i++) {
      if ((loop[i] as string) < (loop[minIdx] as string)) {
        minIdx = i;
      }
    }

    const rotated = [...loop.slice(minIdx), ...loop.slice(0, minIdx)];
    // Re-append the start node to close the cycle
    rotated.push(rotated[0] as string);
    return rotated;
  }
}
