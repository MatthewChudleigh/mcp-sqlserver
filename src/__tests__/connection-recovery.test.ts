import { SqlServerConnection } from '../connection.js';
import { ErrorHandler, ConnectionError, TimeoutError, QueryError } from '../errors.js';

describe('SqlServerConnection.isConnectionLevelError', () => {
  const isConn = (e: unknown) => SqlServerConnection.isConnectionLevelError(e);

  it('detects faulted-pool errors by message', () => {
    expect(isConn(new Error('Connection is closed.'))).toBe(true);
    expect(isConn(new Error('Connection not yet open.'))).toBe(true);
    expect(isConn(new Error('Failed to connect to host:1433 - Could not connect (sequence)'))).toBe(true);
  });

  it('detects connection errors by mssql/tedious string code', () => {
    expect(isConn({ code: 'ECONNCLOSED', message: 'x' })).toBe(true);
    expect(isConn({ code: 'ETIMEOUT', message: 'x' })).toBe(true);
    expect(isConn({ code: 'ESOCKET', message: 'x' })).toBe(true);
    expect(isConn({ code: 'ENOTOPEN', message: 'x' })).toBe(true);
  });

  it('does NOT treat query/syntax errors as connection errors', () => {
    expect(isConn(new Error("Invalid object name 'Foo'."))).toBe(false);
    expect(isConn({ code: 208, message: 'Invalid object name' })).toBe(false);
    expect(isConn(new Error('Incorrect syntax near the keyword'))).toBe(false);
    expect(isConn(null)).toBe(false);
    expect(isConn(undefined)).toBe(false);
  });
});

describe('ErrorHandler classifies connection vs query errors', () => {
  it('maps a closed-connection error to ConnectionError, not QueryError', () => {
    const err = ErrorHandler.handleSqlServerError(new Error('Connection is closed.'));
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.code).toBe('CONNECTION_ERROR');
  });

  it('maps string code ECONNCLOSED to ConnectionError', () => {
    const err = ErrorHandler.handleSqlServerError({ code: 'ECONNCLOSED', message: 'socket closed' });
    expect(err).toBeInstanceOf(ConnectionError);
  });

  it('maps string code ETIMEOUT to TimeoutError', () => {
    const err = ErrorHandler.handleSqlServerError({ code: 'ETIMEOUT', message: 'timed out' });
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.code).toBe('TIMEOUT_ERROR');
  });

  it('still maps genuine query errors to QueryError', () => {
    const err = ErrorHandler.handleSqlServerError({ code: 8134, message: 'Divide by zero error encountered.' });
    expect(err).toBeInstanceOf(QueryError);
  });
});
