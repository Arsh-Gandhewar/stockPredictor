/**
 * SecretRedactor — detects and redacts credential patterns from text.
 *
 * SECURITY MODEL:
 *  - Any source code or file content returned to callers is tagged
 *    UNTRUSTED_REPOSITORY_CONTENT (see ContextFragment in types).
 *  - This module provides a best-effort scrub layer so that accidental
 *    credential commits do not leak through tool responses.
 *  - It is NOT a substitute for proper secrets management; real secrets
 *    must never enter the repository in the first place.
 *
 * ALL logging goes to STDERR — never STDOUT.
 */

// ---------------------------------------------------------------------------
// Pattern library
// ---------------------------------------------------------------------------

interface RedactPattern {
  name: string;
  /** Regex that matches the secret. Group 1 must be the value to redact. */
  pattern: RegExp;
}

/**
 * Each pattern captures the *value* portion in group 1 so we can replace
 * only the value while preserving the key name (aids debugging).
 */
const PATTERNS: RedactPattern[] = [
  // ---- Key=Value style (env files, config files) ----
  {
    name: 'API_KEY assignment',
    pattern: /\b(API_?KEY\s*[:=]\s*["']?)([A-Za-z0-9\-_.~+/]{4,})("?)/gi,
  },
  {
    name: 'APIKEY assignment',
    pattern: /\b(APIKEY\s*[:=]\s*["']?)([A-Za-z0-9\-_.~+/]{4,})("?)/gi,
  },
  {
    name: 'JWT assignment',
    pattern: /\b(JWT\s*[:=]\s*["']?)([A-Za-z0-9\-_.~+/]{4,})("?)/gi,
  },
  {
    name: 'DATABASE_URL assignment',
    pattern: /\b(DATABASE_URL\s*[:=]\s*["']?)([^\s"']{4,})("?)/gi,
  },
  {
    name: 'PRIVATE_KEY assignment',
    pattern: /\b(PRIVATE_KEY\s*[:=]\s*["']?)([^\s"']{4,})("?)/gi,
  },
  {
    name: 'PASSWORD assignment',
    pattern: /\b(password\s*[:=]\s*["']?)([^\s"']{4,})("?)/gi,
  },
  {
    name: 'SECRET assignment',
    pattern: /\b(secret\s*[:=]\s*["']?)([^\s"']{4,})("?)/gi,
  },
  {
    name: 'TOKEN assignment',
    pattern: /\b(token\s*[:=]\s*["']?)([A-Za-z0-9\-_.~+/]{4,})("?)/gi,
  },
  // ---- Bearer tokens in headers ----
  {
    name: 'Bearer token',
    pattern: /(Bearer\s+)([A-Za-z0-9\-_.~+/=]{20,})/gi,
  },
  // ---- Raw JWT (three base64url segments) ----
  {
    name: 'Raw JWT',
    pattern: /\b(eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]*)\b/g,
  },
  // ---- PEM private keys ----
  {
    name: 'PEM private key block',
    pattern: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----)/g,
  },
  // ---- AWS-style access key IDs ----
  {
    name: 'AWS access key',
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
  },
  // ---- Generic high-entropy hex strings (32+ chars) used as keys ----
  {
    name: 'High-entropy hex secret',
    pattern: /\b([0-9a-fA-F]{32,})\b/g,
  },
];

const REDACTED_MARKER = '[REDACTED]';

// ---------------------------------------------------------------------------
// SecretRedactor
// ---------------------------------------------------------------------------

export class SecretRedactor {
  /**
   * Scrub all detected credential patterns from `text`.
   *
   * For key=value patterns the key is preserved; only the value is replaced:
   *   `API_KEY=abc123` → `API_KEY=[REDACTED]`
   *
   * @param text  Raw source text, possibly containing secrets.
   * @returns     Sanitised copy of the text.
   */
  redact(text: string): string {
    let result = text;
    let redactedCount = 0;

    for (const { name, pattern } of PATTERNS) {
      // Reset lastIndex for global patterns (safety)
      pattern.lastIndex = 0;

      const before = result;
      // Use a replacer function so we can handle variable group layouts
      result = result.replace(pattern, (...args: unknown[]) => {
        const groups = args.slice(1, -2) as string[]; // capture groups
        const fullMatch = args[0] as string;

        if (groups.length === 0) {
          // No capture groups (e.g. raw JWT, PEM block, AWS key, hex)
          return REDACTED_MARKER;
        }

        if (groups.length === 1) {
          // Single-group: the whole secret
          return REDACTED_MARKER;
        }

        if (groups.length >= 2) {
          // group[0] = prefix (key + separator), group[1] = value, group[2] = suffix
          const prefix = groups[0] ?? '';
          const suffix = groups.length >= 3 ? (groups[2] ?? '') : '';
          return `${prefix}${REDACTED_MARKER}${suffix}`;
        }

        return fullMatch;
      });

      if (result !== before) {
        redactedCount += 1;
        process.stderr.write(
          `[secret-redactor] Redacted pattern "${name}"\n`,
        );
      }
    }

    if (redactedCount > 0) {
      process.stderr.write(
        `[secret-redactor] ${redactedCount} pattern(s) redacted from content\n`,
      );
    }

    return result;
  }

  /**
   * Quick check whether `text` contains any detectable secret patterns.
   * Does NOT modify the input.
   *
   * @param text  Text to inspect.
   * @returns     `true` if at least one pattern matches.
   */
  hasSecrets(text: string): boolean {
    for (const { pattern } of PATTERNS) {
      // Clone with same flags so we do not mutate `lastIndex`
      const clone = new RegExp(pattern.source, pattern.flags);
      if (clone.test(text)) {
        return true;
      }
    }
    return false;
  }
}
