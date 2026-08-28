/**
 * Entry point — starts the Engineering MCP server on STDIO.
 */
import 'dotenv/config';
import { EngineeringMcpServer } from './server.js';

const server = new EngineeringMcpServer();

server.start().catch((err: unknown) => {
  process.stderr.write(`[engineering-mcp] Fatal startup error: ${String(err)}\n`);
  process.exit(1);
});
