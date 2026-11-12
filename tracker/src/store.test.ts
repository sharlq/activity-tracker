import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Activity } from './merger.ts';
import Database from 'better-sqlite3';
import { Store } from './store.ts';

const WINDOW: Activity = { kind: 'window', processName: 'a.exe', exePath: 'C:\\a.exe', title: 'Tïtle ✓' };

describe('Store', () => {
  let dir: string;
  let path: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracker-store-'));
    path = join(dir, 'data.db');
    store = new Store(path);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips window and idle events', () => {
    store.apply([{ type: 'start', activity: WINDOW, start: 10, end: 20 }]);
    store.apply([{ type: 'start', activity: { kind: 'idle' }, start: 20, end: 30 }]);
    assert.deepEqual(
      store.recent(10).map(({ activity, start, end }) => ({ activity, start, end })),
      [
        { activity: { kind: 'idle' }, start: 20, end: 30 },
        { activity: WINDOW, start: 10, end: 20 },
      ],
    );
  });

  it('setEnd only changes the newest event', () => {
    store.apply([
      { type: 'start', activity: WINDOW, start: 0, end: 5 },
      { type: 'start', activity: WINDOW, start: 5, end: 5 },
      { type: 'setEnd', end: 9 },
    ]);
    assert.deepEqual(store.recent(2).map((e) => e.end), [9, 5]);
  });

  it('applies a batch atomically, rolling all of it back on failure', () => {
    store.apply([{ type: 'start', activity: WINDOW, start: 0, end: 5 }]);
    assert.throws(() =>
      store.apply([
        { type: 'setEnd', end: 7 },
        { type: 'start', activity: WINDOW, start: 10, end: 1 }, // Violates end >= start.
      ]),
    );
    const events = store.recent(10);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.end, 5);
  });

  it('keeps events across reopening, with no repeated migration', () => {
    store.apply([{ type: 'start', activity: WINDOW, start: 0, end: 5 }]);
    store.close();
    store = new Store(path);
    assert.equal(store.lastEvent()?.end, 5);
  });

  it('round-trips domain and URL, and omits them when absent', () => {
    const site: Activity = { ...WINDOW, domain: 'github.com', url: 'https://github.com/x' };
    store.apply([
      { type: 'start', activity: site, start: 0, end: 5 },
      { type: 'start', activity: WINDOW, start: 5, end: 9 },
    ]);
    assert.deepEqual(store.recent(2).reverse().map((e) => e.activity), [site, WINDOW]);
  });

  it('round-trips project, language, and branch', () => {
    const code: Activity = { ...WINDOW, project: 'tracker', language: 'typescript', branch: 'main' };
    store.apply([{ type: 'start', activity: code, start: 0, end: 5 }]);
    assert.deepEqual(store.lastEvent()?.activity, code);
  });

  it('keeps what was on screen with idle events, and nothing when there was nothing', () => {
    const reading: Activity = { kind: 'idle', window: { processName: 'claude.exe', exePath: 'C:\\c\\claude.exe', title: 'Claude', domain: 'x.com' } };
    store.apply([
      { type: 'start', activity: reading, start: 0, end: 5 },
      { type: 'start', activity: { kind: 'idle' }, start: 5, end: 9 },
    ]);
    assert.deepEqual(store.recent(2).reverse().map((e) => e.activity), [reading, { kind: 'idle' }]);
  });

  it('upgrades a Phase 1 database without losing events', () => {
    store.close();
    rmSync(path);
    const old = new Database(path);
    old.exec(`CREATE TABLE events (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
      duration_ms INTEGER GENERATED ALWAYS AS (end_ms - start_ms) VIRTUAL,
      process_name TEXT, exe_path TEXT, title TEXT);
      INSERT INTO events (kind, start_ms, end_ms, process_name, exe_path, title)
        VALUES ('window', 0, 5, 'a.exe', 'C:\\a.exe', 'Old');
      PRAGMA user_version = 1;`);
    old.close();

    store = new Store(path);
    assert.deepEqual(store.lastEvent()?.activity, { kind: 'window', processName: 'a.exe', exePath: 'C:\\a.exe', title: 'Old' });
    store.apply([{ type: 'start', activity: { ...WINDOW, domain: 'x.com' }, start: 5, end: 6 }]);
    assert.equal((store.lastEvent()?.activity as { domain?: string }).domain, 'x.com');
  });

  it('purges only events that ended before the cutoff', () => {
    store.apply([
      { type: 'start', activity: WINDOW, start: 0, end: 99 },
      { type: 'start', activity: WINDOW, start: 50, end: 100 },
      { type: 'start', activity: WINDOW, start: 100, end: 200 },
    ]);
    assert.equal(store.purgeBefore(100), 1);
    assert.deepEqual(store.recent(10).map((e) => e.end), [200, 100]);
  });

  it('removes purged text from the database file itself', () => {
    const secret: Activity = { ...WINDOW, title: 'SECRET-PURGE-MARKER' };
    store.apply([
      { type: 'start', activity: secret, start: 0, end: 10 },
      { type: 'start', activity: WINDOW, start: 100, end: 200 },
    ]);
    store.purgeBefore(50);
    store.close();
    assert.ok(!readFileSync(path).includes('SECRET-PURGE-MARKER'));
    store = new Store(path);
  });
});
