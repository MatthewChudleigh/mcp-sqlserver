# MCP SQL Server - Quick Start Guide

## 🚀 Get Started in 3 Minutes

### 1. Install
```bash
npm install -g @bilims/mcp-sqlserver
```

### 2. Configure Claude Desktop
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
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

Then create the connections file it points at:
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

### 3. Test in Claude Desktop
```
"Test the SQL Server connection"
```

## 📋 Essential Commands

### First Time Setup
- `"Test the SQL Server connection"`
- `"Show me server information"`
- `"List all databases"`

### Database Discovery
- `"What tables are in this database?"`
- `"Describe the Users table structure"`
- `"Show me foreign key relationships"`

### Data Exploration
- `"Give me a sample from the Orders table"`
- `"What are the largest tables?"`
- `"Show me tables with the most rows"`

## 🔧 Common Configurations

The MCP client config always points at the connections file:
```json
"env": {
  "SQLSERVER_CONFIG_FILE": "~/.config/mcp-sqlserver/connections.yaml"
}
```

Pick the matching connection entry for that file:

### Azure SQL Database
```yaml
connections:
  main:
    host: myserver.database.windows.net
    encrypt: true
    trustServerCertificate: false
```

### On-Premises SQL Server
```yaml
connections:
  main:
    host: sql-server.company.com
    encrypt: true
    trustServerCertificate: true
```

### Local SQL Server Express
```yaml
connections:
  main:
    host: localhost\SQLEXPRESS
    encrypt: false
    trustServerCertificate: true
```

## 🛠️ Available Tools

| Tool | Purpose |
|------|---------|
| `test_connection` | Test connectivity and permissions |
| `list_databases` | Show all databases |
| `list_tables` | Show tables in database/schema |
| `describe_table` | Get table structure details |
| `execute_query` | Run SELECT queries safely |
| `get_foreign_keys` | Show table relationships |
| `get_server_info` | Get SQL Server version info |
| `get_table_stats` | Get table size and row counts |

## 🔒 Security Features

✅ **Read-only operations only**  
✅ **SQL injection protection**  
✅ **Query validation**  
✅ **Encrypted connections**  
✅ **Row limits enforced**  

## 🆘 Troubleshooting

### Connection Failed
1. Check server hostname/IP
2. Verify username/password
3. Confirm network access
4. Check firewall settings

### Permission Denied
1. Ensure user has SELECT permissions
2. Check database exists
3. Verify schema access

### Slow Queries
1. Use LIMIT in queries
2. Focus on specific tables
3. Check table sizes first

## 📚 More Help

- **Full Documentation**: [README.md](./README.md)
- **Usage Examples**: [examples/usage-examples.md](./examples/usage-examples.md)
- **Installation Guide**: [INSTALL.md](./INSTALL.md)
- **GitHub**: https://github.com/bilims/mcp-sqlserver
- **npm**: https://www.npmjs.com/package/@bilims/mcp-sqlserver

---

**Need help?** Open an issue on [GitHub](https://github.com/bilims/mcp-sqlserver/issues)