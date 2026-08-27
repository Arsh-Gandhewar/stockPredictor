import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ServerConfig } from './config.js';
import { QuantxClient } from './adapters/quantx-client.js';
import { AuthContext, UserRole } from './auth/auth-context.js';
import { ToolRegistry, createDefaultToolRegistry } from './tools/registry.js';
import { ResourceRegistry, createDefaultResourceRegistry } from './resources/resource-registry.js';
import { McpError } from './errors/mcp-errors.js';
import { logger } from './logging/logger.js';

export interface CreateServerOptions {
  config: ServerConfig;
  customClient?: QuantxClient;
  toolRegistry?: ToolRegistry;
  resourceRegistry?: ResourceRegistry;
}

export class QuantxMcpServer {
  private readonly server: Server;
  private readonly config: ServerConfig;
  private readonly client: QuantxClient;
  private readonly toolRegistry: ToolRegistry;
  private readonly resourceRegistry: ResourceRegistry;
  private isRunning = false;

  constructor(options: CreateServerOptions) {
    this.config = options.config;
    this.client = options.customClient || new QuantxClient({ config: this.config });
    this.toolRegistry = options.toolRegistry || createDefaultToolRegistry();
    this.resourceRegistry = options.resourceRegistry || createDefaultResourceRegistry();

    this.server = new Server(
      {
        name: this.config.serverName,
        version: this.config.serverVersion,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  private createAuthContext(requestId?: string, userRole: UserRole = 'ADMIN'): AuthContext {
    return {
      userId: this.config.authUserId,
      role: userRole,
      apiKey: this.config.apiKey,
      requestId: requestId || `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    };
  }

  private setupHandlers(): void {
    // ── Tool Discovery ──
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('MCP client requested tool list');
      const tools = this.toolRegistry.getAllTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.schema) as any,
      }));
      return { tools };
    });

    // ── Tool Invocation ──
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const toolArgs = request.params.arguments || {};
      const context = this.createAuthContext();

      logger.info(`Received MCP tool call: ${toolName}`, {
        tool: toolName,
        requestId: context.requestId,
      });

      try {
        const result = await this.toolRegistry.executeTool(toolName, toolArgs, this.client, context);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: false,
        };
      } catch (err: unknown) {
        const mcpError = err instanceof McpError ? err : new McpError('INTERNAL_ERROR', String(err));
        logger.error(`MCP tool call returned error: ${toolName}`, {
          tool: toolName,
          error: mcpError.message,
          code: mcpError.code,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: mcpError.code,
                  message: mcpError.message,
                  details: mcpError.details,
                  retryable: mcpError.retryable,
                  timestamp: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    });

    // ── Resource Discovery ──
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      logger.debug('MCP client requested resource list');
      const resources = this.resourceRegistry.getAllResources().map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      }));
      return { resources };
    });

    // ── Resource Reading ──
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const context = this.createAuthContext();

      logger.info(`Received MCP read resource: ${uri}`, {
        requestId: context.requestId,
      });

      try {
        return await this.resourceRegistry.readResource(uri, this.client, context);
      } catch (err: unknown) {
        const mcpError = err instanceof McpError ? err : new McpError('INTERNAL_ERROR', String(err));
        logger.error(`Failed to read MCP resource: ${uri}`, {
          error: mcpError.message,
          code: mcpError.code,
        });
        throw mcpError;
      }
    });
  }

  /**
   * Connects the MCP server to the transport (defaults to STDIO for local AI clients).
   */
  async start(transport?: any): Promise<void> {
    if (this.isRunning) return;

    const stdioTransport = transport || new StdioServerTransport();
    await this.server.connect(stdioTransport);
    this.isRunning = true;

    logger.info(`QuantX MCP Server v${this.config.serverVersion} successfully initialized on STDIO transport.`, {
      status: 'ONLINE',
      metadata: {
        serverName: this.config.serverName,
        apiUrl: this.config.apiUrl,
        toolsCount: this.toolRegistry.getAllTools().length,
        resourcesCount: this.resourceRegistry.getAllResources().length,
      },
    });

    this.registerSignalHandlers();
  }

  /**
   * Graceful termination handling.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    logger.info('Shutting down QuantX MCP Server...');
    await this.server.close();
    this.isRunning = false;
    logger.info('QuantX MCP Server shutdown complete.');
  }

  private registerSignalHandlers(): void {
    const onSignal = async (signal: string) => {
      logger.info(`Received shutdown signal: ${signal}`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => onSignal('SIGINT'));
    process.on('SIGTERM', () => onSignal('SIGTERM'));

    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught exception in MCP server: ${err.message}`, {
        error: err.stack,
      });
      // Do not silently crash if recoverable
    });

    process.on('unhandledRejection', (reason) => {
      logger.error(`Unhandled rejection in MCP server: ${String(reason)}`);
    });
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getResourceRegistry(): ResourceRegistry {
    return this.resourceRegistry;
  }

  getClient(): QuantxClient {
    return this.client;
  }
}
