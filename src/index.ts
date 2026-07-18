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
      ResetConnectionTool,
      SnapshotSchemaTool,
      ListConnectionsTool,
    } = await import('./tools/index.js');
    const { ErrorHandler } = await import('./errors.js');
    const { SchemaCache } = await import('./schema-cache.js');
    const { ConnectionRegistry } = await import('./connection-registry.js');
    const { loadConnectionFile } = await import('./config-file.js');

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
      // All configuration lives in the SQLSERVER_CONFIG_FILE (JSON/YAML): it is the
      // single source of truth for connections, the default connection, and the
      // optional EF domain source. Nothing is read from other environment variables.
      const configFilePath = process.env.SQLSERVER_CONFIG_FILE;
      if (!configFilePath) {
        throw new Error('SQLSERVER_CONFIG_FILE is not set. Point it at a JSON/YAML file describing your connections (see examples/connections.example.yaml).');
      }
      const fileConfig = loadConnectionFile(configFilePath);
      console.error(`Loaded connection config file: ${configFilePath}`);

      // The default connection comes from the file's "default" field, or is the
      // sole connection when only one is defined.
      const connectionNames = Object.keys(fileConfig.connections);
      const defaultName =
        fileConfig.default ?? (connectionNames.length === 1 ? connectionNames[0] : undefined);
      if (!defaultName) {
        throw new Error(`Config file "${configFilePath}" defines multiple connections but no "default"; add a top-level "default:" naming one of: ${connectionNames.join(', ')}`);
      }
      const registry = new ConnectionRegistry(defaultName);

      const domainSourcePath = fileConfig.domainSourcePath;
      if (domainSourcePath) {
        console.error(`Domain source: ${domainSourcePath}`);
      }

      // Register one named connection from a NamedConnectionInput.
      function registerNamed(name: string, input: NamedInput, source: string): void {
        if (registry.has(name)) {
          throw new Error(`Connection "${name}" from ${source} conflicts with an already-registered connection`);
        }
        const cfg = configFromNamedInput(name, input);
        if (cfg.authMode === 'sql' && (!cfg.user || !cfg.password)) {
          throw new Error(`Connection "${name}" uses SQL auth and requires "user" and "password"`);
        }
        const conn = new SqlServerConnection(cfg);
        const cachePath = buildSchemaCachePath(name, cfg.database, input.schemaCachePath);
        const cache = new SchemaCache(cachePath, domainSourcePath);
        registry.register(name, conn, cache);
        console.error(`Registered "${name}" -> ${cfg.server}:${cfg.port ?? 1433} (db: ${cfg.database || 'default'}, auth: ${cfg.authMode})`);
        console.error(`Schema cache (${name}): ${cachePath}`);
      }

      for (const [name, input] of Object.entries(fileConfig.connections)) {
        registerNamed(name, input, 'SQLSERVER_CONFIG_FILE');
      }

      if (!registry.has(defaultName)) {
        throw new Error(`Default connection "${defaultName}" does not match any registered connection`);
      }

      // A single global row cap is applied to every tool; take it from whichever
      // connection is the default.
      const maxRows = registry.resolve(defaultName).connection.getConfig().maxRows ?? 1000;

      return { registry, maxRows };
    }

    class SqlServerMCPServer {
      private server: typeof Server.prototype;
      private registry!: InstanceType<typeof ConnectionRegistry>;
      private tools: Map<string, any> = new Map();

      constructor() {
        this.server = new Server(
          {
            name: 'mcp-sqlserver',
            version: '3.0.0',
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
          ResetConnectionTool,
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
