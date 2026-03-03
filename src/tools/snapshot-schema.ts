import { BaseTool } from './base.js';
import { ErrorHandler } from '../errors.js';
import { SchemaCache } from '../schema-cache.js';

export class SnapshotSchemaTool extends BaseTool {
  private schemaCache: SchemaCache | null = null;

  setSchemaCache(cache: SchemaCache): void {
    this.schemaCache = cache;
  }

  getName(): string {
    return 'snapshot_schema';
  }

  getDescription(): string {
    return 'Regenerate the database schema cache file. Run this if the schema has changed. Returns the file path and stats.';
  }

  getInputSchema(): any {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  async execute(_params: Record<string, never>): Promise<{ path: string; tables: number; columns: number }> {
    if (!this.schemaCache) {
      throw new Error('Schema cache not configured. Set SQLSERVER_SCHEMA_CACHE_PATH environment variable.');
    }

    try {
      await this.connection.connect();

      const dbName = this.connection.getConfig().database ?? 'unknown';
      const queryFn = this.connection.query.bind(this.connection);
      const result = await this.schemaCache.generateSchema(queryFn, dbName);

      return {
        path: this.schemaCache.cachePath,
        tables: result.tables,
        columns: result.columns,
      };
    } catch (error) {
      const mcpError = ErrorHandler.handleSqlServerError(error);
      throw mcpError;
    }
  }
}
