/**
 * Secret redactor tests.
 */

import { SecretRedactor } from '../src/security/secret-redactor.js';

describe('SecretRedactor', () => {
  let redactor: SecretRedactor;

  beforeEach(() => {
    redactor = new SecretRedactor();
  });

  test('redacts API_KEY assignments', () => {
    const input = 'const API_KEY = "sk-abc123def456"';
    expect(redactor.redact(input)).toContain('[REDACTED]');
    expect(redactor.redact(input)).not.toContain('sk-abc123def456');
  });

  test('redacts DATABASE_URL', () => {
    const input = 'DATABASE_URL=postgresql://user:pass@host/db';
    expect(redactor.redact(input)).toContain('[REDACTED]');
  });

  test('redacts JWT tokens (eyJ...)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = redactor.redact(`Authorization: Bearer ${jwt}`);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain(jwt);
  });

  test('does not redact normal code', () => {
    const code = 'function calculateEV(prob: number, payoff: number): number { return prob * payoff; }';
    const result = redactor.redact(code);
    expect(result).toContain('calculateEV');
    expect(result).toContain('function');
  });

  test('hasSecrets returns true for secrets', () => {
    expect(redactor.hasSecrets('API_KEY=abc123')).toBe(true);
    expect(redactor.hasSecrets('password=mypassword')).toBe(true);
  });

  test('hasSecrets returns false for clean code', () => {
    const clean = 'export class PortfolioEngine { constructor(private readonly config: Config) {} }';
    expect(redactor.hasSecrets(clean)).toBe(false);
  });

  test('redacts PRIVATE_KEY PEM blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
    expect(redactor.redact(pem)).toContain('[REDACTED]');
  });
});
