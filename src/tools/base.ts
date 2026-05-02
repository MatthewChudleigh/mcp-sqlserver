import { SqlServerConnection, QueryParam } from '../connection.js';
import { ConnectionRegistry, ConnectionEntry } from '../connection-registry.js';
import { QueryValidator } from '../security.js';
import { ErrorHandler } from '../errors.js';

export type { QueryParam };

export abstract class BaseTool {
  protected registry: ConnectionRegistry;
  protected maxRows: number;

  constructor(registry: ConnectionRegistry, maxRows: number = 1000) {
    this.registry = registry;
    this.maxRows = maxRows;
  }

  protected resolveEntry(connectionName?: string): ConnectionEntry {
    return this.registry.resolve(connectionName);
  }

  protected resolveConnection(connectionName?: string): SqlServerConnection {
    return this.registry.resolve(connectionName).connection;
  }

  protected getConnectionProperty(): { type: string; description: string } {
    return {
      type: 'string',
      description: `Optional name of the configured SQL Server connection to target. Defaults to "${this.registry.getDefaultName()}". Use list_connections to see available connections.`,
    };
  }

  protected async runQuery<T = any>(connection: SqlServerConnection, query: string): Promise<T[]> {
    const validation = QueryValidator.validateQuery(query);
    if (!validation.isValid) {
      throw new Error(`Query validation failed: ${validation.error}`);
    }
    const sanitizedQuery = QueryValidator.sanitizeQuery(query);
    const limitedQuery = QueryValidator.addRowLimit(sanitizedQuery, this.maxRows);
    const result = await connection.query<T>(limitedQuery);
    return result.recordset;
  }

  protected async executeSafeQuery<T = any>(connectionName: string | undefined, query: string): Promise<T[]> {
    const connection = this.resolveConnection(connectionName);
    try {
      await connection.connect();
      return await this.runQuery<T>(connection, query);
    } catch (error) {
      throw ErrorHandler.handleSqlServerError(error);
    }
  }

  protected async executeSafeQueryWithParams<T = any>(
    connectionName: string | undefined,
    query: string,
    inputs: QueryParam[],
  ): Promise<T[]> {
    const connection = this.resolveConnection(connectionName);
    try {
      await connection.connect();
      const result = await connection.queryWithParams<T>(query, inputs);
      return result.recordset;
    } catch (error) {
      throw ErrorHandler.handleSqlServerError(error);
    }
  }

  abstract getName(): string;
  abstract getDescription(): string;
  abstract getInputSchema(): any;
  abstract execute(params: any): Promise<any>;
}
