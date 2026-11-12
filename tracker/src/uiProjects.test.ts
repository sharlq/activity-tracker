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
import type { ProjectOverview } from './projects.ts';
import { Store } from './store.ts';
import { cookieValue, createUi } from './ui.ts';

const TOKEN = 'c'.repeat(64);
const TODAY = '2026-11-10';
const NOW = new Date(2026, 10, 10, 20, 0).getTime();

describe('project routes in the window', () => {
  let dir: string;
  let journal: Journal;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-ui-projects-'));
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
  function call<T = ProjectOverview>(path: string, method = 'GET', body?: unknown, signedIn = true) {
    return new Promise<{ status: number; json: T }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: `/v1/ui${path}`, method, headers: { host: `127.0.0.1:${port}`, ...(signedIn ? headers : {}) } }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: (text ? JSON.parse(text) : null) as T }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  it('needs the window to be signed in', async () => {
    assert.equal((await call('/projects', 'GET', undefined, false)).status, 401);
  });

  it('creates a project, adds sub-tasks, and records the day', async () => {
    const made = await call('/projects', 'POST', { name: 'Anatomy exam', due: '2026-11-28', color: '#2f6bd8' });
    assert.equal(made.status, 201);
    const id = made.json.id;
    assert.equal((await call(`/projects/${id}/subtasks`, 'POST', { title: 'Slides', total: 120, unit: 'slides' })).status, 201);
    const withSheet = await call(`/projects/${id}/subtasks`, 'POST', { title: 'Summary sheet' });
    const [slides, sheet] = withSheet.json.subtasks;
    assert.ok(slides && sheet);

    assert.equal((await call(`/subtasks/${slides.id}/progress`, 'PUT', { day: TODAY, amount: 15 })).json.subtasks[0]?.doneToday, 15);
    // Setting the day again replaces, not adds.
    assert.equal((await call(`/subtasks/${slides.id}/progress`, 'PUT', { day: TODAY, amount: 12 })).json.subtasks[0]?.done, 12);
    assert.equal((await call(`/subtasks/${sheet.id}`, 'PATCH', { done: true, day: TODAY })).json.subtasks[1]?.done, 1);
    const noted = await call(`/projects/${id}/days/${TODAY}`, 'PUT', { note: 'Chapters 1 and 2' });
    assert.equal(noted.json.today?.note, 'Chapters 1 and 2');
    assert.equal(noted.json.lastWorked, TODAY);

    const list = await call<{ today: string; projects: ProjectOverview[] }>('/projects');
    assert.equal(list.json.today, TODAY);
    assert.equal(list.json.projects[0]?.fraction, (12 / 120 + 1) / 2);

    const history = await call<{ day: string; progress: { amount: number }[]; note: string | null }[]>(`/projects/${id}/history`);
    assert.deepEqual(history.json.map((d) => [d.day, d.progress.length, d.note]), [[TODAY, 2, 'Chapters 1 and 2']]);
  });

  it('edits the plan one day at a time', async () => {
    const { json: p } = await call('/projects', 'POST', { name: 'Book' });
    const { json: withSub } = await call(`/projects/${p.id}/subtasks`, 'POST', { title: 'Pages', total: 300, unit: 'pages' });
    const sub = withSub.subtasks[0];
    assert.ok(sub);
    await call(`/subtasks/${sub.id}/targets/${TODAY}`, 'PUT', { amount: 20 });
    const planned = await call(`/subtasks/${sub.id}/targets/2026-11-11`, 'PUT', { amount: 20 });
    assert.equal(planned.json.subtasks[0]?.todayTarget, 20);
    assert.equal(planned.json.subtasks[0]?.plan?.days.length, 2);
    const removed = await call(`/subtasks/${sub.id}/targets/2026-11-11`, 'PUT', { amount: 0 });
    assert.equal(removed.json.subtasks[0]?.plan?.days.length, 1);
  });

  it('changes status, refuses bad input, and deletes', async () => {
    const { json: p } = await call('/projects', 'POST', { name: 'Trip' });
    assert.equal((await call(`/projects/${p.id}`, 'PATCH', { status: 'paused' })).json.status, 'paused');
    assert.equal((await call(`/projects/${p.id}`, 'PATCH', { status: 'gone' })).status, 400);
    assert.equal((await call('/projects', 'POST', { name: '' })).status, 400);
    assert.equal((await call(`/projects/${p.id}/subtasks`, 'POST', { title: 'Pages', unit: 'pages' })).status, 400);
    const { json: withSub } = await call(`/projects/${p.id}/subtasks`, 'POST', { title: 'Book hotel' });
    const sub = withSub.subtasks[0];
    assert.ok(sub);
    assert.equal((await call(`/subtasks/${sub.id}/progress`, 'PUT', { day: TODAY, amount: 3 })).status, 400);
    assert.equal((await call(`/projects/${p.id}`, 'DELETE')).status, 204);
    assert.equal((await call(`/projects/${p.id}`)).status, 404);
    assert.equal(journal.subtask(sub.id), null);
  });
});
