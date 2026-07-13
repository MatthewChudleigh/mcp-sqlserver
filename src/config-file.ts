import { readFileSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { ConnectionFileSchema, type ConnectionFile } from './types.js';

/**
 * Expand a leading `~` (home directory) in a path. Node does not do this
 * automatically, but config files commonly use `~/.config/...`.
 */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Resolve a user-supplied config path to an absolute path, expanding `~` and
 * resolving relative paths against the current working directory.
 */
export function resolveConfigPath(p: string): string {
  const expanded = expandHome(p);
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

/**
 * Read, parse (JSON or YAML) and validate the connections config file pointed to
 * by SQLSERVER_CONFIG_FILE. Throws a clear, path-qualified error on any failure
 * so misconfiguration surfaces at startup rather than on first query.
 */
export function loadConnectionFile(path: string): ConnectionFile {
  const resolved = resolveConfigPath(path);

  let text: string;
  try {
    text = readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new Error(`Could not read SQLSERVER_CONFIG_FILE at "${resolved}": ${(error as Error).message}`);
  }

  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (error) {
    throw new Error(`SQLSERVER_CONFIG_FILE ("${resolved}") is not valid JSON/YAML: ${(error as Error).message}`);
  }

  const result = ConnectionFileSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`SQLSERVER_CONFIG_FILE ("${resolved}") failed validation: ${issues}`);
  }

  if (Object.keys(result.data.connections).length === 0) {
    throw new Error(`SQLSERVER_CONFIG_FILE ("${resolved}") defines no connections`);
  }

  return result.data;
}
