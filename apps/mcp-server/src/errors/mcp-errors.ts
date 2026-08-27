/**
 * Standardized MCP Error Codes and Exception Classes
 * Meets specification section 36:
 * INVALID_INPUT, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, STALE_DATA,
 * INSUFFICIENT_DATA, RATE_LIMITED, UPSTREAM_ERROR, TIMEOUT, CONFLICT, INTERNAL_ERROR.
 */

export type McpErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'STALE_DATA'
  | 'INSUFFICIENT_DATA'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export interface McpErrorPayload {
  code: McpErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  timestamp: string;
}

export class McpError extends Error {
  public readonly code: McpErrorCode;
  public readonly details?: Record<string, unknown>;
  public readonly retryable: boolean;
  public readonly httpStatus?: number;

  constructor(
    code: McpErrorCode,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      retryable?: boolean;
      httpStatus?: number;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.details = options?.details;
    this.retryable = options?.retryable ?? (code === 'TIMEOUT' || code === 'UPSTREAM_ERROR' || code === 'RATE_LIMITED');
    this.httpStatus = options?.httpStatus;

    if (options?.cause && Error.captureStackTrace) {
      Error.captureStackTrace(this, McpError);
    }
  }

  toPayload(): McpErrorPayload {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Translates upstream HTTP, Axios/Fetch, NestJS, and Prisma errors into stable MCP domain errors.
 * Never leaks internal stack traces, DB connection strings, or query internals to clients.
 */
export function translateError(err: unknown, requestId?: string): McpError {
  if (err instanceof McpError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);

  // Check for Abort / Timeout errors
  if (message.includes('timeout') || message.includes('aborted') || message.includes('ETIMEDOUT') || message.includes('ESOCKETTIMEDOUT')) {
    return new McpError('TIMEOUT', 'The upstream QuantX backend request timed out. Please retry later.', {
      details: { requestId },
      retryable: true,
      httpStatus: 504,
    });
  }

  // Check for network connection errors
  if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('fetch failed')) {
    return new McpError('UPSTREAM_ERROR', 'Unable to reach QuantX backend gateway service.', {
      details: { requestId, hint: 'Verify QUANTX_API_URL is running and accessible' },
      retryable: true,
      httpStatus: 503,
    });
  }

  // Parse HTTP status codes if available
  const httpStatus = (err as { status?: number; statusCode?: number })?.status ||
    (err as { status?: number; statusCode?: number })?.statusCode;

  if (httpStatus === 400) {
    return new McpError('INVALID_INPUT', `Invalid input parameter: ${message}`, {
      details: { requestId },
      retryable: false,
      httpStatus: 400,
    });
  }

  if (httpStatus === 401) {
    return new McpError('UNAUTHORIZED', 'Authentication failed or missing token for QuantX backend.', {
      details: { requestId },
      retryable: false,
      httpStatus: 401,
    });
  }

  if (httpStatus === 403) {
    return new McpError('FORBIDDEN', 'Access forbidden: Insufficient permissions for requested operation.', {
      details: { requestId },
      retryable: false,
      httpStatus: 403,
    });
  }

  if (httpStatus === 404) {
    return new McpError('NOT_FOUND', `Requested QuantX resource was not found: ${message}`, {
      details: { requestId },
      retryable: false,
      httpStatus: 404,
    });
  }

  if (httpStatus === 409) {
    return new McpError('CONFLICT', `Request conflict or duplicate operation: ${message}`, {
      details: { requestId },
      retryable: false,
      httpStatus: 409,
    });
  }

  if (httpStatus === 429) {
    return new McpError('RATE_LIMITED', 'Upstream QuantX backend rate limit exceeded.', {
      details: { requestId },
      retryable: true,
      httpStatus: 429,
    });
  }

  // Fallback internal error - sanitize message
  const safeMessage = message.replace(/password=.*?(&|$)/gi, 'password=[REDACTED]')
    .replace(/postgresql:\/\/.*?:.*?@/gi, 'postgresql://[REDACTED]@');

  return new McpError('INTERNAL_ERROR', `Internal MCP processing error: ${safeMessage}`, {
    details: { requestId },
    retryable: false,
    httpStatus: 500,
  });
}
