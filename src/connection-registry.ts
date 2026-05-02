import { SqlServerConnection } from './connection.js';
import { SchemaCache } from './schema-cache.js';

export interface ConnectionEntry {
  connection: SqlServerConnection;
  schemaCache: SchemaCache;
}

export class ConnectionRegistry {
  private entries = new Map<string, ConnectionEntry>();
  private defaultName: string;

  constructor(defaultName: string = 'default') {
    this.defaultName = defaultName;
  }

  register(name: string, connection: SqlServerConnection, schemaCache: SchemaCache): void {
    if (this.entries.has(name)) {
      throw new Error(`Connection "${name}" is already registered`);
    }
    this.entries.set(name, { connection, schemaCache });
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  resolve(name?: string): ConnectionEntry {
    const key = name && name.length > 0 ? name : this.defaultName;
    const entry = this.entries.get(key);
    if (!entry) {
      const available = Array.from(this.entries.keys()).join(', ') || '(none)';
      throw new Error(`Unknown connection "${key}". Available connections: ${available}`);
    }
    return entry;
  }

  list(): Array<{ name: string; server: string; database: string | undefined; authMode: string; isDefault: boolean }> {
    return Array.from(this.entries.entries()).map(([name, entry]) => {
      const cfg = entry.connection.getConfig();
      return {
        name,
        server: cfg.server,
        database: cfg.database,
        authMode: cfg.authMode ?? 'sql',
        isDefault: name === this.defaultName,
      };
    });
  }

  getDefaultName(): string {
    return this.defaultName;
  }

  size(): number {
    return this.entries.size;
  }

  async disconnectAll(): Promise<void> {
    for (const { connection } of this.entries.values()) {
      try {
        await connection.disconnect();
      } catch (error) {
        console.error('Error during disconnect:', error);
      }
    }
  }
}
