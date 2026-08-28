/**
 * AuditIndex tests — BUG 1-4 lookup and search.
 */

import { AuditIndex } from '../src/audit/audit-index.js';

describe('AuditIndex', () => {
  const audit = new AuditIndex();

  test('retrieves BUG-01 by ID', () => {
    const finding = audit.getByBugId('BUG-01');
    expect(finding).toBeDefined();
    expect(finding?.bugId).toBe('BUG-01');
    expect(finding?.affectedSymbols).toContain('calculateEV');
  });

  test('retrieves BUG-03 (execution realism)', () => {
    const finding = audit.getByBugId('BUG-03');
    expect(finding).toBeDefined();
    expect(finding?.description).toContain('Execution realism');
    expect(finding?.regressionTests).toContain('packages/quant-engine/tests/test_bug_3_execution_realism.py');
  });

  test('retrieves BUG-04 (research validity)', () => {
    const finding = audit.getByBugId('BUG-04');
    expect(finding).toBeDefined();
    expect(finding?.status).toBe('in-progress');
  });

  test('looks up by affected file', () => {
    const findings = audit.getByFile('conditional_returns.py');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.bugId === 'BUG-01')).toBe(true);
  });

  test('looks up by affected symbol', () => {
    const findings = audit.getBySymbol('PortfolioConstraintSolver');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.bugId).toBe('BUG-02');
  });

  test('searches by keyword', () => {
    const results = audit.search('slippage transaction cost');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((f) => f.bugId === 'BUG-03')).toBe(true);
  });
});
