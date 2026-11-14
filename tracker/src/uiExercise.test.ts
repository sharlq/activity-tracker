import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createApi, listen } from './api.ts';
import { DEFAULT_CONFIG } from './config.ts';
import type { Workout } from './journal.ts';
import { Journal } from './journal.ts';
import { Logger } from './logger.ts';
import { Store } from './store.ts';
import { cookieValue, createUi } from './ui.ts';
import type { ExerciseView } from './uiExercise.ts';
import { importWorkouts, planImport } from './workoutImport.ts';

const TOKEN = 'f'.repeat(64);
const TODAY = '2026-11-10';
const NOW = new Date(2026, 10, 10, 20, 0).getTime();

describe('exercise routes in the window', () => {
  let dir: string;
  let journal: Journal;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-ui-exercise-'));
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
  function call<T = Workout>(path: string, method = 'GET', body?: unknown) {
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

  it('logs a workout, its sets, and keeps records', async () => {
    const earlier = await call('/exercise/workouts', 'POST', { day: '2026-11-07', name: 'Push', minutes: 50 });
    assert.equal(earlier.status, 201);
    assert.equal((await call(`/exercise/workouts/${earlier.json.id}/sets`, 'POST', { exercise: 'Bench press', spec: '3x8@60' })).status, 201);

    const made = await call('/exercise/workouts', 'POST', { day: TODAY, name: 'Push', minutes: 55, start: new Date(2026, 10, 10, 18, 30).getTime() });
    const id = made.json.id;
    await call(`/exercise/workouts/${id}/sets`, 'POST', { exercise: 'Bench press', spec: '2x8@62.5' });
    // More sets of the same exercise carry on its numbering, in its place.
    await call(`/exercise/workouts/${id}/sets`, 'POST', { exercise: 'Dips', sets: [{ reps: 12 }, { reps: 10 }] });
    const withMore = await call(`/exercise/workouts/${id}/sets`, 'POST', { exercise: 'bench press', spec: '6@65' });
    assert.deepEqual(withMore.json.sets.map((s) => [s.exercise, s.setNo, s.reps, s.weight]), [
      ['Bench press', 1, 8, 62.5], ['Bench press', 2, 8, 62.5], ['Bench press', 3, 6, 65], ['Dips', 1, 12, null], ['Dips', 2, 10, null],
    ]);

    const view = (await call<ExerciseView>(`/exercise?date=${TODAY}`)).json;
    assert.equal(view.workouts.length, 1);
    assert.deepEqual(view.week.filter((d) => d.sessions).map((d) => [d.day, d.minutes, d.volume]), [['2026-11-07', 50, 1440], [TODAY, 55, 1390]]);
    const bench = view.history.find((x) => x.exercise.toLowerCase() === 'bench press');
    assert.deepEqual(bench?.best, { weight: 65, reps: 6, day: TODAY });
    assert.equal(bench?.times, 2);
    assert.ok(view.recent.some((n) => n.toLowerCase() === 'bench press') && view.recent.includes('Dips'));

    const setId = withMore.json.sets[3]?.id;
    assert.equal((await call(`/exercise/sets/${setId}`, 'DELETE')).json.sets.length, 4);
    assert.equal((await call(`/exercise/workouts/${id}`, 'PATCH', { minutes: 60, note: 'Felt strong' })).json.note, 'Felt strong');
    assert.equal((await call(`/exercise/workouts/${id}`, 'DELETE')).status, 204);
    assert.equal((await call<ExerciseView>(`/exercise?date=${TODAY}`)).json.workouts.length, 0);
  });

  it('turns away what does not fit', async () => {
    assert.equal((await call('/exercise/workouts', 'POST', { day: TODAY, name: '' })).status, 400);
    assert.equal((await call('/exercise/workouts', 'POST', { day: TODAY, name: 'Swim', kind: 'yoga' })).status, 400);
    assert.equal((await call('/exercise/workouts', 'POST', { day: TODAY, name: 'Run', start: new Date(2026, 10, 11, 7).getTime() })).status, 400);
    const { json } = await call('/exercise/workouts', 'POST', { day: TODAY, name: 'Legs' });
    assert.equal((await call(`/exercise/workouts/${json.id}/sets`, 'POST', { exercise: 'Squat', spec: 'three sets' })).status, 400);
    assert.equal((await call('/exercise/workouts/999/sets', 'POST', { exercise: 'Squat', spec: '5@100' })).status, 404);
  });

  it('imports a file once, and takes changes on importing again', () => {
    const first = importWorkouts('date,workout,exercise,reps,weight kg\n2026-11-09,Legs,Squat,5,100\n2026-11-09,Legs,Squat,5,100');
    assert.deepEqual(journal.saveImported(planImport(journal, first.workouts).fresh), { added: 1, updated: 0 });
    const again = planImport(journal, first.workouts);
    assert.deepEqual([again.fresh.length, again.changed.length, again.unchanged], [0, 0, 1]);

    // Edited in the app since: a third set. Its sets are replaced, not added to.
    const edited = importWorkouts('date,workout,exercise,reps,weight kg\n2026-11-09,Legs,Squat,5,100\n2026-11-09,Legs,Squat,5,100\n2026-11-09,Legs,Squat,3,110');
    const plan = planImport(journal, edited.workouts);
    assert.equal(plan.changed.length, 1);
    journal.updateWorkout(plan.changed[0]!.replaces, { note: 'kept' });
    assert.deepEqual(journal.saveImported(plan.changed), { added: 0, updated: 1 });
    const [legs] = journal.workouts('2026-11-09');
    assert.deepEqual(legs?.sets.map((s) => [s.reps, s.weight]), [[5, 100], [5, 100], [3, 110]]);
    assert.equal(legs?.note, 'kept');
    assert.equal(journal.workouts('2026-11-09').length, 1);
  });
});
