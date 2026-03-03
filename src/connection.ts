import sql from 'mssql';
import { ConnectionConfig } from './types.js';

export class SqlServerConnection {
  private pool: sql.ConnectionPool | null = null;
  private config: ConnectionConfig;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.pool) {
      return;
    }

    const sqlConfig: sql.config = {
      server: this.config.server,
      database: this.config.database,
      port: this.config.port,
      options: {
        encrypt: this.config.encrypt,
        trustServerCertificate: this.config.trustServerCertificate,
        connectTimeout: this.config.connectionTimeout,
        requestTimeout: this.config.requestTimeout,
        readOnlyIntent: true,
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
          throw new Error('aad-password requires SQLSERVER_USER, SQLSERVER_PASSWORD, and SQLSERVER_CLIENT_ID');
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
          throw new Error('aad-service-principal requires SQLSERVER_CLIENT_ID, SQLSERVER_CLIENT_SECRET, and SQLSERVER_TENANT_ID');
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

    this.pool = new sql.ConnectionPool(sqlConfig);
    await this.pool.connect();
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }

  async query<T = any>(queryText: string): Promise<sql.IResult<T>> {
    if (!this.pool) {
      throw new Error('Database connection not established');
    }

    const request = this.pool.request();
    return await request.query(queryText);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
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