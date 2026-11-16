import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { convexMutation, GYM_SYNC_GAP_MS, gymSyncer, loadGymTarget, restFrom } from './gymSync.ts';
import { Logger } from './logger.ts';

const KEY = 'k'.repeat(24);

function folder(): string {
  return mkdtempSync(join(tmpdir(), 'gym-sync-'));
}

test('loadGymTarget: no file is off, a good file is read, a bad one says what is wrong', () => {
  const dir = folder();
  try {
    assert.equal(loadGymTarget(dir), null);
    writeFileSync(join(dir, 'gym-sync.json'), JSON.stringify({ url: 'https://a-b-1.convex.cloud/', syncKey: KEY }));
    assert.deepEqual(loadGymTarget(dir), { url: 'https://a-b-1.convex.cloud', syncKey: KEY });
    writeFileSync(join(dir, 'gym-sync.json'), JSON.stringify({ url: 'https://a.convex.cloud', syncKey: 'short' }));
    assert.throws(() => loadGymTarget(dir), /syncKey/);
    writeFileSync(join(dir, 'gym-sync.json'), '{ nope');
    assert.throws(() => loadGymTarget(dir), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restFrom: the note first, then the kind of lift', () => {
  assert.equal(restFrom('Cable Row', 'rest 2–3 min', false), 150);
  assert.equal(restFrom('Barbell Bench Press', null, false), 150);
  assert.equal(restFrom('Barbell Row', null, true), 90);
  assert.equal(restFrom('Lateral Raise', null, false), 90);
});

test('convexMutation: sends the key with the args, and turns an error into a throw', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const answer = (body: unknown, status = 200) => async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: status === 200, status, json: async () => body };
  };
  const target = { url: 'https://x.convex.cloud', syncKey: KEY };
  assert.deepEqual(await convexMutation(target, 'sync:pushWorkouts', { workouts: [] }, answer({ status: 'success', value: { added: 0 } })), { added: 0 });
  assert.deepEqual(calls[0], { url: 'https://x.convex.cloud/api/mutation', body: { path: 'sync:pushWorkouts', args: { key: KEY, workouts: [] }, format: 'json' } });
  await assert.rejects(convexMutation(target, 'sync:pushPlan', {}, answer({ status: 'error', errorMessage: 'Wrong sync key' }, 560)), /Wrong sync key/);
});

test('gymSyncer: off without the file, then once at a time and at most once per gap', async () => {
  const dir = folder();
  try {
    let at = 0;
    let pushes = 0;
    const logger = new Logger({ file: join(dir, 'log.txt'), echo: false });
    const sync = gymSyncer(join(dir, 'data.db'), dir, logger, () => at, async () => {
      pushes++;
      return { pulled: 0, removed: 0, planPushed: false, workouts: 1, added: 0, updated: 0 };
    });
    assert.equal(sync('start'), null);
    writeFileSync(join(dir, 'gym-sync.json'), JSON.stringify({ url: 'https://a.convex.cloud', syncKey: KEY }));
    const first = sync('start');
    assert.ok(first);
    assert.equal(sync('window opened'), null); // still running
    await first;
    at += GYM_SYNC_GAP_MS - 1;
    assert.equal(sync('window opened'), null); // too soon
    at += 1;
    await sync('window opened');
    assert.equal(pushes, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pullFromGym: saves phone workouts, replaces changed ones, drops deleted ones, and leaves PC ones alone', async () => {
  const { pullFromGym, collectForGym, GYM_PULLED_KEY } = await import('./gymSync.ts');
  const { Store } = await import('./store.ts');
  const Database = (await import('better-sqlite3')).default;
  const dir = folder();
  const file = join(dir, 'data.db');
  try {
    new Store(file).close();
    const w = (num: number, updatedAt: number, extra: Record<string, unknown> = {}) => ({
      num, day: '2026-11-17', start: 1_000_000, end: 1_000_000 + 45 * 60_000, name: 'Upper A', kind: 'strength', minutes: null, calories: null,
      note: null, source: 'manual', externalId: null, planDayNum: 100_000_002, createdAt: 1, updatedAt, origin: 'gym',
      sets: [{ num: num + 1, exercise: 'Bench Press', position: 1, setNo: 1, reps: 8, weight: 60, rpe: null, seconds: null, distance: null, flag: null, at: 5 }],
      logs: [{ exercise: 'Bench Press', formReset: false, note: 'easy' }], ...extra,
    });
    const answers = [[w(100_000_010, 10), w(5, 11)], [w(100_000_010, 20, { name: 'Upper B' })], [w(100_000_010, 30, { deleted: true, sets: [], logs: [] })]];
    const asked: number[] = [];
    const fake = async (_url: string, init: { body: string }) => {
      asked.push((JSON.parse(init.body) as { args: { since: number } }).args.since);
      const value = answers.shift() ?? [];
      return { ok: true, status: 200, json: async () => ({ status: 'success', value }) };
    };
    const target = { url: 'https://x.convex.cloud', syncKey: KEY };
    assert.deepEqual(await pullFromGym(file, target, { fetch: fake }), { saved: 1, removed: 0 });
    const db = new Database(file, { readonly: true });
    const row = db.prepare('SELECT name, minutes, source FROM workouts WHERE id = 100000010').get();
    assert.deepEqual(row, { name: 'Upper A', minutes: 45, source: 'gym' });
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE id = 5').get() as { n: number }).n, 0);
    assert.equal((db.prepare('SELECT weight_kg FROM workout_sets WHERE workout_id = 100000010').get() as { weight_kg: number }).weight_kg, 60);
    db.close();
    // Pulled ones aren't pushed back up.
    assert.equal(collectForGym(file).workouts.some((x) => x.num >= 100_000_000), false);
    await pullFromGym(file, target, { fetch: fake });
    const db2 = new Database(file, { readonly: true });
    assert.equal((db2.prepare('SELECT name FROM workouts WHERE id = 100000010').get() as { name: string }).name, 'Upper B');
    db2.close();
    assert.deepEqual(await pullFromGym(file, target, { fetch: fake }), { saved: 0, removed: 1 });
    assert.deepEqual(asked, [0, 11, 20]);
    const db3 = new Database(file, { readonly: true });
    assert.equal((db3.prepare('SELECT COUNT(*) AS n FROM workout_sets WHERE workout_id = 100000010').get() as { n: number }).n, 0);
    assert.equal((db3.prepare('SELECT value FROM settings WHERE key = ?').get(GYM_PULLED_KEY) as { value: string }).value, '30');
    db3.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
