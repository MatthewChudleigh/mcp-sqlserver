import { BaseTool } from './base.js';
import { ErrorHandler } from '../errors.js';

export class SnapshotSchemaTool extends BaseTool {
  getName(): string {
    return 'snapshot_schema';
  }

  getDescription(): string {
    return 'Regenerate the database schema cache file. Run this if the schema has changed. Returns the file path and stats.';
  }

  getInputSchema(): any {
    return {
      type: 'object',
      properties: {
        connection: this.getConnectionProperty(),
      },
      required: [],
    };
  }

  async execute(params: { connection?: string } = {}): Promise<{ path: string; tables: number; columns: number }> {
    const entry = this.resolveEntry(params.connection);
    const connection = entry.connection;
    const schemaCache = entry.schemaCache;

    try {
      await connection.connect();

      const dbName = connection.getConfig().database ?? 'unknown';
      const queryFn = connection.query.bind(connection);
      const result = await schemaCache.generateSchema(queryFn, dbName);

      return {
        path: schemaCache.cachePath,
        tables: result.tables,
        columns: result.columns,
      };
    } catch (error) {
      throw ErrorHandler.handleSqlServerError(error);
    }
  }
}
