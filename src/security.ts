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

  private static stripComments(query: string): string {
    // Remove single-line comments (-- to end of line)
    let stripped = query.replace(/--[^\r\n]*/g, ' ');
    // Remove multi-line block comments (/* ... */) including nested content
    stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, ' ');
    return stripped;
  }

  /**
   * Reduce a query to its structural "skeleton": comments removed, string
   * literals and bracketed identifiers replaced with a neutral placeholder.
   *
   * All keyword/statement checks run against this skeleton so that the *content*
   * of a query (data inside quotes, columns named with brackets) can never trip
   * a check — e.g. WHERE note = 'we will DELETE this' or a [show] column. This
   * is what lets ordinary read-only filters through while still catching
   * forbidden keywords and multiple statements in the actual SQL structure.
   */
  private static toSkeleton(query: string): string {
    let s = this.stripComments(query);
    // Bracketed identifiers: [Order Details], [show], [a]]b] (]] is an escaped ])
    s = s.replace(/\[(?:[^\]]|\]\])*\]/g, ' ');
    // Single-quoted string literals, including '' escapes: 'O''Brien'
    s = s.replace(/'(?:[^']|'')*'/g, "''");
    return s;
  }

  private static normalizeForValidation(query: string): string {
    return this.toSkeleton(query).replace(/\s+/g, ' ').trim().toUpperCase();
  }

  static validateQuery(query: string): { isValid: boolean; error?: string } {
    const normalizedQuery = this.normalizeForValidation(query);

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
    for (const forbidden of this.FORBIDDEN_KEYWORDS) {
      const pattern = new RegExp(`\\b${forbidden}\\b`);
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