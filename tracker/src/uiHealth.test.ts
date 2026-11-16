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
import type { HealthView } from './uiHealth.ts';

const TOKEN = 'd'.repeat(64);
const TODAY = '2026-11-10';
const NOW = new Date(2026, 10, 10, 20, 0).getTime();

describe('health routes in the window', () => {
  let dir: string;
  let journal: Journal;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-ui-health-'));
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
  function call<T = HealthView>(path: string, method = 'GET', body?: unknown) {
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

  it('logs food and adds up the day', async () => {
    assert.equal((await call('/health/foods', 'POST', { day: TODAY, meal: 'breakfast', name: 'Eggs', calories: 210, protein: 18 })).status, 201);
    assert.equal((await call('/health/foods', 'POST', { day: TODAY, meal: 'lunch', name: 'Chicken machboos', calories: 650, protein: 40, carbs: 70 })).status, 201);
    // What you don't know can stay empty.
    assert.equal((await call('/health/foods', 'POST', { day: TODAY, meal: 'snack', name: 'Dates', calories: '' })).status, 201);
    assert.equal((await call('/health/foods', 'POST', { day: TODAY, meal: 'brunch', name: 'x' })).status, 400);
    assert.equal((await call('/health/foods', 'POST', { day: TODAY, meal: 'snack', name: 'x', calories: -5 })).status, 400);

    const view = (await call(`/health?date=${TODAY}`)).json;
    assert.equal(view.foods.length, 3);
    assert.deepEqual(view.totals, { calories: 860, protein: 58, carbs: 70, fat: 0 });
    assert.equal(view.week.length, 7);
    assert.equal(view.week.at(-1)?.calories, 860);
    assert.deepEqual(view.recent.map((r) => r.name), ['Dates', 'Chicken machboos', 'Eggs']);

    assert.equal((await call(`/health/foods/${view.foods[0]?.id}`, 'DELETE')).status, 204);
    assert.equal((await call(`/health?date=${TODAY}`)).json.totals.calories, 650);
  });

  it('keeps one weigh-in a day and the trend', async () => {
    assert.equal((await call('/health/weight/2026-11-03', 'PUT', { weight: 82.4 })).status, 200);
    assert.equal((await call(`/health/weight/${TODAY}`, 'PUT', { weight: 81.9, waist: 90 })).status, 200);
    // Weighing again replaces it.
    assert.equal((await call(`/health/weight/${TODAY}`, 'PUT', { weight: 81.6, bodyFat: 21.5 })).status, 200);
    assert.equal((await call(`/health/weight/${TODAY}`, 'PUT', {})).status, 400);

    const view = (await call(`/health?date=${TODAY}`)).json;
    assert.deepEqual(view.weights.map((w) => w.weight), [82.4, 81.6]);
    assert.equal(view.weighIn?.bodyFat, 21.5);
    assert.equal(view.weighIn?.waist, null);
    assert.equal((await call('/health?date=2026-11-04')).json.weighIn, null);

    assert.equal((await call(`/health/weight/${TODAY}`, 'DELETE')).status, 204);
    assert.equal((await call(`/health/weight/${TODAY}`, 'DELETE')).status, 404);
  });

  it('stores daily targets, and clears them', async () => {
    assert.deepEqual((await call('/health/targets', 'PUT', { calories: 2200, protein: 140 })).json, { calories: 2200, protein: 140 });
    assert.deepEqual((await call('/health/targets', 'PUT', { protein: null })).json, { calories: 2200, protein: null });
    assert.deepEqual((await call(`/health?date=${TODAY}`)).json.targets, { calories: 2200, protein: null });
  });
});
