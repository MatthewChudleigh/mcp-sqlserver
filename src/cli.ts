#!/usr/bin/env node

import { loadConnectionFile } from './config-file.js';

function showHelp() {
  console.log(`
MCP SQL Server - A read-only Model Context Protocol server for Microsoft SQL Server

USAGE:
  mcp-sqlserver [options]

CONFIGURATION:
  SQLSERVER_CONFIG_FILE  (required) Path to a JSON or YAML file describing every
                         connection. This is the only configuration input — all
                         connections, the default connection, and the optional EF
                         domain source live in this one file.

  Tools accept an optional "connection" argument to target a specific server.
  Use the list_connections tool to discover configured names.

EXAMPLE:
  export SQLSERVER_CONFIG_FILE="~/.config/mcp-sqlserver/connections.yaml"
  mcp-sqlserver

  # connections.yaml
  default: crid
  # Optional: path to a C# project root with EF configurations to enrich the cache
  # domainSourcePath: /path/to/csharp-project
  connections:
    crid:
      host: db1.example.com
      database: CRID
      user: CridReadOnly
      password: secret
      trustServerCertificate: true
      # Optional per-connection schema cache override:
      # schemaCachePath: /path/to/crid.md
    warehouse:
      host: warehouse.example.com
      database: DataWarehouse
      user: reader
      password: secret

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
  console.log('3.0.0');
}

function validateEnvironment(): boolean {
  const configFilePath = process.env.SQLSERVER_CONFIG_FILE;

  if (!configFilePath) {
    console.error('❌ No SQL Server connection configured.');
    console.error('   Set SQLSERVER_CONFIG_FILE to the path of a JSON/YAML connections file.');
    console.error('   See examples/connections.example.yaml for the format.');
    return false;
  }

  try {
    loadConnectionFile(configFilePath);
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    return false;
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
