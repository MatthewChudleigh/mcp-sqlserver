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
      /;/,                          // Any semicolon — blocks multi-statement injection
      /\bUNION\b[\s\S]*\bSELECT\b/, // UNION-based injection (dotall via [\s\S])
      /'\s*OR\s*'/,                 // OR injection
      /'\s*AND\s*'/,                // AND injection
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
    const normalizedQuery = query.trim().toUpperCase();
    
    // If query already has TOP clause, don't modify
    if (normalizedQuery.includes('TOP ')) {
      return query;
    }

    // Add TOP clause after SELECT
    return query.replace(
      /^(\s*SELECT\s+)/i,
      `$1TOP ${maxRows} `
    );
  }
}