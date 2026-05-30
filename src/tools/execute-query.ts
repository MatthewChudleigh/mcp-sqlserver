import { BaseTool } from './base.js';
import { QueryResult } from '../types.js';
import { ParameterValidator } from '../validation.js';
import { ErrorHandler } from '../errors.js';

export class ExecuteQueryTool extends BaseTool {
  getName(): string {
    return 'execute_query';
  }

  getDescription(): string {
    return 'Execute a read-only SELECT query against the database. On first call, the full schema is included in the response for context.';
  }

  getInputSchema(): any {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL SELECT query to execute (read-only operations only). Use @name placeholders for any values and pass them via "params" instead of inlining literals.',
        },
        params: {
          type: 'object',
          description: 'Optional named parameters bound to @name placeholders in the query (e.g. {"as_of":"2026-05-30","years":3}). Values bind out-of-band and never enter the SQL text — the safe replacement for DECLARE/inline literals.',
          additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
        },
        limit: {
          type: 'number',
          description: 'Maximum number of rows to return (optional)',
          minimum: 1,
          maximum: 10000,
        },
        connection: this.getConnectionProperty(),
      },
      required: ['query'],
    };
  }

  async execute(params: { query: string; params?: Record<string, unknown>; limit?: number; connection?: string }): Promise<QueryResult & { schemaCachedAt?: string }> {
    const validatedParams = ParameterValidator.validateQueryParameters(params);
    const { query, limit, namedParams } = validatedParams;
    const maxRows = limit;

    const startTime = Date.now();

    const entry = this.resolveEntry(params.connection);
    const connection = entry.connection;
    const schemaCache = entry.schemaCache;

    try {
      await connection.connect();

      let schemaCachedAt: string | undefined;
      try {
        const dbName = connection.getConfig().database ?? 'unknown';
        const queryFn = connection.query.bind(connection);
        const schemaResult = await schemaCache.ensureCached(queryFn, dbName);
        if (schemaResult) {
          schemaCachedAt = schemaResult;
        }
      } catch (schemaError) {
        console.error('Warning: Failed to load schema cache:', schemaError);
      }

      const originalMaxRows = this.maxRows;
      this.maxRows = maxRows;

      const result = await this.runQuery(connection, query, namedParams);
      const executionTime = Date.now() - startTime;

      this.maxRows = originalMaxRows;

      const columns = result.length > 0 ? Object.keys(result[0]) : [];
      const rows = result.map(row => columns.map(col => row[col]));

      const response: QueryResult & { schemaCachedAt?: string } = {
        columns,
        rows,
        rowCount: result.length,
        executionTime,
      };

      if (schemaCachedAt) {
        response.schemaCachedAt = schemaCachedAt;
      }

      return response;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const mcpError = ErrorHandler.handleSqlServerError(error);
      mcpError.message = `${mcpError.message} (execution time: ${executionTime}ms)`;
      throw mcpError;
    }
  }
}
