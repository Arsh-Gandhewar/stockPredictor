import { translateError, McpError } from '../src/errors/mcp-errors.js';

describe('MCP Error Translation Suite', () => {
  it('passes through existing McpError instances unchanged', () => {
    const original = new McpError('FORBIDDEN', 'Test forbidden');
    const translated = translateError(original);
    expect(translated).toBe(original);
  });

  it('translates timeout errors to TIMEOUT with retryable: true', () => {
    const err = new Error('The operation was aborted due to timeout');
    const translated = translateError(err, 'req_timeout_1');
    expect(translated.code).toBe('TIMEOUT');
    expect(translated.retryable).toBe(true);
    expect(translated.httpStatus).toBe(504);
  });

  it('translates network ECONNREFUSED to UPSTREAM_ERROR', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:3001');
    const translated = translateError(err);
    expect(translated.code).toBe('UPSTREAM_ERROR');
    expect(translated.retryable).toBe(true);
  });

  it('translates HTTP 400 to INVALID_INPUT', () => {
    const translated = translateError({ status: 400, message: 'Invalid ticker parameter' });
    expect(translated.code).toBe('INVALID_INPUT');
    expect(translated.retryable).toBe(false);
  });

  it('translates HTTP 401 to UNAUTHORIZED', () => {
    const translated = translateError({ status: 401, message: 'Invalid auth token' });
    expect(translated.code).toBe('UNAUTHORIZED');
  });

  it('translates HTTP 403 to FORBIDDEN', () => {
    const translated = translateError({ status: 403, message: 'Permission denied' });
    expect(translated.code).toBe('FORBIDDEN');
  });

  it('translates HTTP 404 to NOT_FOUND', () => {
    const translated = translateError({ status: 404, message: 'Stock not in universe' });
    expect(translated.code).toBe('NOT_FOUND');
  });

  it('translates HTTP 409 to CONFLICT', () => {
    const translated = translateError({ status: 409, message: 'Order already filled' });
    expect(translated.code).toBe('CONFLICT');
  });

  it('translates HTTP 429 to RATE_LIMITED', () => {
    const translated = translateError({ status: 429, message: 'Throttler limit breached' });
    expect(translated.code).toBe('RATE_LIMITED');
    expect(translated.retryable).toBe(true);
  });

  it('sanitizes passwords and connection strings from internal errors', () => {
    const leakyErr = new Error('Failed to connect to postgresql://quantx:super_secret_pw123@db.internal:5432/quantx_prod');
    const translated = translateError(leakyErr);
    expect(translated.code).toBe('INTERNAL_ERROR');
    expect(translated.message).not.toContain('super_secret_pw123');
    expect(translated.message).toContain('postgresql://[REDACTED]@');
  });
});
