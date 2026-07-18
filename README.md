# MSSQL Read-Only MCP Server for Claude Code

An MCP (Model Context Protocol) server that lets Claude Code run read-only queries against Microsoft SQL Server. Supports SQL auth and Azure AD. All connections use `ApplicationIntent=ReadOnly` and queries are validated to block any write operations.

Based on [bilims/mcp-sqlserver](https://github.com/bilims/mcp-sqlserver) with added Azure AD authentication, hardcoded read-only intent, and automatic schema caching.

## Tools

| Tool               | Purpose                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `execute_query`    | Run read-only SELECT queries. Automatically includes the full database schema on first call. |
| `list_tables`      | List all tables in a database or schema                                                      |
| `list_views`       | List all views in a database or schema                                                       |
| `describe_table`   | Get column details for a specific table                                                      |
| `get_foreign_keys` | Get foreign key relationships                                                                |
| `get_table_stats`  | Get row counts and table sizes                                                               |
| `list_databases`   | List all databases on the server                                                             |
| `get_server_info`  | Get SQL Server version and edition                                                           |
| `test_connection`  | Verify the connection works with a real `SELECT 1` round-trip (auto-recovers a faulted pool) |
| `reset_connection` | Force-rebuild the connection pool to recover from a connection fault without a restart        |
| `snapshot_schema`  | Force-regenerate the schema cache file                                                       |

## Read-Only Safety

Three independent layers prevent any write operations:

1. **Connection level** — `ApplicationIntent=ReadOnly` is hardcoded (routes to read replicas when available)
2. **Query validation** — Only `SELECT`/`WITH` (and `SHOW`/`DESCRIBE`/`EXPLAIN`) statements are allowed, and write/exec keywords (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `EXEC`, `GRANT`, etc.) and stacked statements are blocked. Validation runs against a structural skeleton (string literals and bracketed identifiers masked out), so legitimate read-only filters never trip a false positive
3. **Database permissions** — Use a `db_datareader`-only account for defense in depth

## Setup

### Prerequisites

- **Node.js 18+**
- **Claude Code**
- **Azure CLI** (only if using Azure AD auth): https://learn.microsoft.com/en-us/cli/azure/install-azure-cli

### Step 1: Clone, install, and build

```bash
git clone https://github.com/trainerroad/mcp-sqlserver.git ~/.claude/mcp-sqlserver
cd ~/.claude/mcp-sqlserver
npm install
npm run build
```

### Step 2: Choose your authentication method

#### Option A: Azure AD (recommended for Azure SQL)

1. Install the Azure CLI if you don't have it:
   ```bash
   # Windows (winget)
   winget install Microsoft.AzureCLI

   # macOS
   brew install azure-cli

   # Linux
   curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
   ```

2. Sign in with the account that has database access:
   ```bash
   az login
   ```

3. Create a connections file, e.g. `~/.config/mcp-sqlserver/connections.yaml`. Keep it out of source control — it holds credentials.

   ```yaml
   default: main
   # Optional: enrich the schema cache from a C# EF project
   # domainSourcePath: /path/to/your-csharp-project
   connections:
     main:
       host: your-server.database.windows.net
       database: your-database
       authMode: aad-default
       encrypt: true
       trustServerCertificate: false
   ```

   > **`domainSourcePath`** is optional. Set it to the root of a C# project that contains `EntityFramework/Domain/Configurations/` to enrich the schema cache with entity-to-table mappings, column renames, and relationship metadata. Omit it if you don't use EF configurations.

4. Register the MCP server, pointing it at the file:

   ```bash
   claude mcp add mssql-readonly -s user \
     -e SQLSERVER_CONFIG_FILE=~/.config/mcp-sqlserver/connections.yaml \
     -- node ~/.claude/mcp-sqlserver/dist/index.js
   ```

#### Option B: SQL Server authentication

Use the same steps, with a SQL-auth connection in the file:

```yaml
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

For on-premises SQL Server with self-signed certificates, set `trustServerCertificate: true`.

### Step 3: Verify

```bash
claude mcp list
```

Should show: `mssql-readonly: ... ✓ Connected`

### Step 4: Start a new Claude Code session

The MCP server only loads in **new** sessions. Try:
- *"Test the SQL Server connection"*
- *"List all tables in the database"*
- *"Show me the top 10 rows from the Users table"*

## Parameterized Queries

`execute_query` accepts an optional `params` object. Reference values as `@name`
placeholders in the query and pass them in `params`; the driver binds them
out-of-band, so they never become part of the SQL text:

```json
{
  "query": "SELECT * FROM Customer WHERE DATEDIFF(YEAR, LastActivity, @as_of) >= @years",
  "params": { "as_of": "2026-05-30", "years": 3 }
}
```

This is the recommended way to write tunable read-only queries — it keeps
constants out of the statement body and avoids any need for `DECLARE` (which is
blocked, along with all other write/exec keywords). Parameter names must be
valid SQL identifiers and values must be scalars (string, number, boolean, or
null).

## Schema Cache

On the first `execute_query` call in a session, the server automatically:

1. Checks for a cached schema file at `.schema-cache/<database-name>.md` (relative to the install directory)
2. If none exists, queries the database for all tables, columns, primary keys, and foreign keys
3. Writes a compact markdown cache file and includes it in the response

This means Claude Code gets full schema context on the first query — no extra tool calls needed. Subsequent queries in the same session skip the schema (already in context).

**To refresh the cache** after schema changes, call the `snapshot_schema` tool.

**To use a custom cache path**, add a `schemaCachePath` field to that connection in the config file.

### Domain Entity Mappings (Optional)

If you work with a C# project that uses Entity Framework, set the top-level `domainSourcePath` in the config file to the project root containing `EntityFramework/Domain/Configurations/` files. The schema cache will be enriched with:

- Entity-to-table name mappings (e.g., `WorkoutRecord` -> `CyclingActivity` table)
- Property-to-column renames
- Relationship navigation paths for JOIN construction
- TPH discriminator columns

This helps Claude translate domain concepts to accurate SQL queries.

## Configuration

The server is configured entirely by a single JSON or YAML file. Point at it with the **one** environment variable the server reads:

| Variable              | Required | Description                                                     |
| --------------------- | -------- | --------------------------------------------------------------- |
| `SQLSERVER_CONFIG_FILE` | Yes    | Path to a JSON/YAML file describing all connections (see below) |

Everything else — connections, the default connection, the optional EF domain source — lives in that file. `~` and relative paths are resolved (relative to the current working directory).

### Config file format

```yaml
# ~/.config/mcp-sqlserver/connections.yaml   (gitignored — holds credentials)

# Which connection tools use when no "connection" argument is given.
# Optional when only one connection is defined (it becomes the default).
default: crid

# Optional: C# project root with EF configurations, used to enrich the schema
# cache for every connection.
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
    maxRows: 5000
```

The file may be YAML (shown) or JSON — JSON is valid YAML, so both parse identically. A full annotated template is in [`examples/connections.example.yaml`](examples/connections.example.yaml).

**Top-level keys:** `default` (optional), `domainSourcePath` (optional), `connections` (required).

**Per-connection fields:** `host`/`server`, `database`, `authMode` (`sql` \| `aad-default` \| `aad-password` \| `aad-service-principal`), `user`, `password`, `clientId`, `clientSecret`, `tenantId`, `port` (default `1433`), `encrypt` (default `true`), `trustServerCertificate` (default `false`), `connectionTimeout` (ms, default `30000`), `requestTimeout` (ms, default `60000`), `maxRows` (default `1000`, up to 10,000), and an optional `schemaCachePath`.

## Multiple Connections

The server can register any number of named connections — just add more entries under `connections:`. Every tool accepts an optional `connection` argument to target one of them, and the `list_connections` tool reports what's configured. Connection names must be unique; a collision fails fast at startup. The `default:` field selects which one is used when no `connection` argument is given (or the sole connection, when only one is defined).

## Azure AD Auth Modes

Set `authMode` on the connection. Credentials come from the connection's fields in the config file:

| Mode                    | Use Case                        | Credential Source                                                             |
| ----------------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| `aad-default`           | Developer machines, Azure VMs   | `az login`, managed identity, env — tries multiple sources automatically      |
| `aad-password`          | Username/password with Azure AD | Requires `user`, `password`, `clientId`                                        |
| `aad-service-principal` | CI/CD, automation               | Requires `clientId`, `clientSecret`, `tenantId`                               |

## Troubleshooting

### Azure AD: "AADSTS" errors
- Run `az account show` to verify you're signed in with the correct account
- Run `az login` to re-authenticate if your token has expired
- Ensure your Azure AD account has been granted access to the database (`CREATE USER [user@domain.com] FROM EXTERNAL PROVIDER`)

### Connection refused / timeout
- Verify the server hostname and port are correct
- Check firewall rules — Azure SQL requires your IP to be allowed
- For Azure SQL, ensure `encrypt: true` and `trustServerCertificate: false` on the connection

### Permission errors on queries
- The account needs at minimum `db_datareader` role membership
- For schema discovery, access to `INFORMATION_SCHEMA` views and `sys.` catalog views is required

### Schema cache not generating
- Ensure the server process has write access to its install directory (or set a `schemaCachePath` in the config file pointing to a writable location)
- Check stderr output for errors: `claude mcp list` shows server logs on failure

---

## Claude Code Automated Setup Instructions

<!-- This section is for Claude Code to follow when a user asks it to set up this MCP server. -->

When a user asks you to set up this MCP server, follow these steps exactly:

### Step 1: Clone the repo

Clone into the user's Claude config directory:
- **Windows (Git Bash):** `~/.claude/mcp-sqlserver` resolves to `/c/Users/<username>/.claude/mcp-sqlserver`
- **macOS/Linux:** `~/.claude/mcp-sqlserver`

```bash
git clone https://github.com/trainerroad/mcp-sqlserver.git ~/.claude/mcp-sqlserver
```

If the directory already exists, run `git -C ~/.claude/mcp-sqlserver pull` instead.

### Step 2: Install dependencies and build

```bash
cd ~/.claude/mcp-sqlserver && npm install && npm run build
```

### Step 3: Determine auth method

Ask the user how they authenticate to their SQL Server:
- **Azure AD** — Continue to Step 3a.
- **SQL auth** — They need a username and password. Skip to Step 4.

### Step 3a: Verify Azure CLI is installed and signed in

Run `az --version` to check if the Azure CLI is installed. If the command is not found, stop and tell the user:

> **Azure CLI is required for Azure AD authentication but is not installed.**
> Install it from https://learn.microsoft.com/en-us/cli/azure/install-azure-cli
>
> Quick install commands:
> - **Windows:** `winget install Microsoft.AzureCLI`
> - **macOS:** `brew install azure-cli`
> - **Linux:** `curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash`
>
> After installing, restart your terminal and run this setup again.

Do NOT continue with the remaining steps until `az --version` succeeds.

Once Azure CLI is confirmed installed, run `az account show --query "{name:name, user:user.name}" -o table` to check the login status.

- If signed in, confirm the account shown is the one with database access. If not, tell the user to run `az login` and sign in with the correct account.
- If not signed in (error), tell the user to run `az login` and complete the browser sign-in flow, then re-run `az account show` to confirm.

### Step 4: Create the connections file

All connection details live in a JSON/YAML file — the server reads no other environment variables. Create one at `~/.config/mcp-sqlserver/connections.yaml` (keep it out of source control). If the user has a C# project with EF configurations, ask for the path and add a top-level `domainSourcePath:` — this is optional.

For Azure AD:
```yaml
default: main
# domainSourcePath: <path-to-csharp-project>   # optional
connections:
  main:
    host: <server>
    database: <database>
    authMode: aad-default
    encrypt: true
    trustServerCertificate: false
```

For SQL auth:
```yaml
default: main
# domainSourcePath: <path-to-csharp-project>   # optional
connections:
  main:
    host: <server>
    database: <database>
    user: <username>
    password: <password>
    encrypt: true
    trustServerCertificate: false
```

### Step 4b: Register the MCP server

Use the **absolute path** to the built entry point:
- **Windows:** `C:/Users/<username>/.claude/mcp-sqlserver/dist/index.js`
- **macOS:** `/Users/<username>/.claude/mcp-sqlserver/dist/index.js`
- **Linux:** `/home/<username>/.claude/mcp-sqlserver/dist/index.js`

```bash
claude mcp add mssql-readonly -s user \
  -e SQLSERVER_CONFIG_FILE=~/.config/mcp-sqlserver/connections.yaml \
  -- node <ABSOLUTE_PATH>/dist/index.js
```

### Step 5: Verify

Run `claude mcp list` and confirm the mssql-readonly server shows as connected.

Tell the user: **Setup complete! You must restart your Claude Code session for the MCP server to load. Start a new session and try "Test the SQL Server connection" or "List all tables in the database".**

Note: MCP servers are loaded at session startup. The server will NOT be available in the current session — the user must start a new one.

Note: The MCP server will only be available in **new** Claude Code sessions, not the current one.
