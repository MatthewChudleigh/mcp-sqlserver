import { BaseTool } from './base.js';

interface ConnectionTestResult {
  isConnected: boolean;
  connectionName?: string;
  serverInfo?: {
    serverName: string;
    version: string;
    edition: string;
  };
  database?: string;
  connectionTime?: number;
  error?: string;
  details?: {
    canExecuteQueries: boolean;
    hasSystemAccess: boolean;
    encryptionEnabled: boolean;
  };
}

export class TestConnectionTool extends BaseTool {
  getName(): string {
    return 'test_connection';
  }

  getDescription(): string {
    return 'Test the SQL Server connection and validate permissions';
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

  async execute(params: { connection?: string } = {}): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const entry = this.resolveEntry(params.connection);
    const connection = entry.connection;
    const connectionName = params.connection ?? this.registry.getDefaultName();

    const result: ConnectionTestResult = {
      isConnected: false,
      connectionName,
    };

    try {
      await connection.connect();
      const connectionTime = Date.now() - startTime;

      result.isConnected = true;
      result.connectionTime = connectionTime;

      try {
        const serverQuery = `
          SELECT
            @@SERVERNAME as serverName,
            @@VERSION as version,
            SERVERPROPERTY('Edition') as edition,
            DB_NAME() as currentDatabase,
            CASE WHEN ENCRYPT_OPTION = 'TRUE' THEN 1 ELSE 0 END as encryptionEnabled
          FROM (SELECT 'TRUE' as ENCRYPT_OPTION) as dummy
        `;

        const serverInfo = await this.runQuery(connection, serverQuery);
        if (serverInfo.length > 0) {
          const info = serverInfo[0];
          result.serverInfo = {
            serverName: info.serverName,
            version: info.version,
            edition: info.edition,
          };
          result.database = info.currentDatabase;
        }
      } catch (error) {
        result.error = `Failed to get server info: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }

      const details = {
        canExecuteQueries: false,
        hasSystemAccess: false,
        encryptionEnabled: false,
      };

      try {
        await this.runQuery(connection, 'SELECT 1 as test');
        details.canExecuteQueries = true;
      } catch {
        // ignore
      }

      try {
        await this.runQuery(connection, 'SELECT TOP 1 name FROM sys.databases');
        details.hasSystemAccess = true;
      } catch {
        // ignore
      }

      try {
        const encQuery = await this.runQuery(connection, "SELECT ENCRYPT_OPTION() as encryption_status");
        details.encryptionEnabled = encQuery.length > 0;
      } catch {
        // ignore
      }

      result.details = details;
    } catch (error) {
      result.isConnected = false;
      result.connectionTime = Date.now() - startTime;

      if (error instanceof Error) {
        const message = error.message;
        if (message.includes('Login failed')) {
          result.error = 'Authentication failed: Invalid username or password';
        } else if (message.includes('server was not found')) {
          result.error = 'Connection failed: Server not found or not accessible';
        } else if (message.includes('timeout')) {
          result.error = 'Connection failed: Timeout occurred';
        } else if (message.includes('SSL')) {
          result.error = 'Connection failed: SSL/Encryption configuration issue';
        } else if (message.includes('certificate')) {
          result.error = 'Connection failed: Certificate validation issue';
        } else {
          result.error = `Connection failed: ${message}`;
        }
      } else {
        result.error = 'Connection failed: Unknown error';
      }
    }

    return result;
  }
}
