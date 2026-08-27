import { validateConfig, ConfigError } from '../src/config.js';

describe('MCP Configuration Validator', () => {
  const validEnv = {
    QUANTX_API_URL: 'http://127.0.0.1:3001',
    QUANTX_API_KEY: 'test_secret_api_key',
    MCP_SERVER_NAME: 'quantx-test-server',
    MCP_SERVER_VERSION: '1.0.0',
    MCP_LOG_LEVEL: 'debug',
    MCP_REQUEST_TIMEOUT_MS: '5000',
    MCP_AUTH_USER_ID: 'trader_1',
  };

  it('validates a complete, correct environment configuration', () => {
    const config = validateConfig(validEnv as any);
    expect(config.apiUrl).toBe('http://127.0.0.1:3001');
    expect(config.apiKey).toBe('test_secret_api_key');
    expect(config.serverName).toBe('quantx-test-server');
    expect(config.serverVersion).toBe('1.0.0');
    expect(config.logLevel).toBe('debug');
    expect(config.requestTimeoutMs).toBe(5000);
    expect(config.authUserId).toBe('trader_1');
  });

  it('strips trailing slashes from API URL', () => {
    const config = validateConfig({
      ...validEnv,
      QUANTX_API_URL: 'https://api.quantx.internal///',
    } as any);
    expect(config.apiUrl).toBe('https://api.quantx.internal');
  });

  it('fails closed when QUANTX_API_URL is missing', () => {
    expect(() => {
      validateConfig({ ...validEnv, QUANTX_API_URL: '' } as any);
    }).toThrow(ConfigError);
  });

  it('fails closed when QUANTX_API_URL is malformed', () => {
    expect(() => {
      validateConfig({ ...validEnv, QUANTX_API_URL: 'not-a-valid-url' } as any);
    }).toThrow(ConfigError);
  });

  it('fails closed when QUANTX_API_URL uses invalid protocol (e.g. ftp)', () => {
    expect(() => {
      validateConfig({ ...validEnv, QUANTX_API_URL: 'ftp://localhost:3001' } as any);
    }).toThrow(ConfigError);
  });

  it('fails closed when QUANTX_API_KEY is missing or empty', () => {
    expect(() => {
      validateConfig({ ...validEnv, QUANTX_API_KEY: '' } as any);
    }).toThrow(ConfigError);
  });

  it('fails closed when MCP_REQUEST_TIMEOUT_MS is negative or not a number', () => {
    expect(() => {
      validateConfig({ ...validEnv, MCP_REQUEST_TIMEOUT_MS: '-500' } as any);
    }).toThrow(ConfigError);

    expect(() => {
      validateConfig({ ...validEnv, MCP_REQUEST_TIMEOUT_MS: 'abc' } as any);
    }).toThrow(ConfigError);
  });

  it('fails closed when MCP_LOG_LEVEL is invalid', () => {
    expect(() => {
      validateConfig({ ...validEnv, MCP_LOG_LEVEL: 'verbose_invalid' } as any);
    }).toThrow(ConfigError);
  });
});
