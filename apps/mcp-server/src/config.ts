import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import { UserRole, AuthService } from './auth/auth-context.js';

// Load .env files safely
try {
  loadDotenv({ path: resolve(process.cwd(), '.env') });
  loadDotenv({ path: resolve(process.cwd(), '../../.env') });
} catch {
  // Environment might already be populated
}

export interface ServerConfig {
  apiUrl: string;
  apiKey: string;
  serverName: string;
  serverVersion: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  requestTimeoutMs: number;
  localTrustMode: boolean;
  localTrustUserId?: string;
  localTrustRole: UserRole;
  authUserId?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`[MCP Configuration Error] ${message}`);
    this.name = 'ConfigError';
  }
}

/**
 * Validates configuration values against production constraints.
 * Fails closed if required parameters are missing, malformed, or invalid.
 */
export function validateConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const errors: string[] = [];

  // 1. Validate QUANTX_API_URL
  const rawApiUrl = env.QUANTX_API_URL?.trim();
  if (!rawApiUrl) {
    errors.push('QUANTX_API_URL is required. Must be a valid HTTP/HTTPS URL pointing to the QuantX API gateway.');
  } else {
    try {
      const parsed = new URL(rawApiUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push(`QUANTX_API_URL must use http or https protocol (received: ${parsed.protocol})`);
      }
    } catch {
      errors.push(`QUANTX_API_URL is malformed: "${rawApiUrl}". Expected valid URL like http://127.0.0.1:3001`);
    }
  }

  // 2. Validate QUANTX_API_KEY
  const rawApiKey = env.QUANTX_API_KEY?.trim();
  if (!rawApiKey) {
    errors.push('QUANTX_API_KEY is required. Must be a non-empty secret key for backend service authentication.');
  }

  // 3. Validate MCP_REQUEST_TIMEOUT_MS
  let requestTimeoutMs = 10000;
  if (env.MCP_REQUEST_TIMEOUT_MS) {
    const parsedTimeout = parseInt(env.MCP_REQUEST_TIMEOUT_MS, 10);
    if (isNaN(parsedTimeout) || parsedTimeout <= 0 || !Number.isInteger(parsedTimeout)) {
      errors.push(`MCP_REQUEST_TIMEOUT_MS must be a positive integer in milliseconds (received: "${env.MCP_REQUEST_TIMEOUT_MS}")`);
    } else {
      requestTimeoutMs = parsedTimeout;
    }
  }

  // 4. Validate MCP_LOG_LEVEL
  const rawLogLevel = (env.MCP_LOG_LEVEL?.trim().toLowerCase() || 'info') as string;
  const validLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(rawLogLevel)) {
    errors.push(`MCP_LOG_LEVEL must be one of [debug, info, warn, error] (received: "${rawLogLevel}")`);
  }

  // 5. Validate Local Trust Mode (STDIO process binding)
  const localTrustMode = env.LOCAL_TRUST_MODE === 'true';
  const localTrustUserId = env.MCP_LOCAL_TRUST_USER_ID?.trim() || env.MCP_AUTH_USER_ID?.trim();
  let localTrustRole: UserRole = 'AUTHENTICATED_READ';

  if (localTrustMode) {
    if (!localTrustUserId) {
      errors.push('LOCAL_TRUST_MODE is enabled but MCP_LOCAL_TRUST_USER_ID is missing. Explicit user binding is required.');
    }
    const requestedRole = env.MCP_LOCAL_TRUST_ROLE?.trim();
    if (requestedRole) {
      localTrustRole = AuthService.sanitizeRole(requestedRole);
    }
  }

  if (errors.length > 0) {
    throw new ConfigError(errors.join('; '));
  }

  return {
    apiUrl: rawApiUrl!.replace(/\/+$/, ''), // strip trailing slash
    apiKey: rawApiKey!,
    serverName: env.MCP_SERVER_NAME?.trim() || 'quantx-mcp',
    serverVersion: env.MCP_SERVER_VERSION?.trim() || '1.0.0',
    logLevel: rawLogLevel as 'debug' | 'info' | 'warn' | 'error',
    requestTimeoutMs,
    localTrustMode,
    localTrustUserId: localTrustUserId || undefined,
    localTrustRole,
    authUserId: localTrustUserId || undefined,
  };
}

/**
 * Loads configuration or prints detailed error to STDERR and terminates process with code 1.
 */
export function loadConfigOrExit(): ServerConfig {
  try {
    return validateConfig();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`FATAL: Configuration validation failed.\n${message}\n`);
    process.stderr.write('The MCP server cannot start without valid QuantX backend configuration.\n');
    process.exit(1);
  }
}
