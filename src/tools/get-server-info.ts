import { BaseTool } from './base.js';
import { ServerInfo } from '../types.js';

export class GetServerInfoTool extends BaseTool {
  getName(): string {
    return 'get_server_info';
  }

  getDescription(): string {
    return 'Get SQL Server instance information including version, edition, and configuration';
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

  async execute(params: { connection?: string } = {}): Promise<ServerInfo> {
    const query = `
      SELECT
        @@SERVERNAME as server_name,
        @@VERSION as product_version,
        SERVERPROPERTY('ProductLevel') as product_level,
        SERVERPROPERTY('Edition') as edition,
        SERVERPROPERTY('EngineEdition') as engine_edition
    `;

    const result = await this.executeSafeQuery<ServerInfo>(params.connection, query);
    return result[0];
  }
}
