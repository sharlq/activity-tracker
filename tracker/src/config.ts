// Loads /config/config.json. A bad config stops the tracker rather than falling
// back to defaults, because silently dropping exclusions would leak private data.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDomainEntry } from './browser.ts';

export interface Config {
  pollIntervalMs: number;
  idleThresholdMs: number;
  exclude: { apps: string[]; titleContains: string[]; domains: string[] };
  gaming: { games: string[] };
  browser: { fullUrlDomains: string[] };
  api: { port: number };
  /** Daily database copies: where (default: backups in the data folder) and how many to keep. */
  backup: { folder?: string; keep: number };
  /** Apps you read in (PDF readers), and how long without input there before you count as idle. */
  reading: { apps: string[]; idleThresholdMs: number };
}

export const DEFAULT_CONFIG: Config = {
  pollIntervalMs: 5000,
  idleThresholdMs: 120000,
  exclude: { apps: [], titleContains: [], domains: [] },
  gaming: { games: [] },
  browser: { fullUrlDomains: [] },
  api: { port: 5610 },
  backup: { keep: 14 },
  reading: { apps: ['FoxitPDFReader', 'Acrobat', 'AcroRd32', 'SumatraPDF', 'PDFXEdit'], idleThresholdMs: 600000 },
};

function backupSection(raw: Record<string, unknown>): Config['backup'] {
  const folder = raw['folder'];
  if (folder !== undefined && (typeof folder !== 'string' || folder.trim() === '')) throw new Error('backup.folder must be a folder path');
  const keep = raw['keep'] === undefined ? DEFAULT_CONFIG.backup.keep : raw['keep'];
  if (!Number.isInteger(keep) || (keep as number) < 1) throw new Error('backup.keep must be a whole number of 1 or more');
  return { ...(typeof folder === 'string' ? { folder: folder.trim() } : {}), keep: keep as number };
}

/** tracker/src and tracker/dist are the same depth, so these work from both. */
export const CONFIG_FILE = fileURLToPath(new URL('../../config/config.json', import.meta.url));
export const TOKEN_FILE = fileURLToPath(new URL('../../config/api-token.txt', import.meta.url));
export const CATEGORIES_FILE = fileURLToPath(new URL('../../config/categories.json', import.meta.url));

/** ACTIVITY_TRACKER_CATEGORIES lets a test run use its own rules. */
export function categoriesFile(): string {
  return process.env['ACTIVITY_TRACKER_CATEGORIES'] ?? CATEGORIES_FILE;
}

/** ACTIVITY_TRACKER_CONFIG lets a test run use its own settings without editing yours. */
export function configFile(): string {
  return process.env['ACTIVITY_TRACKER_CONFIG'] ?? CONFIG_FILE;
}

/** ACTIVITY_TRACKER_HOME exists so experiments can stay out of the real data. */
export function dataDir(): string {
  return process.env['ACTIVITY_TRACKER_HOME'] ?? join(homedir(), '.activity-tracker');
}

function positiveNumber(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function port(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    throw new Error(`${name} must be a whole number from 1 to 65535`);
  }
  return value as number;
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`${name} must be a list of non-empty strings`);
  }
  return value as string[];
}

function domainList(value: unknown, name: string): string[] {
  const domains = stringList(value, name);
  const bad = domains.find((entry) => /[/:\s]/.test(entry.trim()));
  if (bad) throw new Error(`${name} takes domains like "example.com", not "${bad}"`);
  return domains.map(normalizeDomainEntry);
}

function section(raw: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = raw[name];
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseConfig(text: string): Config {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('config must be a JSON object');
  }
  const root = raw as Record<string, unknown>;
  const exclude = section(root, 'exclude');
  return {
    pollIntervalMs: positiveNumber(root['pollIntervalMs'], 'pollIntervalMs', DEFAULT_CONFIG.pollIntervalMs),
    idleThresholdMs: positiveNumber(root['idleThresholdMs'], 'idleThresholdMs', DEFAULT_CONFIG.idleThresholdMs),
    exclude: {
      apps: stringList(exclude['apps'], 'exclude.apps'),
      titleContains: stringList(exclude['titleContains'], 'exclude.titleContains'),
      domains: domainList(exclude['domains'], 'exclude.domains'),
    },
    gaming: { games: stringList(section(root, 'gaming')['games'], 'gaming.games') },
    browser: {
      fullUrlDomains: domainList(section(root, 'browser')['fullUrlDomains'], 'browser.fullUrlDomains'),
    },
    api: { port: port(section(root, 'api')['port'], 'api.port', DEFAULT_CONFIG.api.port) },
    backup: backupSection(section(root, 'backup')),
    reading: readingSection(section(root, 'reading')),
  };
}

function readingSection(raw: Record<string, unknown>): Config['reading'] {
  return {
    apps: raw['apps'] === undefined ? DEFAULT_CONFIG.reading.apps : stringList(raw['apps'], 'reading.apps'),
    idleThresholdMs: positiveNumber(raw['idleThresholdMs'], 'reading.idleThresholdMs', DEFAULT_CONFIG.reading.idleThresholdMs),
  };
}

export function loadConfig(file: string = configFile()): Config {
  if (!existsSync(file)) return DEFAULT_CONFIG;
  try {
    return parseConfig(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid config at ${file}: ${(error as Error).message}`);
  }
}

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** The API token, created on first use. Delete the file to issue a new one. */
export function loadOrCreateToken(file: string = TOKEN_FILE): string {
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim();
    if (!TOKEN_PATTERN.test(token)) {
      throw new Error(`The API token in ${file} is malformed. Delete the file to create a new one.`);
    }
    return token;
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, `${token}\n`, { flag: 'wx' });
  return token;
}
