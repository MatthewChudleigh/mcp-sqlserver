#!/usr/bin/env node

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname, join as pathJoin } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '..', '.env') });

async function runServer() {
  try {
    const { handleCliArgs } = await import('./cli.js');
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const {
      CallToolRequestSchema,
      ListToolsRequestSchema,
    } = await import('@modelcontextprotocol/sdk/types.js');
    const { SqlServerConnection } = await import('./connection.js');
    const {
      ConnectionConfigSchema,
      NamedConnectionsMapSchema,
    } = await import('./types.js');
    const {
      ListDatabasesTool,
      ListTablesTool,
      ListViewsTool,
      DescribeTableTool,
      ExecuteQueryTool,
      GetForeignKeysTool,
      GetServerInfoTool,
      GetTableStatsTool,
      TestConnectionTool,
      SnapshotSchemaTool,
      ListConnectionsTool,
    } = await import('./tools/index.js');
    const { ErrorHandler } = await import('./errors.js');
    const { SchemaCache } = await import('./schema-cache.js');
    const { ConnectionRegistry } = await import('./connection-registry.js');

    type ConnConfig = import('./types.js').ConnectionConfig;
    type NamedInput = import('./types.js').NamedConnectionInput;

    const serverDir = dirname(fileURLToPath(import.meta.url));
    const cacheBaseDir = pathJoin(serverDir, '..', '.schema-cache');

    function buildSchemaCachePath(connectionName: string, dbName: string | undefined, override?: string): string {
      if (override) return override;
      const safeConn = connectionName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeDb = (dbName || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = connectionName === 'default' ? `${safeDb}.md` : `${safeConn}__${safeDb}.md`;
      return pathJoin(cacheBaseDir, filename);
    }

    function buildDefaultConfigFromEnv(): ConnConfig | null {
      if (!process.env.SQLSERVER_HOST) return null;
      const authMode = (process.env.SQLSERVER_AUTH_MODE || 'sql') as ConnConfig['authMode'];
      const config = {
        server: process.env.SQLSERVER_HOST,
        database: process.env.SQLSERVER_DATABASE,
        authMode,
        user: process.env.SQLSERVER_USER,
        password: process.env.SQLSERVER_PASSWORD,
        clientId: process.env.SQLSERVER_CLIENT_ID,
        clientSecret: process.env.SQLSERVER_CLIENT_SECRET,
        tenantId: process.env.SQLSERVER_TENANT_ID,
        port: parseInt(process.env.SQLSERVER_PORT || '1433'),
        encrypt: process.env.SQLSERVER_ENCRYPT !== 'false',
        trustServerCertificate: process.env.SQLSERVER_TRUST_CERT === 'true',
        connectionTimeout: parseInt(process.env.SQLSERVER_CONNECTION_TIMEOUT || '30000'),
        requestTimeout: parseInt(process.env.SQLSERVER_REQUEST_TIMEOUT || '60000'),
        maxRows: parseInt(process.env.SQLSERVER_MAX_ROWS || '1000'),
      };
      return ConnectionConfigSchema.parse(config);
    }

    function configFromNamedInput(name: string, input: NamedInput): ConnConfig {
      const server = input.server ?? input.host;
      if (!server) {
        throw new Error(`Connection "${name}" must specify "server" or "host"`);
      }
      const merged = {
        server,
        database: input.database,
        authMode: input.authMode ?? 'sql',
        user: input.user,
        password: input.password,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        tenantId: input.tenantId,
        port: input.port ?? 1433,
        encrypt: input.encrypt ?? true,
        trustServerCertificate: input.trustServerCertificate ?? false,
        connectionTimeout: input.connectionTimeout ?? 30000,
        requestTimeout: input.requestTimeout ?? 60000,
        maxRows: input.maxRows ?? 1000,
      };
      return ConnectionConfigSchema.parse(merged);
    }

    function buildRegistry(): { registry: InstanceType<typeof ConnectionRegistry>; maxRows: number } {
      const defaultName = process.env.SQLSERVER_DEFAULT_CONNECTION || 'default';
      const registry = new ConnectionRegistry(defaultName);

      const domainSourcePath = process.env.SQLSERVER_DOMAIN_SOURCE_PATH;
      if (domainSourcePath) {
        console.error(`Domain source: ${domainSourcePath}`);
      }

      let maxRowsForTools = 1000;

      const defaultConfig = buildDefaultConfigFromEnv();
      if (defaultConfig) {
        if (defaultConfig.authMode === 'sql' && (!defaultConfig.user || !defaultConfig.password)) {
          throw new Error('SQLSERVER_USER and SQLSERVER_PASSWORD are required for SQL auth mode on the default connection');
        }
        const conn = new SqlServerConnection(defaultConfig);
        const cachePath = buildSchemaCachePath('default', defaultConfig.database, process.env.SQLSERVER_SCHEMA_CACHE_PATH);
        const cache = new SchemaCache(cachePath, domainSourcePath);
        registry.register('default', conn, cache);
        maxRowsForTools = defaultConfig.maxRows ?? 1000;
        console.error(`Registered "default" -> ${defaultConfig.server}:${defaultConfig.port ?? 1433} (db: ${defaultConfig.database || 'default'}, auth: ${defaultConfig.authMode})`);
        console.error(`Schema cache (default): ${cachePath}`);
      }

      const connectionsRaw = process.env.SQLSERVER_CONNECTIONS;
      if (connectionsRaw) {
        const parsed = NamedConnectionsMapSchema.parse(JSON.parse(connectionsRaw));
        for (const [name, input] of Object.entries(parsed)) {
          if (registry.has(name)) {
            throw new Error(`Connection "${name}" is already defined (conflicts with default)`);
          }
          const cfg = configFromNamedInput(name, input);
          if (cfg.authMode === 'sql' && (!cfg.user || !cfg.password)) {
            throw new Error(`Connection "${name}" uses SQL auth and requires "user" and "password"`);
          }
          const conn = new SqlServerConnection(cfg);
          const cachePath = buildSchemaCachePath(name, cfg.database);
          const cache = new SchemaCache(cachePath, domainSourcePath);
          registry.register(name, conn, cache);
          if (defaultConfig === null && maxRowsForTools === 1000) {
            maxRowsForTools = cfg.maxRows ?? 1000;
          }
          console.error(`Registered "${name}" -> ${cfg.server}:${cfg.port ?? 1433} (db: ${cfg.database || 'default'}, auth: ${cfg.authMode})`);
          console.error(`Schema cache (${name}): ${cachePath}`);
        }
      }

      if (registry.size() === 0) {
        throw new Error('No SQL Server connections configured. Set SQLSERVER_HOST and/or SQLSERVER_CONNECTIONS.');
      }

      if (!registry.has(defaultName)) {
        throw new Error(`SQLSERVER_DEFAULT_CONNECTION="${defaultName}" does not match any registered connection`);
      }

      return { registry, maxRows: maxRowsForTools };
    }

    class SqlServerMCPServer {
      private server: typeof Server.prototype;
      private registry!: InstanceType<typeof ConnectionRegistry>;
      private tools: Map<string, any> = new Map();

      constructor() {
        this.server = new Server(
          {
            name: 'mcp-sqlserver',
            version: '2.1.0',
          },
          {
            capabilities: {
              tools: {},
            },
          }
        );

        this.setupErrorHandling();
        this.setupRequestHandlers();
      }

      private setupErrorHandling() {
        this.server.onerror = (error: Error) => {
          console.error('[MCP Error]', error);
        };

        process.on('SIGINT', async () => {
          await this.cleanup();
          process.exit(0);
        });

        process.on('SIGTERM', async () => {
          await this.cleanup();
          process.exit(0);
        });
      }

      private async cleanup() {
        if (this.registry) {
          await this.registry.disconnectAll();
        }
      }

      private setupRequestHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
          return {
            tools: Array.from(this.tools.values()).map(tool => ({
              name: tool.getName(),
              description: tool.getDescription(),
              inputSchema: tool.getInputSchema(),
            })),
          };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
          const { name, arguments: args } = request.params;

          if (!this.tools.has(name)) {
            throw new Error(`Unknown tool: ${name}`);
          }

          const tool = this.tools.get(name);

          try {
            const result = await tool.execute(args || {});
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (error) {
            const mcpError = ErrorHandler.handleSqlServerError(error);
            const userError = ErrorHandler.formatErrorForUser(mcpError);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: userError.error,
                    code: userError.code,
                    suggestions: userError.suggestions,
                  }, null, 2),
                },
              ],
              isError: true,
            };
          }
        });
      }

      private initializeTools(maxRows: number) {
        const toolClasses = [
          ListConnectionsTool,
          TestConnectionTool,
          ListDatabasesTool,
          ListTablesTool,
          ListViewsTool,
          DescribeTableTool,
          ExecuteQueryTool,
          GetForeignKeysTool,
          GetServerInfoTool,
          GetTableStatsTool,
          SnapshotSchemaTool,
        ];

        for (const ToolClass of toolClasses) {
          const tool = new ToolClass(this.registry, maxRows);
          this.tools.set(tool.getName(), tool);
        }
      }

      async initialize() {
        const { registry, maxRows } = buildRegistry();
        this.registry = registry;

        console.error(`MCP SQL Server initialized with ${registry.size()} connection(s); default: "${registry.getDefaultName()}"`);
        console.error(`ApplicationIntent: ReadOnly`);

        this.initializeTools(maxRows);
      }

      async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('MCP SQL Server running on stdio');
      }
    }

    async function main() {
      if (!handleCliArgs()) {
        return;
      }

      const server = new SqlServerMCPServer();

      try {
        await server.initialize();
        await server.run();
      } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
      }
    }

    await main();

  } catch (error) {
    console.error('Failed to start MCP server:', (error as Error).message);
    process.exit(1);
  }
}

runServer().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
