import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createApi, listen } from './api.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { Journal } from './journal.ts';
import { Logger } from './logger.ts';
import { Store } from './store.ts';
import { cookieValue, createUi } from './ui.ts';

const TOKEN = 'f'.repeat(64);
const TODAY = '2026-11-10';
const NOW = new Date(2026, 10, 10, 20, 0).getTime();

describe('training plan routes in the window', () => {
  let dir: string;
  let journal: Journal;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-ui-training-'));
    const db = join(dir, 'data.db');
    new Store(db).close();
    journal = new Journal(db);
    const logger = new Logger({ file: join(dir, 'ui.log') });
    const ui = createUi({ journal, dbPath: db, config: DEFAULT_CONFIG, logger, token: TOKEN, now: () => NOW, testReminder: async () => {}, testEvening: async () => {} });
    server = createApi(TOKEN, { onTab: () => {}, onEditor: () => {}, ui }, logger);
    port = await listen(server, 0);
  });
  afterEach(() => {
    server.close();
    server.closeAllConnections();
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const headers = { cookie: `raqib=${cookieValue(TOKEN)}`, 'x-raqib': '1', 'content-type': 'application/json' };
  function call<T = any>(path: string, method = 'GET', body?: unknown) {
    return new Promise<{ status: number; json: T }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: `/v1/ui${path}`, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: (text ? JSON.parse(text) : null) as T }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  it('scores strength for the bodyweight and draws the body figure', async () => {
    const plan = (await call('/training/plan')).json;
    const squat = plan.exercises.find((e: { exercise: { name: string } }) => e.exercise.name === 'Barbell Squat');
    await call('/training/sets', 'POST', { date: '2026-11-09', exerciseId: squat.exercise.id, weight: 120, reps: 1 });
    assert.equal((await call(`/training/strength?date=${TODAY}`)).json.scores.bodyweight, null);
    journal.setWeighIn({ day: '2026-11-09', weight: 80, bodyFat: null, waist: null });
    const s = (await call(`/training/strength?date=${TODAY}`)).json;
    // 120 × 1 is a 124 kg 1RM, 1.55 × bodyweight: just past Intermediate.
    const quads = s.scores.groups.find((g: { id: string }) => g.id === 'quads');
    assert.equal(quads.score, 307);
    assert.equal(quads.level, 'Intermediate');
    assert.equal(s.scores.upper, null);
    assert.match(s.figure, /data-group="quads" d="[^"]+"><title>Quads: 307 · Intermediate<\/title>/);
    assert.match(s.figure, /class="bf-m bf-l3" data-group="quads"/);
    assert.match(s.figure, /class="bf-m bf-none" data-group="chest"/);
    assert.equal(s.balance.pairs.find((p: { id: string }) => p.id === 'upper-lower').status, 'unknown');
    assert.equal((await call(`/training/strength?date=${TODAY}&standards=women`)).json.standards, 'women');
  });

  it('seeds the plan, suggests from history, and gives a verdict as sets are logged', async () => {
    const plan = (await call('/training/plan')).json;
    assert.deepEqual(plan.days.map((d: { name: string }) => d.name), ['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    // 28 seeded, plus the seated calf machine and the tibialis raise (calfWork.ts).
    assert.equal(plan.exercises.length, 30);
    const squat = plan.exercises.find((e: { exercise: { name: string } }) => e.exercise.name === 'Barbell Squat');
    assert.equal(squat.suggestedLabel, '85 kg');
    assert.deepEqual(squat.exercise.goals.map((g: { weight: number }) => g.weight), [85, 90, 95, 100, 102.5]);
    const pullUp = plan.exercises.find((e: { exercise: { name: string } }) => e.exercise.name === 'Pull-Up');
    assert.equal(pullUp.suggestedLabel, 'BW');

    // An earlier squat session, logged on its plan day: 85 × 10/9/8 earns more weight.
    const id = squat.exercise.id;
    for (const reps of [10, 9, 8]) await call('/training/sets', 'POST', { date: '2026-11-07', exerciseId: id, weight: 85, reps });
    const lowerA = (await call(`/training/today?date=${TODAY}&day=${squat.exercise.dayId}`)).json;
    const today = lowerA.exercises.find((x: { state: { exercise: { id: number } } }) => x.state.exercise.id === id);
    assert.equal(today.state.suggestedLabel, '87.5 kg');
    assert.equal(today.state.suggestion.verdict.kind, 'ADD_WEIGHT');
    assert.equal(today.state.comparedWith, 'plan day');

    // Today, one set at a time: the verdict shows straight away.
    const first = (await call('/training/sets', 'POST', { date: TODAY, exerciseId: id, weight: 87.5, reps: 5 })).json;
    assert.equal(first.now.kind, 'TOO_HEAVY');
    assert.equal(first.logged.length, 1);
    await call('/training/logs', 'PUT', { date: TODAY, exerciseId: id, formReset: true, note: 'Knees caved' });
    const after = (await call(`/training/today?date=${TODAY}&day=${squat.exercise.dayId}`)).json;
    const again = after.exercises.find((x: { state: { exercise: { id: number } } }) => x.state.exercise.id === id);
    assert.equal(again.formReset, true);
    assert.equal(again.note, 'Knees caved');
    // Today's sets aren't what today's suggestion is made from.
    assert.equal(again.state.suggestedLabel, '87.5 kg');

    const detail = (await call(`/training/exercises/${id}`)).json;
    assert.equal(detail.sessions.length, 2);
    assert.equal(detail.checkpoints[1].label, 'Feb 27');
  });

  it('lets the plan be edited and exercises added', async () => {
    const plan = (await call('/training/plan')).json;
    const bench = plan.exercises[0].exercise;
    const changed = (await call(`/training/exercises/${bench.id}`, 'PATCH', { step: 1.25, goals: [{ day: '2027-02-14', weight: 75 }] })).json;
    assert.equal(changed.step, 1.25);
    assert.equal(changed.goals.find((g: { day: string }) => g.day === '2027-02-14').weight, 75);
    const added = await call('/training/exercises', 'POST', { name: 'Face Pull', dayId: bench.dayId, sets: 2, repMin: 12, repMax: 15, step: 2.5 });
    assert.equal(added.status, 201);
    assert.equal(added.json.position, 9);
    assert.equal((await call('/training/exercises', 'POST', { name: 'Bad', dayId: bench.dayId, sets: 2, repMin: 12, repMax: 10, step: 2.5 })).status, 400);
  });

  it('builds the progress dashboard', async () => {
    journal.setWeighIn({ day: '2026-11-09', weight: 71.4, bodyFat: null, waist: 80 });
    const d = (await call('/training/progress')).json;
    assert.ok(d.weeks.length >= 1);
    assert.equal(d.body.targets.length, 5);
    assert.equal(d.body.targets[0].ffmi, 19.81);
    assert.ok(d.aim.some((p: { aim: number | null }) => p.aim !== null));
  });
});
