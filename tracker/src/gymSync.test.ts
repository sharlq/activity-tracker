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
      return { planPushed: false, workouts: 1, added: 0, updated: 0 };
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
