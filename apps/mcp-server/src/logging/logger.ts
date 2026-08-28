/**
 * QuantX MCP Server Logging Infrastructure
 * MANDATORY INVARIANT: STDOUT is strictly reserved for MCP protocol messages.
 * ALL diagnostic, informational, debug, and error logs MUST go to STDERR.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  tool?: string;
  userScope?: string;
  durationMs?: number;
  status?: string;
  code?: string;
  error?: string;
  authMethod?: string;
  callerRole?: string;
  callerUserId?: string;
  metadata?: Record<string, unknown>;
}

export class Logger {
  private level: LogLevel = 'info';
  private static stdoutProtected = false;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  /**
   * Sanitizes objects and strings to prevent sensitive credentials or tokens from leaking into logs.
   */
  private maskSensitive(data: unknown): unknown {
    if (typeof data === 'string') {
      return data
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
        .replace(/(api[_-]?key|secret|password|token)["']?\s*[:=]\s*["']?([^"'\s,]+)/gi, '$1=[REDACTED]');
    }
    if (data && typeof data === 'object') {
      if (Array.isArray(data)) {
        return data.map((item) => this.maskSensitive(item));
      }
      const masked: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('key') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('token') ||
          lowerKey.includes('password') ||
          lowerKey.includes('authorization')
        ) {
          masked[key] = '[REDACTED]';
        } else {
          masked[key] = this.maskSensitive(value);
        }
      }
      return masked;
    }
    return data;
  }

  private write(entry: StructuredLog): void {
    if (!this.shouldLog(entry.level)) return;
    const sanitized = this.maskSensitive(entry) as StructuredLog;
    const logLine = `[${sanitized.timestamp}] [${sanitized.level.toUpperCase()}]${
      sanitized.requestId ? ` [req:${sanitized.requestId}]` : ''
    }${sanitized.tool ? ` [tool:${sanitized.tool}]` : ''} ${sanitized.message}${
      sanitized.durationMs !== undefined ? ` (${sanitized.durationMs}ms)` : ''
    }${sanitized.status ? ` [status:${sanitized.status}]` : ''}${
      sanitized.error ? ` [error:${sanitized.error}]` : ''
    }${sanitized.metadata ? ` ${JSON.stringify(sanitized.metadata)}` : ''}\n`;

    process.stderr.write(logLine);
  }

  debug(message: string, context?: Partial<StructuredLog>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'debug',
      message,
      ...context,
    });
  }

  info(message: string, context?: Partial<StructuredLog>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      ...context,
    });
  }

  warn(message: string, context?: Partial<StructuredLog>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      ...context,
    });
  }

  error(message: string, context?: Partial<StructuredLog>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      ...context,
    });
  }

  /**
   * Installs a global protector that redirects console.log/info/debug/warn/error to process.stderr.
   * This guarantees that accidental console calls by any library NEVER corrupt the MCP STDOUT protocol stream.
   */
  static protectStdout(): void {
    if (Logger.stdoutProtected) return;
    Logger.stdoutProtected = true;

    const redirect = (prefix: string) => (...args: unknown[]) => {
      const formatted = args
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
      process.stderr.write(`[REDIRECTED-${prefix}] ${formatted}\n`);
    };

    console.log = redirect('LOG');
    console.info = redirect('INFO');
    console.debug = redirect('DEBUG');
    console.warn = redirect('WARN');
    // console.error already writes to stderr by default, but let's be explicit
    console.error = redirect('ERROR');
  }
}

export const logger = new Logger();
