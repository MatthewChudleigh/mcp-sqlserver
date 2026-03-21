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

  private static normalizeForValidation(query: string): string {
    return this.stripComments(query).replace(/\s+/g, ' ').trim().toUpperCase();
  }

  static validateQuery(query: string): { isValid: boolean; error?: string } {
    const normalizedQuery = this.normalizeForValidation(query);

    if (!normalizedQuery) {
      return { isValid: false, error: 'Empty query not allowed' };
    }

    // Check if query starts with allowed statement
    const startsWithAllowed = this.ALLOWED_STATEMENTS.some(stmt =>
      normalizedQuery.startsWith(stmt)
    );

    if (!startsWithAllowed) {
      return {
        isValid: false,
        error: `Query must start with one of: ${this.ALLOWED_STATEMENTS.join(', ')}`,
      };
    }

    // Check for forbidden keywords using word-boundary matching to prevent
    // comment-based splits (e.g. INS/**/ERT is stripped to INSERT before this runs)
    for (const forbidden of this.FORBIDDEN_KEYWORDS) {
      const pattern = new RegExp(`\\b${forbidden}\\b`);
      if (pattern.test(normalizedQuery)) {
        return {
          isValid: false,
          error: `Forbidden keyword detected: ${forbidden}`,
        };
      }
    }

    // Additional injection pattern checks (run on comment-stripped, whitespace-normalised query)
    if (this.containsSqlInjectionPatterns(normalizedQuery)) {
      return {
        isValid: false,
        error: 'Potential SQL injection pattern detected',
      };
    }

    return { isValid: true };
  }

  private static containsSqlInjectionPatterns(query: string): boolean {
    const patterns = [
      // Multi-statement injection
      /;/,

      // UNION-based injection
      /\bUNION\b[\s\S]*\bSELECT\b/,

      // Boolean OR/AND injection — covers both quoted and numeric forms:
      //   ' OR '   ' OR 1   OR 1=1   OR 'a'='a'
      /'\s*OR\b/,
      /'\s*AND\b/,
      /\bOR\s+\d/,                  // OR 1=1, OR 0=0, OR 1--
      /\bAND\s+\d/,                 // AND 1=1

      // System variable access (@@version, @@servername, etc.)
      /@@/,

      // Character encoding used to bypass keyword filters
      /\bCHAR\s*\(/,
      /\bNCHAR\s*\(/,

      // Hex literals used for encoding payloads (0x41424344...)
      /0x[0-9a-f]{4,}/i,
    ];

    return patterns.some(pattern => pattern.test(query));
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