---
description: Run a read-only SQL query against the configured SQL Server
argument-hint: <SQL SELECT statement>
---

Execute the following read-only SQL query using the `sqlserver` MCP server's query tool and present the results as a markdown table:

```sql
$ARGUMENTS
```

If the statement is not a SELECT/CTE read query, refuse and explain why.
