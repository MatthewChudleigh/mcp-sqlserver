import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { loadConnectionFile, expandHome, resolveConfigPath } from '../config-file.js';

describe('config-file loader', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-sqlserver-cfg-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, contents: string): string {
    const p = join(dir, name);
    writeFileSync(p, contents, 'utf8');
    return p;
  }

  it('parses a YAML connections file', () => {
    const p = write(
      'connections.yaml',
      [
        'default: crid',
        'connections:',
        '  crid:',
        '    host: db1.example.com',
        '    database: CRID',
        '    user: reader',
        '    password: secret',
        '    trustServerCertificate: true',
      ].join('\n'),
    );
    const cfg = loadConnectionFile(p);
    expect(cfg.default).toBe('crid');
    expect(cfg.connections.crid.host).toBe('db1.example.com');
    expect(cfg.connections.crid.trustServerCertificate).toBe(true);
  });

  it('parses a JSON connections file (JSON is valid YAML)', () => {
    const p = write(
      'connections.json',
      JSON.stringify({
        connections: { warehouse: { host: 'wh.example.com', user: 'u', password: 'p' } },
      }),
    );
    const cfg = loadConnectionFile(p);
    expect(cfg.connections.warehouse.host).toBe('wh.example.com');
  });

  it('accepts "server" as an alias for "host"', () => {
    const p = write('c.yaml', 'connections:\n  a:\n    server: s.example.com\n');
    const cfg = loadConnectionFile(p);
    expect(cfg.connections.a.server).toBe('s.example.com');
  });

  it('throws a path-qualified error when the file is missing', () => {
    expect(() => loadConnectionFile(join(dir, 'nope.yaml'))).toThrow(/Could not read SQLSERVER_CONFIG_FILE/);
  });

  it('throws when a connection has neither host nor server', () => {
    const p = write('c.yaml', 'connections:\n  a:\n    database: X\n');
    expect(() => loadConnectionFile(p)).toThrow(/failed validation/);
  });

  it('throws when there are no connections', () => {
    const p = write('c.yaml', 'connections: {}\n');
    expect(() => loadConnectionFile(p)).toThrow(/defines no connections/);
  });

  it('throws on malformed YAML', () => {
    const p = write('c.yaml', 'connections:\n  a:\n  : : :\n');
    expect(() => loadConnectionFile(p)).toThrow(/not valid JSON\/YAML|failed validation/);
  });

  it('expands a leading ~ to the home directory', () => {
    expect(expandHome('~')).toBe(homedir());
    expect(expandHome('~/foo')).toBe(join(homedir(), 'foo'));
    expect(expandHome('/abs/path')).toBe('/abs/path');
  });

  it('resolves relative paths against cwd', () => {
    const resolved = resolveConfigPath('some/rel.yaml');
    expect(resolved).toContain('rel.yaml');
    expect(resolved.startsWith(process.cwd())).toBe(true);
  });
});
