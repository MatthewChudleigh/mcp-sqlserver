import { BaseTool } from './base.js';
import { DatabaseInfo } from '../types.js';

export class ListDatabasesTool extends BaseTool {
  getName(): string {
    return 'list_databases';
  }

  getDescription(): string {
    return 'List all databases on the SQL Server instance';
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

  async execute(params: { connection?: string } = {}): Promise<DatabaseInfo[]> {
    const query = `
      SELECT
        database_id,
        name,
        create_date,
        collation_name,
        state_desc
      FROM sys.databases
      WHERE state_desc = 'ONLINE'
      ORDER BY name
    `;

    return await this.executeSafeQuery<DatabaseInfo>(params.connection, query);
  }
}
