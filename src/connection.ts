import sql from 'mssql';
import type { SecureVersion } from 'tls';
import { ConnectionConfig } from './types.js';

const VALID_TLS_VERSIONS: ReadonlyArray<SecureVersion> = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];

function parseTlsMinVersion(value: string | undefined, fallback: SecureVersion): SecureVersion {
  return VALID_TLS_VERSIONS.includes(value as SecureVersion) ? (value as SecureVersion) : fallback;
}

export { sql };
export type QueryParam = { name: string; type: sql.ISqlType | sql.ISqlTypeFactoryWithNoParams; value: unknown };

export class SqlServerConnection {
  private pool: sql.ConnectionPool | null = null;
  private config: ConnectionConfig;
  private connectPromise: Promise<void> | null = null;

  /**
   * mssql/tedious string error codes that mean the failure was at the
   * transport/connection layer (not a query/permission error) and the pooled
   * connection is therefore dead. These are retryable after a pool rebuild.
   */
  private static readonly CONNECTION_ERROR_CODES = new Set([
    'ECONNCLOSED',
    'ENOTOPEN',
    'ENOCONN',
    'ESOCKET',
    'ETIMEOUT',
    'ECONNRESET',
    'ELOGIN',
  ]);

  /**
   * True when the error indicates a dead/faulted connection rather than a
   * problem with the query itself. Used to decide whether to discard the pool
   * and retry, and to classify errors for callers.
   */
  static isConnectionLevelError(error: unknown): boolean {
    if (!error) {
      return false;
    }
    const e = error as { code?: unknown; message?: unknown };
    if (typeof e.code === 'string' && SqlServerConnection.CONNECTION_ERROR_CODES.has(e.code)) {
      return true;
    }
    const message = (typeof e.message === 'string' ? e.message : String(error)).toLowerCase();
    return (
      message.includes('connection is closed') ||
      message.includes('connection not yet open') ||
      message.includes('connection lost') ||
      message.includes('connection closed') ||
      message.includes('socket hang up') ||
      message.includes('not connected') ||
      message.includes('failed to connect') ||
      message.includes('could not connect')
    );
  }

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  private buildSqlConfig(): sql.config {
    const sqlConfig: sql.config = {
      server: this.config.server,
      database: this.config.database,
      port: this.config.port,
      options: {
        encrypt: this.config.encrypt,
        trustServerCertificate: this.config.trustServerCertificate,
        connectTimeout: this.config.connectionTimeout,
        requestTimeout: this.config.requestTimeout,
        readOnlyIntent: process.env.SQLSERVER_READONLY_INTENT === 'true',
        cryptoCredentialsDetails: {
          minVersion: parseTlsMinVersion(process.env.SQLSERVER_TLS_MIN_VERSION, 'TLSv1.2'),
          ciphers: process.env.SQLSERVER_TLS_CIPHERS ?? 'DEFAULT@SECLEVEL=0',
        },
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };

    const authMode = this.config.authMode ?? 'sql';
    switch (authMode) {
      case 'sql':
        sqlConfig.user = this.config.user;
        sqlConfig.password = this.config.password;
        break;
      case 'aad-default': {
        const aadOptions: { clientId?: string } = {};
        if (this.config.clientId) {
          aadOptions.clientId = this.config.clientId;
        }
        (sqlConfig as any).authentication = {
          type: 'azure-active-directory-default',
          options: aadOptions,
        };
        break;
      }
      case 'aad-password': {
        if (!this.config.user || !this.config.password || !this.config.clientId) {
          throw new Error('aad-password requires "user", "password", and "clientId"');
        }
        (sqlConfig as any).authentication = {
          type: 'azure-active-directory-password',
          options: {
            userName: this.config.user,
            password: this.config.password,
            clientId: this.config.clientId,
            tenantId: this.config.tenantId ?? '',
          },
        };
        break;
      }
      case 'aad-service-principal': {
        if (!this.config.clientId || !this.config.clientSecret || !this.config.tenantId) {
          throw new Error('aad-service-principal requires "clientId", "clientSecret", and "tenantId"');
        }
        (sqlConfig as any).authentication = {
          type: 'azure-active-directory-service-principal-secret',
          options: {
            clientId: this.config.clientId,
            clientSecret: this.config.clientSecret,
            tenantId: this.config.tenantId,
          },
        };
        break;
      }
    }

    return sqlConfig;
  }

  /**
   * Ensure a live, connected pool exists. Returns immediately when the current
   * pool is connected. If the pool is faulted/closed (e.g. after a connect
   * timeout) it is discarded and a fresh one is opened. Concurrent callers share
   * a single in-flight connect attempt.
   */
  async connect(): Promise<void> {
    if (this.pool && this.pool.connected) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = this.establishPool();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async establishPool(): Promise<void> {
    // Discard any existing (faulted) pool before building a new one.
    await this.destroyPool();

    const pool = new sql.ConnectionPool(this.buildSqlConfig());
    // A pool-level 'error' event with no listener is thrown as an unhandled
    // exception by tedious and would crash the process. Swallow it here; the
    // faulted pool is detected and rebuilt on the next connect()/query().
    pool.on('error', (err: unknown) => {
      console.error('SQL pool error:', err instanceof Error ? err.message : err);
    });

    try {
      await pool.connect();
    } catch (error) {
      // Failed to open — make sure we don't keep a half-built pool around.
      try {
        await pool.close();
      } catch {
        // ignore close errors on an unopened pool
      }
      throw error;
    }

    this.pool = pool;
  }

  private async destroyPool(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    if (pool) {
      try {
        await pool.close();
      } catch {
        // ignore — the pool may already be faulted/closed
      }
    }
  }

  /**
   * Tear down and rebuild the pool. Exposed so an explicit reset_connection tool
   * (or test_connection recovery) can force a fresh connection after a fault.
   */
  async resetConnection(): Promise<void> {
    await this.destroyPool();
    await this.connect();
  }

  async disconnect(): Promise<void> {
    await this.destroyPool();
  }

  /**
   * Run a request against a live pool, transparently recovering from a
   * dead/faulted connection: on a connection-level error the pool is discarded,
   * re-opened, and the request retried exactly once. Query/permission errors are
   * not retried — they surface immediately.
   */
  private async runWithRecovery<T>(
    fn: (pool: sql.ConnectionPool) => Promise<sql.IResult<T>>,
  ): Promise<sql.IResult<T>> {
    await this.connect();
    try {
      return await fn(this.pool!);
    } catch (error) {
      if (!SqlServerConnection.isConnectionLevelError(error)) {
        throw error;
      }
      // The pooled connection is dead — rebuild and retry once.
      await this.destroyPool();
      await this.connect();
      return await fn(this.pool!);
    }
  }

  async query<T = any>(queryText: string): Promise<sql.IResult<T>> {
    return this.runWithRecovery<T>(pool => pool.request().query(queryText));
  }

  async queryWithParams<T = any>(
    queryText: string,
    inputs: Array<{ name: string; type: sql.ISqlType | sql.ISqlTypeFactoryWithNoParams; value: unknown }>,
  ): Promise<sql.IResult<T>> {
    return this.runWithRecovery<T>(pool => {
      const request = pool.request();
      for (const input of inputs) {
        request.input(input.name, input.type, input.value);
      }
      return request.query(queryText);
    });
  }

  /**
   * Run a query binding named parameters out-of-band. Each entry binds to an
   * `@name` placeholder in the query; the mssql driver sends values separately
   * from the SQL text (and infers the type from the value), so they can never
   * change the query's structure. This is the safe replacement for inlining
   * literals or DECLARE-ing variables in the statement body.
   */
  async queryWithNamedParams<T = any>(
    queryText: string,
    params: Record<string, unknown>,
  ): Promise<sql.IResult<T>> {
    return this.runWithRecovery<T>(pool => {
      const request = pool.request();
      for (const [name, value] of Object.entries(params)) {
        request.input(name, value);
      }
      return request.query(queryText);
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.query('SELECT 1 as test');
      return result.recordset.length > 0;
    } catch (error) {
      return false;
    }
  }

  isConnected(): boolean {
    return this.pool !== null && this.pool.connected;
  }

  getConfig(): Readonly<ConnectionConfig> {
    return { ...this.config };
  }
}