export class QueryValidator {
  private static readonly ALLOWED_STATEMENTS = [
    'SELECT',
    'WITH',
    'SHOW',
    'DESCRIBE',
    'EXPLAIN',
  ];

  private static readonly FORBIDDEN_KEYWORDS = [
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'CREATE',
    'ALTER',
    'TRUNCATE',
    'EXEC',
    'EXECUTE',
    'SP_',
    'XP_',
    'OPENROWSET',
    'OPENDATASOURCE',
    'BULK',
    'MERGE',
    'GRANT',
    'REVOKE',
    'DENY',
    'WAITFOR',   // time-based blind injection
    'DECLARE',   // variable declaration used in multi-step attacks
    'RECONFIGURE',
    'SHUTDOWN',
  ];

  /**
   * Reduce a query to its structural "skeleton": comments removed, string
   * literals and quoted/bracketed identifiers replaced with a neutral
   * placeholder.
   *
   * All keyword/statement checks run against this skeleton so that the *content*
   * of a query (data inside quotes, columns named with brackets) can never trip
   * a check — e.g. WHERE note = 'we will DELETE this' or a [show] column. This
   * is what lets ordinary read-only filters through while still catching
   * forbidden keywords and multiple statements in the actual SQL structure.
   *
   * This MUST be a single left-to-right scan that tracks quoting state. Doing it
   * as independent regex passes (strip comments, then mask literals) is unsound:
   * a `--` inside a string literal would swallow the rest of the line, so
   *
   *     SELECT * FROM t WHERE a = '--'; DROP TABLE users
   *
   * would reduce to `SELECT * FROM t WHERE a = ' ` — no semicolon, no DROP — and
   * validate clean, while the untouched original was handed to the driver.
   *
   * An unterminated literal, identifier or block comment is rejected outright
   * rather than guessed at: it cannot be reduced to a trustworthy skeleton.
   */
  private static toSkeleton(query: string): { ok: true; skeleton: string } | { ok: false; error: string } {
    // Delimited spans: opener -> [closer, escape-by-doubling, placeholder].
    // SQL Server has no backslash escapes; a delimiter is escaped by doubling it.
    const spans: Record<string, { close: string; placeholder: string; what: string }> = {
      "'": { close: "'", placeholder: "''", what: 'string literal' },
      '[': { close: ']', placeholder: ' ', what: 'bracketed identifier' },
      '"': { close: '"', placeholder: ' ', what: 'quoted identifier' },
    };

    let out = '';
    let i = 0;

    while (i < query.length) {
      const c = query[i];

      // Line comment: runs to end of line. Newline is preserved as a separator
      // so `SELECT 1 --\n; DROP` still exposes the `;`.
      if (c === '-' && query[i + 1] === '-') {
        i += 2;
        while (i < query.length && query[i] !== '\n' && query[i] !== '\r') i++;
        out += ' ';
        continue;
      }

      // Block comment. T-SQL nests these, so track depth.
      if (c === '/' && query[i + 1] === '*') {
        let depth = 1;
        i += 2;
        while (i < query.length && depth > 0) {
          if (query[i] === '/' && query[i + 1] === '*') { depth++; i += 2; }
          else if (query[i] === '*' && query[i + 1] === '/') { depth--; i += 2; }
          else i++;
        }
        if (depth > 0) return { ok: false, error: 'Unterminated block comment' };
        out += ' ';
        continue;
      }

      const span = spans[c];
      if (span) {
        i++;
        let closed = false;
        while (i < query.length) {
          if (query[i] === span.close) {
            if (query[i + 1] === span.close) { i += 2; continue; } // '' / ]] / "" escape
            i++;
            closed = true;
            break;
          }
          i++;
        }
        if (!closed) return { ok: false, error: `Unterminated ${span.what}` };
        out += span.placeholder;
        continue;
      }

      out += c;
      i++;
    }

    return { ok: true, skeleton: out };
  }

  static validateQuery(query: string): { isValid: boolean; error?: string } {
    const skeleton = this.toSkeleton(query);
    if (!skeleton.ok) {
      return { isValid: false, error: skeleton.error };
    }

    const normalizedQuery = skeleton.skeleton.replace(/\s+/g, ' ').trim().toUpperCase();

    if (!normalizedQuery) {
      return { isValid: false, error: 'Empty query not allowed' };
    }

    // Check if query starts with allowed statement
    const startsWithAllowed = this.ALLOWED_STATEMENTS.some(stmt =>
      new RegExp(`^${stmt}\\b`).test(normalizedQuery)
    );

    if (!startsWithAllowed) {
      return {
        isValid: false,
        error: `Query must start with one of: ${this.ALLOWED_STATEMENTS.join(', ')}`,
      };
    }

    // Check for forbidden write/exec keywords using word-boundary matching.
    // Runs on the skeleton, so a forbidden word appearing only inside a string
    // literal or identifier (data, not a statement) is not flagged.
    //
    // SP_ / XP_ are procedure-name *prefixes*, not whole words: a trailing \b
    // after the underscore can never match (`_` is a word char, so `\bXP_\b`
    // requires a non-word char after `_` and so never fires on xp_cmdshell).
    // Match the rest of the identifier instead.
    for (const forbidden of this.FORBIDDEN_KEYWORDS) {
      const pattern = forbidden.endsWith('_')
        ? new RegExp(`\\b${forbidden}\\w*`)
        : new RegExp(`\\b${forbidden}\\b`);
      if (pattern.test(normalizedQuery)) {
        return {
          isValid: false,
          error: `Forbidden keyword detected: ${forbidden}`,
        };
      }
    }

    // Reject multiple statements (e.g. SELECT ... ; DROP ...). A single trailing
    // semicolon is fine — it is stripped before execution by sanitizeQuery.
    // Checked on the skeleton so semicolons inside string literals don't count.
    if (/;/.test(normalizedQuery.replace(/;+\s*$/, ''))) {
      return {
        isValid: false,
        error: 'Multiple statements are not allowed',
      };
    }

    return { isValid: true };
  }

  static sanitizeQuery(query: string): string {
    return query
      .trim()
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/;$/, '');    // Remove trailing semicolon
  }

  static addRowLimit(query: string, maxRows: number): string {
    // Match existing TOP clause with a numeric literal: TOP n or TOP(n)
    const topPattern = /\bTOP(\s*\(?\s*)(\d+)(\s*\)?)/i;
    const topMatch = topPattern.exec(query);

    if (topMatch) {
      const requestedRows = parseInt(topMatch[2], 10);
      if (requestedRows <= maxRows) {
        return query; // Already within limit
      }
      // Cap to maxRows, preserving any surrounding parentheses/whitespace
      return (
        query.slice(0, topMatch.index) +
        'TOP' + topMatch[1] + maxRows + topMatch[3] +
        query.slice(topMatch.index + topMatch[0].length)
      );
    }

    // No numeric TOP clause — inject one after SELECT
    return query.replace(
      /^(\s*SELECT\s+)/i,
      `$1TOP ${maxRows} `
    );
  }
}