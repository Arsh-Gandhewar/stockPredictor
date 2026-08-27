import { Logger, logger } from './logging/logger.js';
import { loadConfigOrExit } from './config.js';
import { QuantxMcpServer } from './server.js';

// MANDATORY INVARIANT: Protect STDOUT immediately before any module or dependency can log
Logger.protectStdout();

async function main() {
  try {
    const config = loadConfigOrExit();
    logger.setLevel(config.logLevel);

    const mcpServer = new QuantxMcpServer({ config });
    await mcpServer.start();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`FATAL: QuantX MCP Server failed to start: ${message}\n`);
    process.exit(1);
  }
}

main();
