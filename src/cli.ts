#!/usr/bin/env node

import { ConnectionConfigSchema, NamedConnectionsMapSchema } from './types.js';

function showHelp() {
  console.log(`
MCP SQL Server - A read-only Model Context Protocol server for Microsoft SQL Server

USAGE:
  mcp-sqlserver [options]

ENVIRONMENT VARIABLES (default connection):
  SQLSERVER_HOST       SQL Server hostname (required unless SQLSERVER_CONNECTIONS is set)
  SQLSERVER_USER       Database username (required for SQL auth)
  SQLSERVER_PASSWORD   Database password (required for SQL auth)
  SQLSERVER_DATABASE   Database name (optional, default: master)
  SQLSERVER_PORT       Port number (optional, default: 1433)
  SQLSERVER_ENCRYPT    Enable encryption (optional, default: true)
  SQLSERVER_TRUST_CERT Trust server certificate (optional, default: false)

ADDITIONAL CONNECTIONS:
  SQLSERVER_CONNECTIONS  JSON object mapping connection name -> connection config.
                         Each entry accepts the same fields as the default
                         connection (server/host, user, password, database, port,
                         encrypt, trustServerCertificate, authMode, etc.).
  SQLSERVER_DEFAULT_CONNECTION  Optional name of the connection to treat as the
                                default. If unset, the SQLSERVER_HOST connection
                                is registered as "default".

  Tools accept an optional "connection" argument to target a specific server.
  Use the list_connections tool to discover configured names.

EXAMPLE:
  export SQLSERVER_HOST="primary.example.com"
  export SQLSERVER_USER="reader"
  export SQLSERVER_PASSWORD="secret"
  export SQLSERVER_CONNECTIONS='{
    "warehouse": {
      "host": "warehouse.example.com",
      "user": "reader",
      "password": "secret",
      "database": "DataWarehouse"
    }
  }'
  mcp-sqlserver

AVAILABLE TOOLS:
  list_connections    - List configured SQL Server connections
  test_connection     - Test SQL Server connection and permissions
  list_databases      - List all databases on the server
  list_tables         - List tables in a database or schema
  list_views          - List views in a database or schema
  describe_table      - Get detailed table schema
  execute_query       - Execute read-only SELECT queries
  get_foreign_keys    - Get foreign key relationships
  get_server_info     - Get SQL Server version and edition info
  get_table_stats     - Get table statistics and row counts
  snapshot_schema     - Regenerate the cached schema markdown

SECURITY:
  - Only read-only operations are allowed
  - SQL injection protection enabled
  - Query validation and sanitization
  - Row limits and timeouts enforced

For more information, visit: https://github.com/MatthewChudleigh/mcp-sqlserver
`);
}

function showVersion() {
  console.log('2.2.1');
}

function validateEnvironment(): boolean {
  const hasDefaultHost = Boolean(process.env.SQLSERVER_HOST);
  const connectionsRaw = process.env.SQLSERVER_CONNECTIONS;

  if (!hasDefaultHost && !connectionsRaw) {
    console.error('❌ No SQL Server connection configured.');
    console.error('   Set SQLSERVER_HOST (and credentials) for a single/default connection,');
    console.error('   and/or SQLSERVER_CONNECTIONS (JSON) to register additional named connections.');
    return false;
  }

  if (hasDefaultHost) {
    const authMode = process.env.SQLSERVER_AUTH_MODE || 'sql';
    const required = ['SQLSERVER_HOST'];
    if (authMode === 'sql') {
      required.push('SQLSERVER_USER', 'SQLSERVER_PASSWORD');
    }
    const missing = required.filter(env => !process.env[env]);
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables for the default connection:');
      missing.forEach(env => console.error(`   ${env}`));
      return false;
    }

    try {
      ConnectionConfigSchema.parse({
        server: process.env.SQLSERVER_HOST!,
        authMode: authMode as 'sql' | 'aad-default' | 'aad-password' | 'aad-service-principal',
        user: process.env.SQLSERVER_USER,
        password: process.env.SQLSERVER_PASSWORD,
        clientId: process.env.SQLSERVER_CLIENT_ID,
        clientSecret: process.env.SQLSERVER_CLIENT_SECRET,
        tenantId: process.env.SQLSERVER_TENANT_ID,
        database: process.env.SQLSERVER_DATABASE,
        port: parseInt(process.env.SQLSERVER_PORT || '1433'),
        encrypt: process.env.SQLSERVER_ENCRYPT !== 'false',
        trustServerCertificate: process.env.SQLSERVER_TRUST_CERT === 'true',
      });
    } catch (error) {
      console.error('❌ Invalid default connection configuration:', error);
      return false;
    }
  }

  if (connectionsRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(connectionsRaw);
    } catch (error) {
      console.error('❌ SQLSERVER_CONNECTIONS is not valid JSON:', (error as Error).message);
      return false;
    }
    try {
      NamedConnectionsMapSchema.parse(parsed);
    } catch (error) {
      console.error('❌ Invalid SQLSERVER_CONNECTIONS schema:', error);
      return false;
    }
  }

  return true;
}

export function handleCliArgs(): boolean {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return false;
  }

  if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    return false;
  }

  if (!validateEnvironment()) {
    process.exit(1);
  }

  return true;
}
