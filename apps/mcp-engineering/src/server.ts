/**
 * Engineering MCP — Server implementation.
 *
 * Uses the MCP SDK StdioServerTransport.
 * STDOUT: MCP protocol only.
 * STDERR: all logging.
 *
 * This server is READ-ONLY. It never writes to the repository,
 * executes repository code, or exposes financial/trading mutations.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { loadConfig } from './config.js';
import { IndexStore } from './indexer/index-store.js';
import { RepositoryIndexer } from './indexer/repository-indexer.js';
import { DependencyGraph } from './graph/dependency-graph.js';
import { SymbolReferenceGraph } from './graph/symbol-reference-graph.js';
import { ExactSearcher } from './search/exact-searcher.js';
import { ContextPlanner } from './search/context-planner.js';
import { AuditIndex } from './audit/audit-index.js';
import { GitClient } from './git/git-client.js';
import { PathGuard } from './security/path-guard.js';
import { McpEngError } from './types/index.js';

import { createToolRegistry } from './tools/registry.js';

export class EngineeringMcpServer {
  private readonly server: Server;
  private isRunning = false;

  // Shared services — injected into all tools
  readonly store = new IndexStore();
  readonly auditIndex = new AuditIndex();
  readonly config = loadConfig();
  readonly git: GitClient;
  readonly pathGuard: PathGuard;
  indexer!: RepositoryIndexer;
  depGraph!: DependencyGraph;
  symRefGraph!: SymbolReferenceGraph;
  readonly searcher: ExactSearcher;
  readonly planner: ContextPlanner;
  currentGitSha = 'UNKNOWN';

  constructor() {
    this.git = new GitClient(this.config.repoRoot);
    this.pathGuard = new PathGuard(this.config.repoRoot);
    this.searcher = new ExactSearcher(this.store, this.config.repoRoot);
    this.planner = new ContextPlanner(this.store, this.auditIndex, this.git);

    this.server = new Server(
      { name: this.config.serverName, version: this.config.serverVersion },
      { capabilities: { tools: {} } },
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    const registry = createToolRegistry(this);

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = registry.getAll().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.schema as any) as any,
      }));
      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = request.params.arguments ?? {};

      process.stderr.write(`[engineering-mcp] Tool call: ${toolName}\n`);

      // Refresh index on each request if stale
      await this.refreshIfStale();

      try {
        const tool = registry.get(toolName);
        if (!tool) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'NOT_FOUND', message: `Unknown tool: ${toolName}` }) }],
            isError: true,
          };
        }

        const result = await tool.execute(args, this);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          isError: false,
        };
      } catch (err: unknown) {
        const mcpErr = err instanceof McpEngError
          ? err
          : new McpEngError('INTERNAL_ERROR', String(err));

        process.stderr.write(`[engineering-mcp] Error in ${toolName}: ${mcpErr.message}\n`);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(mcpErr.toJSON(), null, 2),
          }],
          isError: true,
        };
      }
    });
  }

  private async refreshIfStale(): Promise<void> {
    try {
      const currentSha = await this.git.getCurrentSha();
      const lastSha = this.store.getLastIndexedCommit();

      if (currentSha !== this.currentGitSha || !lastSha) {
        this.currentGitSha = currentSha;
      }
    } catch {
      // Git unavailable — continue with cached index
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    process.stderr.write(`[engineering-mcp] Starting ${this.config.serverName} v${this.config.serverVersion}\n`);
    process.stderr.write(`[engineering-mcp] Repo root: ${this.config.repoRoot}\n`);

    // Initialize repository index
    this.indexer = new RepositoryIndexer(this.store);
    const indexResult = await this.indexer.initialize(this.config.repoRoot, this.config.contextIndexDir);
    this.currentGitSha = indexResult.gitSha;

    // Build graphs
    const allFiles = this.store.getAllFiles();
    this.depGraph = new DependencyGraph(allFiles);
    this.symRefGraph = new SymbolReferenceGraph(allFiles);

    // Persist audit index
    this.auditIndex.persist(this.config.contextIndexDir);

    process.stderr.write(
      `[engineering-mcp] Index ready: ${indexResult.indexedFiles} files indexed, ${indexResult.durationMs}ms\n`,
    );

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.isRunning = true;

    process.stderr.write(`[engineering-mcp] Server online on STDIO transport.\n`);

    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    process.stderr.write('[engineering-mcp] Shutting down...\n');
    await this.server.close();
    this.isRunning = false;
  }
}
