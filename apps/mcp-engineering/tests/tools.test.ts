/**
 * Tool Registry tests — verifies all 25 tools are registered and functional.
 */

import { EngineeringMcpServer } from '../src/server.js';
import { createToolRegistry } from '../src/tools/registry.js';

describe('Tool Registry', () => {
  let server: EngineeringMcpServer;

  beforeAll(() => {
    server = new EngineeringMcpServer();
  });

  test('registers all 25 tools', () => {
    const registry = createToolRegistry(server);
    const tools = registry.getAll();
    expect(tools.length).toBe(25);

    const expectedTools = [
      'quantx_context_plan',
      'quantx_search_code',
      'quantx_find_symbol',
      'quantx_get_file_context',
      'quantx_get_symbol_context',
      'quantx_find_callers',
      'quantx_find_callees',
      'quantx_get_dependencies',
      'quantx_trace_flow',
      'quantx_get_module_context',
      'quantx_get_architecture',
      'quantx_find_tests',
      'quantx_get_test_context',
      'quantx_get_recent_changes',
      'quantx_get_commit_context',
      'quantx_get_diff_context',
      'quantx_get_audit_context',
      'quantx_trace_bug',
      'quantx_impact_analysis',
      'quantx_expand_context',
      'quantx_get_model_lineage',
      'quantx_get_strategy_lineage',
      'quantx_get_artifact_lineage',
      'quantx_health',
      'quantx_start_full_audit',
    ];

    for (const toolName of expectedTools) {
      const tool = registry.get(toolName);
      expect(tool).toBeDefined();
      expect(tool?.description.length).toBeGreaterThan(10);
    }
  });

  test('quantx_health executes and returns server status', async () => {
    const registry = createToolRegistry(server);
    const healthTool = registry.get('quantx_health');
    expect(healthTool).toBeDefined();

    const result = (await healthTool?.execute({}, server)) as any;
    expect(result.status).toBe('ok');
    expect(result.data.serverName).toBe('quantx-engineering-context');
    expect(result.data.openAuditFindings).toBeGreaterThan(0);
  });

  test('quantx_get_audit_context returns BUG-04', async () => {
    const registry = createToolRegistry(server);
    const auditTool = registry.get('quantx_get_audit_context');

    const result = (await auditTool?.execute({ bugId: 'BUG-04' }, server)) as any;
    expect(result.status).toBe('ok');
    expect(result.data.findings.length).toBe(1);
    expect(result.data.findings[0].bugId).toBe('BUG-04');
  });

  test('quantx_context_plan returns low compression ratio plan', async () => {
    const registry = createToolRegistry(server);
    const planTool = registry.get('quantx_context_plan');

    const result = (await planTool?.execute({ task: 'Fix EV calculation' }, server)) as any;
    expect(result.status).toBe('ok');
    expect(result.data.compressionRatio).toBeLessThan(0.05);
    expect(result.data.primaryFiles.length).toBeGreaterThan(0);
  });
});
