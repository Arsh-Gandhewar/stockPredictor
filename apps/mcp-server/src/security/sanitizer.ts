import { McpError } from '../errors/mcp-errors.js';

export class SecuritySanitizer {
  private static readonly TICKER_REGEX = /^[A-Z0-9_.\-]{1,20}$/;
  private static readonly DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

  /**
   * Normalizes and validates stock tickers.
   * Rejects malicious characters, directory traversal, shell metacharacters, and SQL injection syntax.
   */
  static normalizeTicker(rawTicker: string): string {
    if (!rawTicker || typeof rawTicker !== 'string') {
      throw new McpError('INVALID_INPUT', 'Ticker must be a non-empty string.');
    }

    const trimmed = rawTicker.trim().toUpperCase();
    if (!trimmed) {
      throw new McpError('INVALID_INPUT', 'Ticker cannot be empty or whitespace.');
    }

    // Check for forbidden characters (slashes, null bytes, shell metachars, SQL tokens)
    if (
      trimmed.includes('/') ||
      trimmed.includes('\\') ||
      trimmed.includes('..') ||
      trimmed.includes(';') ||
      trimmed.includes('&') ||
      trimmed.includes('|') ||
      trimmed.includes('`') ||
      trimmed.includes('$') ||
      trimmed.includes("'") ||
      trimmed.includes('"')
    ) {
      throw new McpError('INVALID_INPUT', `Malformed ticker symbol: "${rawTicker}". Forbidden characters detected.`);
    }

    // Auto-append .NS for Indian equity tickers if no exchange suffix is present
    let normalized = trimmed;
    if (!normalized.includes('.') && !normalized.startsWith('^')) {
      normalized = `${normalized}.NS`;
    }

    if (!SecuritySanitizer.TICKER_REGEX.test(normalized)) {
      throw new McpError(
        'INVALID_INPUT',
        `Invalid ticker format: "${rawTicker}". Must match pattern ^[A-Z0-9_.\\-]{1,20}$`
      );
    }

    return normalized;
  }

  /**
   * Validates date strings formatted as YYYY-MM-DD.
   */
  static validateDate(dateStr: string, fieldName: string = 'date'): string {
    if (!dateStr || typeof dateStr !== 'string') {
      throw new McpError('INVALID_INPUT', `${fieldName} must be a string in YYYY-MM-DD format.`);
    }

    const trimmed = dateStr.trim();
    if (!SecuritySanitizer.DATE_REGEX.test(trimmed)) {
      throw new McpError('INVALID_INPUT', `${fieldName} "${dateStr}" must strictly conform to YYYY-MM-DD format.`);
    }

    const [yearStr, monthStr, dayStr] = trimmed.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);

    if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
      throw new McpError('INVALID_INPUT', `${fieldName} "${dateStr}" is not a valid calendar date.`);
    }

    const parsed = new Date(`${trimmed}T00:00:00Z`);
    if (
      isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() + 1 !== month ||
      parsed.getUTCDate() !== day
    ) {
      throw new McpError('INVALID_INPUT', `${fieldName} "${dateStr}" is not a valid calendar date.`);
    }

    return trimmed;
  }

  /**
   * Validates date range for backtesting or historical queries.
   * Ensures start <= end and span does not exceed maxDays (e.g. 5 years = 1826 days).
   */
  static validateDateRange(startDateStr: string, endDateStr: string, maxDays: number = 1826): { startDate: string; endDate: string } {
    const startDate = SecuritySanitizer.validateDate(startDateStr, 'startDate');
    const endDate = SecuritySanitizer.validateDate(endDateStr, 'endDate');

    const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
    const endMs = new Date(`${endDate}T00:00:00Z`).getTime();

    if (endMs < startMs) {
      throw new McpError('INVALID_INPUT', `endDate (${endDate}) cannot precede startDate (${startDate}).`);
    }

    const diffDays = Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24));
    if (diffDays > maxDays) {
      throw new McpError(
        'INVALID_INPUT',
        `Date range spans ${diffDays} days, which exceeds the maximum allowed range of ${maxDays} days.`
      );
    }

    return { startDate, endDate };
  }

  /**
   * Sanitizes external text (news headlines, company descriptions, press releases) to prevent
   * prompt-injection and instruction override attacks against MCP AI clients.
   */
  static sanitizeTextForAi(text: string | null | undefined, maxLength: number = 500): string {
    if (!text) return '';

    let cleaned = text
      // Strip control characters
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      // Neutralize prompt injection markers
      .replace(/ignore\s+(all\s+)?(previous|prior)\s+instructions/gi, '[DISCLOSED_UNTRUSTED_TEXT]')
      .replace(/system\s+prompt/gi, 'system disclosure')
      .replace(/\[\/?TOOL_CALL.*?\]/gi, '')
      .replace(/<\|.*?\|>/g, '')
      .trim();

    if (cleaned.length > maxLength) {
      cleaned = `${cleaned.substring(0, maxLength)}... [TRUNCATED]`;
    }

    return cleaned;
  }

  /**
   * Redacts sensitive internal details, file paths, database URLs, and stack trace references from client-facing messages.
   */
  static sanitizeErrorMessage(rawMessage: string): string {
    if (!rawMessage || typeof rawMessage !== 'string') return 'An internal error occurred.';

    let cleaned = rawMessage;

    // 1. Redact JWT tokens
    cleaned = cleaned.replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]');

    // 2. Redact Authorization Bearer headers
    cleaned = cleaned.replace(/Bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');

    // 3. Redact connection URIs
    cleaned = cleaned.replace(/[a-zA-Z0-9+.-]+:\/\/[^\s"'<>]+/gi, (match) => {
      if (match.startsWith('http://') || match.startsWith('https://')) {
        return match; // preserve standard web URLs
      }
      return '[REDACTED_URI]';
    });

    // 4. Redact filesystem paths & stack frames
    cleaned = cleaned.replace(/(?:[a-zA-Z]:)?[/\\](?:[\w.-]+[/\\])+[\w.-]+\.(?:ts|js|py|json|prisma)(?::\d+(?::\d+)?)?/g, '[REDACTED_PATH]');
    cleaned = cleaned.replace(/\s+at\s+.*?\((?:[a-zA-Z]:)?[^)]+\)/g, '');

    return cleaned.trim() || 'An internal error occurred.';
  }
}
