import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import type { Activity } from './merger.ts';
import { EventReader } from './reader.ts';
import { Store } from './store.ts';

const W: Activity = { kind: 'window', processName: 'a.exe', exePath: null, title: 'A', project: 'p' };

describe('EventReader', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracker-reader-'));
    path = join(dir, 'data.db');
    const store = new Store(path);
    store.apply([
      { type: 'start', activity: W, start: 0, end: 100 },
      { type: 'start', activity: { kind: 'idle' }, start: 100, end: 300 },
      { type: 'start', activity: W, start: 300, end: 400 },
    ]);
    store.close();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns events overlapping the window, clipped to it', () => {
    const reader = new EventReader(path);
    assert.deepEqual(reader.eventsBetween(50, 350).map((e) => [e.activity.kind, e.start, e.end]), [
      ['window', 50, 100],
      ['idle', 100, 300],
      ['window', 300, 350],
    ]);
    reader.close();
  });

  it('keeps extension details', () => {
    const reader = new EventReader(path);
    assert.deepEqual(reader.eventsBetween(0, 50)[0]?.activity, W);
    reader.close();
  });

  it('cannot write, even by accident', () => {
    const reader = new EventReader(path);
    const db = (reader as unknown as { db: Database.Database }).db;
    assert.throws(() => db.exec('DELETE FROM events'), /readonly/i);
    reader.close();
  });

  it('refuses to create a database that does not exist', () => {
    assert.throws(() => new EventReader(join(dir, 'missing.db')));
    assert.throws(() => statSync(join(dir, 'missing.db')));
  });

  it('reads a database from an older tracker without the newer columns', () => {
    const oldPath = join(dir, 'old.db');
    const old = new Database(oldPath);
    old.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY, kind TEXT, start_ms INTEGER, end_ms INTEGER,
      process_name TEXT, exe_path TEXT, title TEXT);
      INSERT INTO events (kind, start_ms, end_ms, process_name, exe_path, title) VALUES ('window', 0, 10, 'a.exe', null, 'A');`);
    old.close();
    const reader = new EventReader(oldPath);
    assert.deepEqual(reader.eventsBetween(0, 10)[0]?.activity, { kind: 'window', processName: 'a.exe', exePath: null, title: 'A' });
    reader.close();
  });
});
