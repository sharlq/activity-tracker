// Daily copies of the database, so a corrupt file, a bad purge, or a mistake
// never costs more than a day. The copy is taken with SQLite's online backup,
// which is safe while the tracker keeps writing.
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { dataDir } from './config.ts';

const NAME = /^data-(\d{4}-\d{2}-\d{2})\.db$/;

export function backupFolder(config: Pick<Config, 'backup'>): string {
  return config.backup.folder ?? join(dataDir(), 'backups');
}

export interface BackupFile {
  day: string;
  path: string;
  bytes: number;
}

/** The backups in a folder, newest first. */
export function listBackups(folder: string): BackupFile[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .map((name) => ({ name, match: NAME.exec(name) }))
    .filter((f): f is { name: string; match: RegExpExecArray } => f.match !== null)
    .map(({ name, match }) => ({ day: match[1] as string, path: join(folder, name), bytes: statSync(join(folder, name)).size }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * Copies the database to `data-<day>.db` in `folder`, then keeps only the newest
 * `keep` copies. Skips a day that already has one unless `replace`. Resolves to the
 * file written, or null when skipped.
 */
export async function backUp(dbPath: string, folder: string, day: string, keep: number, replace = false): Promise<string | null> {
  const target = join(folder, `data-${day}.db`);
  if (!replace && existsSync(target)) return null;
  mkdirSync(folder, { recursive: true });
  const partial = `${target}.partial`;
  rmSync(partial, { force: true });
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(partial);
  } finally {
    db.close();
  }
  renameSync(partial, target);
  for (const old of listBackups(folder).slice(Math.max(1, keep))) rmSync(old.path, { force: true });
  return target;
}
