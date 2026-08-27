import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';

describe('MCP Protocol Subprocess Integration Test (Real STDIO Process)', () => {
  let child: ChildProcess;
  const distPath = resolve(__dirname, '../dist/index.js');

  afterEach(() => {
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
  });

  it('spawns server as subprocess, executes handshake, discovers tools, and calls health', (done) => {
    child = spawn(process.execPath, [distPath], {
      env: {
        ...process.env,
        QUANTX_API_URL: 'http://127.0.0.1:3001',
        QUANTX_API_KEY: 'test_mcp_secret_key',
        MCP_LOG_LEVEL: 'error',
        MCP_SERVER_NAME: 'quantx-mcp',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buffer = '';
    const responses: any[] = [];

    child.stdout?.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          responses.push(parsed);

          if (parsed.id === 1) {
            // Handshake response received! Send initialized notification + tools/list
            const notif = JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/initialized',
            }) + '\n';
            child.stdin?.write(notif);

            const listToolsReq = JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/list',
            }) + '\n';
            child.stdin?.write(listToolsReq);
          } else if (parsed.id === 2) {
            // Tools list response received! Verify 13 tools and call quantx_health
            expect(parsed.result).toBeDefined();
            expect(parsed.result.tools).toBeDefined();
            expect(parsed.result.tools.length).toBe(13);

            const callHealthReq = JSON.stringify({
              jsonrpc: '2.0',
              id: 3,
              method: 'tools/call',
              params: {
                name: 'quantx_health',
                arguments: {},
              },
            }) + '\n';
            child.stdin?.write(callHealthReq);
          } else if (parsed.id === 3) {
            // Health tool response received!
            expect(parsed.result).toBeDefined();
            expect(parsed.result.content).toBeDefined();
            expect(parsed.result.content[0].type).toBe('text');

            const healthData = JSON.parse(parsed.result.content[0].text);
            expect(healthData.mcpServer.name).toBe('quantx-mcp');
            expect(healthData.mcpServer.status).toBe('healthy');

            // Send list resources request
            const listResReq = JSON.stringify({
              jsonrpc: '2.0',
              id: 4,
              method: 'resources/list',
            }) + '\n';
            child.stdin?.write(listResReq);
          } else if (parsed.id === 4) {
            // Resources list response received!
            expect(parsed.result.resources).toBeDefined();
            expect(parsed.result.resources.length).toBe(5);

            // Successfully validated entire protocol sequence!
            child.kill('SIGTERM');
            done();
          }
        } catch (e: any) {
          // Non-JSON line on stdout is a protocol violation!
          done(new Error(`Non-JSON line detected on MCP STDOUT: "${line}". Error: ${e.message}`));
        }
      }
    });

    child.stderr?.on('data', () => {
      // Diagnostic logs to stderr are expected and allowed
    });

    child.on('error', (err) => {
      done(err);
    });

    // Step 1: Send MCP initialize request
    const initReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'integration-test-client',
          version: '1.0.0',
        },
      },
    }) + '\n';

    child.stdin?.write(initReq);
  }, 15000);
});
