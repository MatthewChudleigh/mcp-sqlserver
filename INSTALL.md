# Installation Guide

This guide helps you install and configure the MCP SQL Server for use with Claude Desktop, Claude Code CLI, and other MCP-compatible applications.

## Prerequisites

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **SQL Server access** with read permissions
- **Claude Desktop** or other MCP-compatible client

## Step-by-Step Installation

### 1. Install the Package

Choose one of these methods:

#### Global Installation (Recommended for most users)
```bash
npm install -g @bilims/mcp-sqlserver
```
✅ **Pros**: Available system-wide, easy to use
❌ **Cons**: Requires admin permissions on some systems

#### Local Installation
```bash
npm install @bilims/mcp-sqlserver
```
✅ **Pros**: No admin permissions needed
❌ **Cons**: Must use `npx` to run

#### Direct Run (No Installation)
```bash
npx @bilims/mcp-sqlserver
```
✅ **Pros**: No installation required
❌ **Cons**: Downloads package each time

### 2. Verify Installation

```bash
# For global installation
mcp-sqlserver --help

# For local installation  
npx mcp-sqlserver --help

# You should see usage information if installed correctly
```

### 3. Create the Connections File

All configuration now lives in a single JSON or YAML file. Point the `SQLSERVER_CONFIG_FILE` environment variable at it; the server reads no other per-connection environment variables.

```bash
export SQLSERVER_CONFIG_FILE="~/.config/mcp-sqlserver/connections.yaml"
```

Create the file it points at (YAML shown here since it allows comments):
```yaml
# ~/.config/mcp-sqlserver/connections.yaml   (gitignored — holds credentials)
default: main
connections:
  main:
    host: your-server.database.windows.net
    database: your-database
    user: your-username
    password: your-password
    encrypt: true
    trustServerCertificate: false   # set true for self-signed certificates
```

The same file may be written as JSON, in which case booleans and numbers are real JSON literals:
```json
{
  "default": "main",
  "connections": {
    "main": {
      "host": "your-server.database.windows.net",
      "database": "your-database",
      "user": "your-username",
      "password": "your-password",
      "encrypt": true,
      "trustServerCertificate": false
    }
  }
}
```

### 4. Test the Connection

```bash
# Point at your connections file first
export SQLSERVER_CONFIG_FILE="~/.config/mcp-sqlserver/connections.yaml"

# Test the connection
mcp-sqlserver
```

You should see:
```
MCP SQL Server initialized for your-server:1433
Database: your-database, User: your-username
MCP SQL Server running on stdio
```

## Client Configuration

### Claude Desktop

1. **Find your config file:**
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\\Claude\\claude_desktop_config.json`

2. **Add the server configuration:**
```json
{
  "mcpServers": {
    "sqlserver": {
      "command": "mcp-sqlserver",
      "env": {
        "SQLSERVER_CONFIG_FILE": "~/.config/mcp-sqlserver/connections.yaml"
      }
    }
  }
}
```

With a corresponding connections file:
```yaml
# ~/.config/mcp-sqlserver/connections.yaml   (gitignored — holds credentials)
default: main
connections:
  main:
    host: your-server.database.windows.net
    database: your-database
    user: your-username
    password: your-password
    encrypt: true
    trustServerCertificate: false
```

3. **Restart Claude Desktop**

4. **Test in Claude:**
   - "Test the SQL Server connection"
   - "List all databases"
   - "Show tables in the database"

### Claude Code CLI

```bash
# Add to Claude Code, pointing at your connections file
claude mcp add sqlserver mcp-sqlserver -e SQLSERVER_CONFIG_FILE=~/.config/mcp-sqlserver/connections.yaml
```

The connections file it references:
```yaml
# ~/.config/mcp-sqlserver/connections.yaml   (gitignored — holds credentials)
default: main
connections:
  main:
    host: your-server
    database: your-database
    user: your-username
    password: your-password
```

### VSCode

1. Install the MCP extension for VSCode
2. Add server configuration in VSCode settings
3. Reference the `mcp-sqlserver` command

## Common Configuration Examples

These are entries for your `SQLSERVER_CONFIG_FILE` connections file.

### Azure SQL Database
```yaml
connections:
  main:
    host: your-server.database.windows.net
    port: 1433
    encrypt: true
    trustServerCertificate: false
```

### On-Premises SQL Server with Self-Signed Certificate
```yaml
connections:
  main:
    host: sql-server.company.com
    port: 1433
    encrypt: true
    trustServerCertificate: true
```

### SQL Server Express (Local Development)
```yaml
connections:
  main:
    host: localhost\SQLEXPRESS
    port: 1433
    encrypt: false
    trustServerCertificate: true
```

### Docker SQL Server
```yaml
connections:
  main:
    host: localhost
    port: 1433
    user: sa
    encrypt: false
    trustServerCertificate: true
```

## Configuration Reference

The server reads exactly one environment variable:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SQLSERVER_CONFIG_FILE` | ✅ | - | Path to the JSON/YAML connections file |

Everything else is expressed as fields inside that file. Top-level keys are `default` (optional connection name; when only one connection is defined it becomes the default automatically), `domainSourcePath` (optional), and `connections` (required — a map of name → connection). Each connection accepts:

| Field | Default | Description |
|-------|---------|-------------|
| `host` (or `server`) | - | SQL Server hostname or IP |
| `user` | - | Database username |
| `password` | - | Database password |
| `database` | `master` | Default database |
| `authMode` | `sql` | `sql`, `aad-default`, `aad-password`, or `aad-service-principal` |
| `clientId` | - | AAD application (client) ID |
| `clientSecret` | - | AAD client secret |
| `tenantId` | - | AAD tenant ID |
| `port` | `1433` | SQL Server port (number) |
| `encrypt` | `true` | Enable TLS encryption (boolean) |
| `trustServerCertificate` | `false` | Trust server certificate (boolean; set `true` for self-signed certs) |
| `connectionTimeout` | `30000` | Connection timeout in ms (number) |
| `requestTimeout` | `60000` | Query timeout in ms (number) |
| `maxRows` | `1000` | Max rows per query (number) |
| `schemaCachePath` | - | Path to the schema cache for this connection |

## Troubleshooting

### Installation Issues

**"npm command not found"**
- Install Node.js from [nodejs.org](https://nodejs.org/)

**"Permission denied"**
- Use `sudo` for global installation: `sudo npm install -g ...`
- Or use local installation instead

**"Package not found"**
- Ensure you're using the correct package name: `@modelcontextprotocol/server-sqlserver`

### Connection Issues

**"Failed to connect"**
1. Verify server hostname and port
2. Check network connectivity: `telnet your-server 1433`
3. Verify SQL Server is running and accepting connections
4. Check firewall settings

**"Login failed"**
1. Verify username and password
2. Check if SQL Server authentication is enabled
3. Ensure user has necessary permissions

**"Certificate validation failed"**
- Set `trustServerCertificate: true` on the connection for self-signed certificates
- For production: Use proper SSL certificates

**"Timeout errors"**
- Increase `connectionTimeout` on the connection
- Check network latency
- Verify SQL Server performance

### Permission Issues

**"Permission denied on database"**
- Grant `db_datareader` role to user
- Ensure user has `CONNECT` permission

**"Invalid object name"**
- Check table exists in specified database
- Verify schema names are correct
- Ensure user has access to system views

## Support

- **Documentation**: See README.md for detailed usage
- **Examples**: Check the `examples/` directory
- **Issues**: Report problems on GitHub
- **Security**: Only use read-only database accounts

## Next Steps

1. ✅ Install the package
2. ✅ Create the connections file
3. ✅ Test connection
4. ✅ Configure your MCP client
5. 🎉 Start exploring your databases with AI!

Happy querying! 🚀