import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { backUp, listBackups } from './backup.ts';
import { parseConfig } from './config.ts';

describe('backups', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-backup-'));
    dbPath = join(dir, 'data.db');
    const db = new Database(dbPath);
    db.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('kept')");
    db.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies the database once a day and keeps only the newest few', async () => {
    const folder = join(dir, 'backups');
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']) assert.ok(await backUp(dbPath, folder, day, 3));
    assert.equal(await backUp(dbPath, folder, '2026-11-04', 3), null, 'a day that has a copy is skipped');
    assert.deepEqual(listBackups(folder).map((b) => b.day), ['2026-11-04', '2026-11-03', '2026-11-02']);

    const copy = new Database(join(folder, 'data-2026-11-04.db'), { readonly: true });
    assert.equal((copy.prepare('SELECT x FROM t').get() as { x: string }).x, 'kept');
    copy.close();
  });

  it('reads the backup settings, with sensible defaults', () => {
    assert.deepEqual(parseConfig('{}').backup, { keep: 14 });
    assert.deepEqual(parseConfig('{"backup":{"folder":"D:\\\\Raqib","keep":30}}').backup, { folder: 'D:\\Raqib', keep: 30 });
    assert.throws(() => parseConfig('{"backup":{"keep":0}}'), /backup.keep/);
  });
});
