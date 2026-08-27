import { IdempotencyManager } from '../src/security/idempotency.js';
import { McpError } from '../src/errors/mcp-errors.js';

describe('Idempotency & Duplicate Write Suite', () => {
  let manager: IdempotencyManager;

  beforeEach(() => {
    manager = new IdempotencyManager();
  });

  afterEach(() => {
    manager.clear();
  });

  it('validates valid idempotency keys', () => {
    expect(IdempotencyManager.validateKey('idemp_12345678')).toBe('idemp_12345678');
    expect(IdempotencyManager.validateKey('uuid-550e8400-e29b-41d4-a716-446655440000')).toBe(
      'uuid-550e8400-e29b-41d4-a716-446655440000'
    );
  });

  it('rejects keys that are too short, empty, or have invalid characters', () => {
    expect(() => IdempotencyManager.validateKey('')).toThrow(McpError);
    expect(() => IdempotencyManager.validateKey('short')).toThrow(McpError);
    expect(() => IdempotencyManager.validateKey('key with spaces!')).toThrow(McpError);
  });

  it('records execution and returns cached result on subsequent duplicate calls', () => {
    const key = 'idem_test_key_001';
    const user = 'trader_alice';
    const mockResult = { transactionId: 'tx_999', status: 'FILLED', filledPrice: 3450.5 };

    // Initially not present
    expect(manager.getExisting(key, user)).toBeNull();

    // Record execution
    manager.record(key, user, mockResult);

    // Retrieve cached execution
    const cached = manager.getExisting(key, user);
    expect(cached).toEqual(mockResult);
  });

  it('isolates idempotency keys across different user scopes', () => {
    const key = 'shared_key_12345';
    manager.record(key, 'user_a', { tx: 'tx_a' });

    expect(manager.getExisting(key, 'user_a')).toEqual({ tx: 'tx_a' });
    expect(manager.getExisting(key, 'user_b')).toBeNull();
  });
});
