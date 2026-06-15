import { BaseTool } from './base.js';

interface ResetConnectionResult {
  connectionName: string;
  reset: boolean;
  isConnected: boolean;
  resetTime: number;
  error?: string;
}

export class ResetConnectionTool extends BaseTool {
  getName(): string {
    return 'reset_connection';
  }

  getDescription(): string {
    return 'Force-rebuild the connection pool for a configured SQL Server connection. Use this to recover after a connection fault (e.g. a timeout or dropped network) when queries keep failing with "Connection is closed". Tears down the existing pool, opens a fresh one, and verifies it with a round-trip query.';
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

  async execute(params: { connection?: string } = {}): Promise<ResetConnectionResult> {
    const startTime = Date.now();
    const entry = this.resolveEntry(params.connection);
    const connection = entry.connection;
    const connectionName = params.connection ?? this.registry.getDefaultName();

    try {
      await connection.resetConnection();
      const isConnected = await connection.testConnection();
      return {
        connectionName,
        reset: true,
        isConnected,
        resetTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        connectionName,
        reset: false,
        isConnected: false,
        resetTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
