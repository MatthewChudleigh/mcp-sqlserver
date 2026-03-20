import { SqlServerConnection, QueryParam } from '../connection.js';
import { QueryValidator } from '../security.js';
import { ErrorHandler } from '../errors.js';

export type { QueryParam };

export abstract class BaseTool {
  protected connection: SqlServerConnection;
  protected maxRows: number;

  constructor(connection: SqlServerConnection, maxRows: number = 1000) {
    this.connection = connection;
    this.maxRows = maxRows;
  }

  protected async executeQuery<T = any>(query: string): Promise<T[]> {
    const validation = QueryValidator.validateQuery(query);
    if (!validation.isValid) {
      throw new Error(`Query validation failed: ${validation.error}`);
    }

    const sanitizedQuery = QueryValidator.sanitizeQuery(query);
    const limitedQuery = QueryValidator.addRowLimit(sanitizedQuery, this.maxRows);

    const result = await this.connection.query<T>(limitedQuery);
    return result.recordset;
  }

  protected async executeSafeQuery<T = any>(query: string): Promise<T[]> {
    try {
      await this.connection.connect();
      return await this.executeQuery<T>(query);
    } catch (error) {
      const mcpError = ErrorHandler.handleSqlServerError(error);
      throw mcpError;
    }
  }

  protected async executeSafeQueryWithParams<T = any>(query: string, inputs: QueryParam[]): Promise<T[]> {
    try {
      await this.connection.connect();
      const result = await this.connection.queryWithParams<T>(query, inputs);
      return result.recordset;
    } catch (error) {
      const mcpError = ErrorHandler.handleSqlServerError(error);
      throw mcpError;
    }
  }

  abstract getName(): string;
  abstract getDescription(): string;
  abstract getInputSchema(): any;
  abstract execute(params: any): Promise<any>;
}