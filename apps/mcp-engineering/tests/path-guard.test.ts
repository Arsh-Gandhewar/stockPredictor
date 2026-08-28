/**
 * Path guard security tests.
 */

import { PathGuard } from '../src/security/path-guard.js';
import { McpEngError } from '../src/types/index.js';
import * as path from 'node:path';
import * as os from 'node:os';

const REPO_ROOT = path.resolve(__dirname, '../../..'); // stockPredictor root

describe('PathGuard', () => {
  let guard: PathGuard;

  beforeEach(() => {
    guard = new PathGuard(REPO_ROOT);
  });

  test('allows valid repo-relative path', () => {
    const result = guard.resolve('apps/mcp-engineering/package.json');
    expect(result).toContain('apps');
    expect(result).toContain('mcp-engineering');
  });

  test('rejects path traversal with ..', () => {
    expect(() => guard.resolve('../../etc/passwd')).toThrow(McpEngError);
    expect(() => guard.resolve('apps/../../../etc/passwd')).toThrow(McpEngError);
  });

  test('rejects .env files', () => {
    expect(() => guard.resolve('.env')).toThrow(McpEngError);
    expect(() => guard.resolve('.env.production')).toThrow(McpEngError);
    expect(() => guard.resolve('.env.local')).toThrow(McpEngError);
  });

  test('allows .env.example', () => {
    // .env.example passes the basename check
    // (may throw NOT_FOUND later but not PATH_FORBIDDEN)
    let threw = false;
    try {
      guard.resolve('apps/mcp-engineering/.env.example');
    } catch (e) {
      if (e instanceof McpEngError && e.code === 'PATH_FORBIDDEN') {
        threw = true;
      }
    }
    expect(threw).toBe(false);
  });

  test('rejects absolute paths outside repo', () => {
    const outside = os.tmpdir();
    expect(() => guard.resolve(outside)).toThrow(McpEngError);
  });

  test('error code is PATH_FORBIDDEN', () => {
    try {
      guard.resolve('../../secret');
    } catch (e) {
      expect(e).toBeInstanceOf(McpEngError);
      if (e instanceof McpEngError) {
        expect(e.code).toBe('PATH_FORBIDDEN');
      }
    }
  });

  test('rejects forbidden basenames', () => {
    expect(() => guard.resolve('.npmrc')).toThrow(McpEngError);
    expect(() => guard.resolve('id_rsa')).toThrow(McpEngError);
  });
});
