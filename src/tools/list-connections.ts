import { BaseTool } from './base.js';

export class ListConnectionsTool extends BaseTool {
  getName(): string {
    return 'list_connections';
  }

  getDescription(): string {
    return 'List the SQL Server connections configured for this MCP server. Use the returned name as the "connection" argument on other tools to target a specific server.';
  }

  getInputSchema(): any {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  async execute(): Promise<{
    defaultConnection: string;
    connections: Array<{ name: string; server: string; database: string | undefined; authMode: string; isDefault: boolean }>;
  }> {
    return {
      defaultConnection: this.registry.getDefaultName(),
      connections: this.registry.list(),
    };
  }
}
