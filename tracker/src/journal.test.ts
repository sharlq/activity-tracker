import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createApi, listen } from './api.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { Journal } from './journal.ts';
import { Logger } from './logger.ts';
import { toastXml } from './notify.ts';
import { Store } from './store.ts';
import { cookieValue, createUi } from './ui.ts';

const TOKEN = 'b'.repeat(64);

describe('Journal', () => {
  let dir: string;
  let journal: Journal;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-journal-'));
    journal = new Journal(join(dir, 'data.db'));
  });
  afterEach(() => {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves the same entry sent twice only once', () => {
    const first = journal.addEntry({ start: 0, end: 60_000, label: 'Rest', category: 'rest' });
    const again = journal.addEntry({ start: 0, end: 60_000, label: 'Rest', category: 'rest' });
    const other = journal.addEntry({ start: 0, end: 60_000, label: 'Prayer', category: 'prayer' });
    assert.equal(again.id, first.id);
    assert.notEqual(other.id, first.id);
    assert.equal(journal.entriesBetween(0, 60_000).length, 2);
  });

  it('keeps tasks per day and carries unfinished ones over once', () => {
    const a = journal.addTask('2026-11-09', 'Call the bank');
    journal.addTask('2026-11-09', 'Gym');
    journal.updateTask(a.id, { done: true }, 500);
    assert.deepEqual(journal.carryOver('2026-11-09', '2026-11-10').map((t) => t.text), ['Gym']);
    assert.deepEqual(journal.carryOver('2026-11-09', '2026-11-10'), []);
    assert.equal(journal.tasks('2026-11-09')[0]?.doneAt, 500);
    assert.equal(journal.updateTask(a.id, { done: false })?.doneAt, null);
  });

  it('reminders start counting when created, edited, or switched back on', () => {
    const r = journal.addReminder('Water', { type: 'every', minutes: 60, from: '00:00', until: '24:00', days: [] }, true, 100);
    journal.markFired(r.id, 200);
    assert.equal(journal.updateReminder(r.id, { text: 'Drink water' }, 300)?.lastFiredAt, 200);
    journal.updateReminder(r.id, { enabled: false }, 400);
    assert.equal(journal.updateReminder(r.id, { enabled: true }, 500)?.lastFiredAt, 500);
    assert.equal(journal.reminders()[0]?.text, 'Drink water');
  });

  it('shares the database with the event store, and purge removes its rows too', () => {
    journal.addEntry({ start: 0, end: 10, label: 'Sleep', category: 'sleep' });
    journal.startAudio({ processName: 'Spotify.exe', exePath: null, title: null, domain: null }, 0, 10);
    journal.addTask('2020-01-01', 'Old');
    const store = new Store(join(dir, 'data.db'));
    store.purgeBefore(new Date(2021, 0, 1).getTime());
    store.close();
    assert.deepEqual(journal.entriesBetween(-1, 100), []);
    assert.deepEqual(journal.audioBetween(-1, 100), []);
    assert.deepEqual(journal.tasks('2020-01-01'), []);
  });

  it('keeps a day plan, saves a repeat once, and copies it to another day', () => {
    const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
    const a = journal.addPlanBlock({ day: '2026-11-12', start: at(12, 9), end: at(12, 11), label: 'Study', category: 'study' });
    assert.equal(journal.addPlanBlock({ day: '2026-11-12', start: at(12, 9), end: at(12, 11), label: 'Study', category: 'study' }).id, a.id);
    journal.addPlanBlock({ day: '2026-11-12', start: at(12, 7), end: at(12, 8), label: 'Gym', category: 'exercise' });
    assert.deepEqual(journal.planBlocks('2026-11-12').map((b) => b.label), ['Gym', 'Study']);

    assert.equal(journal.updatePlanBlock(a.id, { end: at(12, 8) }), null, 'an end before the start is refused');
    assert.equal(journal.updatePlanBlock(a.id, { label: 'Study AWS', category: null })?.label, 'Study AWS');

    const day = 86_400_000;
    const copied = journal.copyPlan('2026-11-12', '2026-11-13', (ms) => ms + day);
    assert.equal(copied.length, 2);
    assert.equal(journal.copyPlan('2026-11-12', '2026-11-13', (ms) => ms + day).length, 0, 'copying again adds nothing');
    assert.deepEqual(journal.planBlocks('2026-11-13').map((b) => [b.label, b.start]), [['Gym', at(13, 7)], ['Study AWS', at(13, 9)]]);

    assert.equal(journal.deletePlanBlock(a.id), true);
    assert.equal(journal.planBlocks('2026-11-12').length, 1);

    const store = new Store(join(dir, 'data.db'));
    store.purgeBefore(new Date(2026, 10, 13).getTime());
    store.close();
    assert.deepEqual(journal.planBlocks('2026-11-12'), []);
    assert.equal(journal.planBlocks('2026-11-13').length, 2);
  });
});

describe('UI API', () => {
  let dir: string;
  let journal: Journal;
  let server: Server;
  let port: number;
  let tested: string[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-ui-'));
    const db = join(dir, 'data.db');
    new Store(db).close();
    journal = new Journal(db);
    tested = [];
    const logger = new Logger({ file: join(dir, 'ui.log') });
    const ui = createUi({
      journal,
      dbPath: db,
      config: DEFAULT_CONFIG,
      logger,
      token: TOKEN,
      testReminder: async (r) => void tested.push(r.text),
      testEvening: async () => void tested.push('evening'),
    });
    server = createApi(TOKEN, { onTab: () => {}, onEditor: () => {}, ui }, logger);
    port = await listen(server, 0);
  });
  afterEach(() => {
    server.close();
    server.closeAllConnections();
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function call(path: string, { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
    return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const signedIn = { cookie: `raqib=${cookieValue(TOKEN)}`, 'x-raqib': '1', 'content-type': 'application/json' };

  it('puts an uncategorised site into a category, and refuses a bad one', async () => {
    const file = join(dir, 'categories.json');
    writeFileSync(file, '{\n  "focus": ["work"],\n  "distraction": [],\n  "rules": [\n    { "category": "video", "domain": "youtube.com" }\n  ]\n}\n');
    const before = process.env['ACTIVITY_TRACKER_CATEGORIES'];
    process.env['ACTIVITY_TRACKER_CATEGORIES'] = file;
    try {
      const ok = await call('/v1/ui/categories', { method: 'POST', headers: signedIn, body: { category: 'work', kind: 'domain', value: 'hubspot.com' } });
      assert.equal(ok.status, 200);
      assert.match(readFileSync(file, 'utf8'), /"category": "work", "domain": \["hubspot.com"\], "note": "Added in رقيب"/);
      const bad = await call('/v1/ui/categories', { method: 'POST', headers: signedIn, body: { category: 'idle', kind: 'domain', value: 'x.com' } });
      assert.equal(bad.status, 400);
    } finally {
      if (before === undefined) delete process.env['ACTIVITY_TRACKER_CATEGORIES'];
      else process.env['ACTIVITY_TRACKER_CATEGORIES'] = before;
    }
  });

  it('swaps the key for a cookie, and refuses a wrong key', async () => {
    const ok = await call(`/ui/login?key=${TOKEN}&go=morning`);
    assert.equal(ok.status, 302);
    assert.equal(ok.headers['location'], '/ui/#morning');
    assert.match(String(ok.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
    assert.equal((await call('/ui/login?key=nope')).status, 401);
  });

  it('serves the pages to anyone, but the data only with the cookie and header', async () => {
    const page = await call('/ui/');
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.equal((await call('/v1/ui/settings')).status, 401);
    assert.equal((await call('/v1/ui/settings', { headers: { cookie: signedIn.cookie } })).status, 403);
    assert.equal((await call('/v1/ui/settings', { headers: { ...signedIn, origin: 'https://evil.example' } })).status, 403);
    assert.equal((await call('/v1/ui/settings', { headers: signedIn })).status, 200);
  });

  it('logs entries, keeps tasks, and validates what it gets', async () => {
    const entry = await call('/v1/ui/entries', { method: 'POST', headers: signedIn, body: { start: 0, end: 60_000, label: 'Gym', category: 'exercise' } });
    assert.equal(entry.status, 201);
    assert.equal((await call('/v1/ui/entries', { method: 'POST', headers: signedIn, body: { start: 10, end: 5, label: 'x' } })).status, 400);
    assert.equal((await call('/v1/ui/tasks', { method: 'POST', headers: signedIn, body: { day: '2026-11-10', text: 'Read' } })).status, 201);
    assert.equal((await call('/v1/ui/tasks', { method: 'POST', headers: signedIn, body: { day: 'soon', text: 'Read' } })).status, 400);
    assert.equal(journal.tasks('2026-11-10')[0]?.text, 'Read');
  });

  it('adds, tests, and deletes reminders', async () => {
    const made = await call('/v1/ui/reminders', { method: 'POST', headers: signedIn, body: { text: 'Pills', schedule: { type: 'at', times: ['09:00'] } } });
    assert.equal(made.status, 201);
    const { id } = JSON.parse(made.body) as { id: number };
    assert.equal((await call(`/v1/ui/reminders/${id}/test`, { method: 'POST', headers: signedIn })).status, 204);
    assert.deepEqual(tested, ['Pills']);
    assert.equal((await call('/v1/ui/reminders', { method: 'POST', headers: signedIn, body: { text: 'Bad', schedule: { type: 'every', minutes: -1 } } })).status, 400);
    assert.equal((await call(`/v1/ui/reminders/${id}`, { method: 'DELETE', headers: signedIn })).status, 204);
    assert.deepEqual(journal.reminders(), []);
  });

  it('saves check-ins, goals, and weekly reviews, and validates them', async () => {
    const put = (body: unknown) => call('/v1/ui/checkins', { method: 'PUT', headers: signedIn, body });
    assert.equal((await put({ day: '2026-11-10', part: 'morning', mood: 4, energy: 2 })).status, 200);
    assert.equal((await put({ day: '2026-11-10', part: 'morning', note: 'Slept badly' })).status, 200);
    assert.deepEqual(
      journal.checkins('2026-11-10').map(({ mood, energy, note }) => ({ mood, energy, note })),
      [{ mood: 4, energy: 2, note: 'Slept badly' }],
    );
    assert.equal((await put({ day: '2026-11-10', part: 'morning', mood: 6 })).status, 400);
    assert.equal((await put({ day: '2026-11-10', part: 'noon', mood: 3 })).status, 400);

    const made = await call('/v1/ui/goals', { method: 'POST', headers: signedIn, body: { day: '2026-11-10', text: 'Finish the court papers' } });
    assert.equal(made.status, 201);
    const { id } = JSON.parse(made.body) as { id: number };
    assert.equal((await call(`/v1/ui/goals/${id}`, { method: 'PATCH', headers: signedIn, body: { result: 'partly' } })).status, 200);
    assert.equal(journal.goals('2026-11-10')[0]?.result, 'partly');
    assert.equal((await call(`/v1/ui/goals/${id}`, { method: 'PATCH', headers: signedIn, body: { result: 'maybe' } })).status, 400);

    assert.equal((await call('/v1/ui/reviews/2026-11-09', { method: 'PUT', headers: signedIn, body: { wentWell: 'Gym twice' } })).status, 200);
    assert.equal(journal.review('2026-11-09')?.wentWell, 'Gym twice');
    assert.equal((await call('/v1/ui/reviews/2026-11-10', { method: 'PUT', headers: signedIn, body: { wentWell: 'x' } })).status, 400);
  });

  it('builds a week, with the week before to compare', async () => {
    journal.setCheckin('2026-11-10', 'evening', { mood: 2 });
    journal.addEntry({ start: new Date(2026, 10, 9, 23).getTime(), end: new Date(2026, 10, 10, 7).getTime(), label: 'Sleep', category: 'sleep' });
    const res = await call('/v1/ui/week?date=2026-11-11', { headers: signedIn });
    assert.equal(res.status, 200);
    const week = JSON.parse(res.body) as { start: string; end: string; days: { date: string; mood: number | null; sleep: { totalMs: number } }[]; previous: unknown };
    assert.equal(week.start, '2026-11-09');
    assert.equal(week.end, '2026-11-15');
    assert.equal(week.days.length, 7);
    assert.equal(week.days[1]?.mood, 2);
    assert.equal(week.days[1]?.sleep.totalMs, 8 * 3600_000);
    assert.ok(week.previous);
  });

  it('plans a day, checks the blocks, copies a plan, and shows it with the day', async () => {
    const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
    const post = (body: unknown) => call('/v1/ui/plan', { method: 'POST', headers: signedIn, body });
    const made = await post({ day: '2026-11-12', start: at(12, 9), end: at(12, 11), label: 'Study', category: 'study' });
    assert.equal(made.status, 201);
    const { id } = JSON.parse(made.body) as { id: number };
    // Runs past midnight: fine. Starts on another day, ends before it starts, or no label: refused.
    assert.equal((await post({ day: '2026-11-12', start: at(12, 23), end: at(13, 0, 30), label: 'Read' })).status, 201);
    assert.equal((await post({ day: '2026-11-12', start: at(13, 9), end: at(13, 10), label: 'x' })).status, 400);
    assert.equal((await post({ day: '2026-11-12', start: at(12, 10), end: at(12, 9), label: 'x' })).status, 400);
    assert.equal((await post({ day: '2026-11-12', start: at(12, 10), end: at(12, 11), label: ' ' })).status, 400);

    const moved = await call(`/v1/ui/plan/${id}`, { method: 'PUT', headers: signedIn, body: { start: at(12, 8), end: at(12, 10), label: 'Study AWS', category: 'study' } });
    assert.equal(moved.status, 200);
    assert.equal(journal.planBlock(id)?.start, at(12, 8));
    assert.equal((await call('/v1/ui/plan/999', { method: 'PUT', headers: signedIn, body: { label: 'x' } })).status, 404);

    const copy = await call('/v1/ui/plan/copy', { method: 'POST', headers: signedIn, body: { from: '2026-11-12', to: '2026-11-13' } });
    assert.equal(copy.status, 200);
    const next = JSON.parse((await call('/v1/ui/plan?date=2026-11-13', { headers: signedIn })).body) as { blocks: { start: number; end: number; label: string }[] };
    assert.deepEqual(next.blocks.map((b) => [b.label, b.start, b.end]), [['Study AWS', at(13, 8), at(13, 10)], ['Read', at(13, 23), at(14, 0, 30)]]);

    const day = JSON.parse((await call('/v1/ui/day?date=2026-11-12', { headers: signedIn })).body) as { plan: unknown[]; planComparison: { blocks: { status: string }[] } };
    assert.equal(day.plan.length, 2);
    assert.equal(day.planComparison.blocks[0]?.status, 'missed', 'nothing was recorded, so the past block was missed');

    assert.equal((await call(`/v1/ui/plan/${id}`, { method: 'DELETE', headers: signedIn })).status, 204);
    assert.equal(journal.planBlocks('2026-11-12').length, 1);
  });

  it('builds a day, with the whole day as one gap when nothing was recorded', async () => {
    const day = await call('/v1/ui/day?date=2026-11-01', { headers: signedIn });
    assert.equal(day.status, 200);
    const view = JSON.parse(day.body) as { gaps: { ms: number }[]; activeMs: number };
    assert.equal(view.activeMs, 0);
    assert.equal(view.gaps.length, 1);
    assert.equal(view.gaps[0]?.ms, new Date(2026, 10, 2).getTime() - new Date(2026, 10, 1).getTime());
  });
});

describe('toastXml', () => {
  it('escapes text and offers snooze and done for reminders', () => {
    const xml = toastXml({ title: 'Meds <now> & "then"', lines: ['رقيب'], reminder: true, actions: [{ kind: 'snooze' }, { kind: 'dismiss', label: 'Done' }] });
    assert.match(xml, /scenario="reminder"/);
    assert.match(xml, /Meds &lt;now&gt; &amp; &quot;then&quot;/);
    assert.match(xml, /arguments="snooze" hint-inputId="snoozeTime"/);
    assert.match(xml, /arguments="dismiss" content="Done"/);
  });

  it('opens a page when clicked', () => {
    const xml = toastXml({ title: 'Day', lines: [], url: 'http://127.0.0.1:1/ui/login?key=a&go=evening' });
    assert.match(xml, /activationType="protocol" launch="http:\/\/127\.0\.0\.1:1\/ui\/login\?key=a&amp;go=evening"/);
  });
});
