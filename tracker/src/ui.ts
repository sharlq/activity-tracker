// رقيب's window: static pages under /ui, and the JSON they use under /v1/ui/.
//
// Sign-in: the window is opened at /ui/login?key=<API token>, which swaps the
// key for a cookie (HttpOnly, SameSite=Strict) and redirects to the page.
// Every /v1/ui/ request needs that cookie and an X-Raqib header. Web pages on
// other sites can't send a custom header to 127.0.0.1 without a CORS preflight,
// which this server never approves, and SameSite=Strict keeps the cookie off
// requests they start. The Host check in api.ts has already run.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, readJson, send } from './api.ts';
import { readClaudeSessions } from './claudeSessions.ts';
import type { Config } from './config.ts';
import { categoriesFile } from './config.ts';
import { parseLocalDate } from './dates.ts';
import type { Checkin, CheckinPart, Goal, GoalResult, Journal, Reminder, Review } from './journal.ts';
import type { Logger } from './logger.ts';
import type { PlannerSettings, PlannerState } from './planner.ts';
import { DEFAULT_SETTINGS, dayKey, jobWindow, mergeSettings, nextSlot, parseSchedule } from './planner.ts';
import type { ProjectWeek } from './projects.ts';
import { projectWeek } from './projects.ts';
import { EventReader } from './reader.ts';
import { projectRoutes } from './uiProjects.ts';
import type { DayFigures, Gap, Report, Sleep, WeekTotals } from './report/index.ts';
import { buildReport, CATEGORIES, findGaps, loadCategories, mondayOf, nightWindow, observations, sleepFor, toSegments, weekTotals } from './report/index.ts';

const STATIC_DIR = fileURLToPath(new URL('../ui/', import.meta.url));
const STATIC_FILES: Record<string, string> = {
  '/ui': 'index.html',
  '/ui/': 'index.html',
  '/ui/app.js': 'app.js',
  '/ui/style.css': 'style.css',
  '/ui/icon.svg': 'icon.svg',
  // The design's typefaces, bundled so the window works offline (SIL Open Font License, see ui/fonts).
  '/ui/fonts/newsreader.woff2': 'fonts/newsreader.woff2',
  '/ui/fonts/source-sans-3.woff2': 'fonts/source-sans-3.woff2',
  '/ui/fonts/noto-naskh-arabic.woff2': 'fonts/noto-naskh-arabic.woff2',
  // Browsers ask for it on their own; answering here keeps it out of the token check.
  '/favicon.ico': 'icon.svg',
};
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};
const COOKIE = 'raqib';
const PAGES = new Set(['today', 'morning', 'evening', 'back', 'week', 'projects', 'reminders', 'settings']);

/** Activities you might log for time away from the PC, besides the screen categories. */
export const LIFE_CATEGORIES = ['sleep', 'meal', 'exercise', 'errand', 'commute', 'social', 'rest', 'prayer', 'chores', 'study'];

export function cookieValue(token: string): string {
  return createHash('sha256').update(`raqib-ui:${token}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookies(request: IncomingMessage): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) found.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return found;
}

// ------------------------------------------------------------------ settings

export function readSettings(journal: Journal): PlannerSettings {
  try {
    return mergeSettings(DEFAULT_SETTINGS, journal.get('settings') ?? {});
  } catch {
    return DEFAULT_SETTINGS; // A stored value from an older version that no longer fits.
  }
}

export function readState(journal: Journal): PlannerState {
  const text = (key: string) => {
    const value = journal.get(key);
    return typeof value === 'string' ? value : null;
  };
  return { morningShown: text('state.morningShown'), eveningShown: text('state.eveningShown'), projectsReminded: text('state.projectsReminded') };
}

// ------------------------------------------------------------------ the day

export interface UiDeps {
  journal: Journal;
  dbPath: string;
  config: Config;
  logger: Logger;
  token: string;
  /** Shows a reminder right now (the Test button). */
  testReminder(reminder: Reminder): Promise<void>;
  /** Sends the evening notification right now. */
  testEvening(): Promise<void>;
  /** Sends the project reminder now; false when every project is already answered. */
  testProjectReminder?(): Promise<boolean>;
  now?: () => number;
}

export interface DayView {
  date: string;
  from: number;
  to: number;
  now: number;
  report: Report;
  activeMs: number;
  focusMs: number;
  distractionMs: number;
  gaps: Gap[];
  gapMs: number;
  /** Job hours that day, from Settings; null when off or not a job day. */
  job: { start: number; end: number } | null;
  tasks: ReturnType<Journal['tasks']>;
  goals: Goal[];
  /** Morning and evening, whichever you've done. */
  checkins: Checkin[];
  sleep: Sleep;
  /** Focused time in each hour of the day, 0 to 23. */
  focusByHour: number[];
  focus: string[];
  distraction: string[];
  entryCategories: string[];
}

export async function buildDay(
  deps: Pick<UiDeps, 'journal' | 'dbPath' | 'config'>,
  date: string,
  now: number,
  { claude = true }: { claude?: boolean } = {},
): Promise<DayView> {
  const from = parseLocalDate(date);
  if (from === null) throw new HttpError(400, 'date must look like 2026-11-05');
  const to = new Date(from).setDate(new Date(from).getDate() + 1);
  const until = Math.min(to, now);
  const night = nightWindow(from);

  const reader = new EventReader(deps.dbPath);
  const [events, nightEvents] = (() => {
    try {
      return [reader.eventsBetween(from, to), reader.eventsBetween(night.start, night.end)];
    } finally {
      reader.close();
    }
  })();
  const categories = loadCategories(categoriesFile());
  const games = deps.config.gaming.games;
  const audio = deps.journal.audioBetween(from, to);
  const screens = deps.journal.screensBetween(from, to);
  const entries = deps.journal.entriesBetween(from, to);
  // Claude's logs only name Claude blocks; the day works without them.
  const claudeSessions = claude ? await readClaudeSessions(undefined, from).then((r) => r.sessions, () => []) : [];

  const report = buildReport({ kind: 'day', from, to, events, claudeSessions, categories, games, audio, screens, entries });
  const settings = readSettings(deps.journal);
  const segments = toSegments(events, categories, games);
  const gaps = until > from ? findGaps(segments, entries, from, until, settings.gaps.minMinutes * 60_000) : [];
  const sumOf = (list: string[]) => report.totals.filter((t) => list.includes(t.category)).reduce((s, t) => s + t.ms, 0);

  const nightActive = toSegments(nightEvents, categories, games).filter((s) => s.category !== 'idle');
  const sleep = sleepFor(from, deps.journal.entriesBetween(night.start, to), nightActive, now);

  const focusByHour = Array.from({ length: 24 }, () => 0);
  for (const s of segments) {
    if (!categories.focus.includes(s.category)) continue;
    for (let t = s.start; t < s.end; ) {
      const d = new Date(t);
      const hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const end = Math.min(hourEnd, s.end);
      focusByHour[d.getHours()] = (focusByHour[d.getHours()] ?? 0) + (end - t);
      t = end;
    }
  }

  return {
    date,
    from,
    to,
    now,
    report,
    activeMs: report.trackedMs - report.idleMs,
    focusMs: sumOf(categories.focus),
    distractionMs: sumOf(categories.distraction),
    gaps,
    gapMs: gaps.reduce((s, g) => s + g.ms, 0),
    job: jobWindow(settings, from),
    tasks: deps.journal.tasks(date),
    goals: deps.journal.goals(date),
    checkins: deps.journal.checkins(date),
    sleep,
    focusByHour,
    focus: categories.focus,
    distraction: categories.distraction,
    entryCategories: [...LIFE_CATEGORIES, ...CATEGORIES.filter((c) => c !== 'idle')],
  };
}

// ------------------------------------------------------------------ the week

const averageOf = (values: (number | null)[]): number | null => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};

export function figuresOf(view: DayView): DayFigures {
  return {
    date: view.date,
    past: view.from <= view.now,
    activeMs: view.activeMs,
    focusMs: view.focusMs,
    distractionMs: view.distractionMs,
    sleep: view.sleep,
    mood: averageOf(view.checkins.map((c) => c.mood)),
    energy: averageOf(view.checkins.map((c) => c.energy)),
    tasksDone: view.tasks.filter((t) => t.doneAt !== null).length,
    tasksTotal: view.tasks.length,
    goalsMet: view.goals.filter((g) => g.result === 'met').length,
    goalsPartly: view.goals.filter((g) => g.result === 'partly').length,
    goalsTotal: view.goals.length,
    gapMs: view.gapMs,
    focusByHour: view.focusByHour,
  };
}

const addDays = (date: string, days: number) => {
  const d = new Date(parseLocalDate(date) as number);
  d.setDate(d.getDate() + days);
  return dayKey(d.getTime());
};

export interface WeekView {
  /** Monday and Sunday. */
  start: string;
  end: string;
  now: number;
  days: DayFigures[];
  totals: WeekTotals;
  /** The week before, for comparison. */
  previous: WeekTotals;
  observations: string[];
  categories: { category: string; ms: number }[];
  /** Sites, apps, and games in distraction categories, most time first. */
  distractions: { name: string; ms: number }[];
  review: Review | null;
  focus: string[];
  distraction: string[];
  /** What each project did that week: running ones, and finished ones that moved. */
  projects: ProjectWeek[];
}

/** Projects over one week, as they stood at its end (or today, for this week). */
export function weekProjects(journal: Journal, monday: string, now: number): ProjectWeek[] {
  const sunday = addDays(monday, 6);
  const today = dayKey(now);
  const asOf = sunday < today ? sunday : today;
  if (asOf < monday) return [];
  const progress = journal.progressBetween(monday, sunday);
  const days = journal.projectDaysBetween(monday, sunday);
  const targets = journal.targetsBetween(monday, sunday);
  return journal
    .projectOverviews(asOf, journal.neglectAfterDays())
    .filter((p) => dayKey(p.createdAt) <= sunday)
    .map((p) => projectWeek(p, progress, days, targets, monday, sunday, asOf))
    .filter((w) => w.status !== 'done' || w.moved.length > 0);
}

async function weekDays(deps: Pick<UiDeps, 'journal' | 'dbPath' | 'config'>, monday: string, now: number) {
  const views: DayView[] = [];
  // One at a time: each opens its own reader.
  for (let i = 0; i < 7; i++) views.push(await buildDay(deps, addDays(monday, i), now, { claude: false }));
  return { views, starts: views.map((v) => v.from) };
}

export async function buildWeek(deps: Pick<UiDeps, 'journal' | 'dbPath' | 'config'>, date: string, now: number): Promise<WeekView> {
  if (parseLocalDate(date) === null) throw new HttpError(400, 'date must look like 2026-11-05');
  const monday = mondayOf(date);
  const current = await weekDays(deps, monday, now);
  const before = await weekDays(deps, addDays(monday, -7), now);
  const days = current.views.map(figuresOf);
  const totals = weekTotals(days, current.starts);

  const byCategory = new Map<string, number>();
  const distractions = new Map<string, number>();
  for (const view of current.views) {
    for (const t of view.report.totals) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.ms);
    for (const b of view.report.timeline) {
      if (view.distraction.includes(b.category)) distractions.set(b.detail, (distractions.get(b.detail) ?? 0) + (b.end - b.start));
    }
  }
  const ranked = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]);
  return {
    start: monday,
    end: addDays(monday, 6),
    now,
    days,
    totals,
    previous: weekTotals(before.views.map(figuresOf), before.starts),
    observations: observations(days, totals),
    categories: ranked(byCategory).map(([category, ms]) => ({ category, ms })),
    distractions: ranked(distractions).slice(0, 8).map(([name, ms]) => ({ name, ms })),
    review: deps.journal.review(monday),
    focus: current.views[0]?.focus ?? [],
    distraction: current.views[0]?.distraction ?? [],
    projects: weekProjects(deps.journal, monday, now),
  };
}

// ------------------------------------------------------------------ validation

function rating(value: unknown, name: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) throw new HttpError(400, `${name} must be 1 to 5`);
  return value;
}

function checkinPart(value: unknown): CheckinPart {
  if (value !== 'morning' && value !== 'evening') throw new HttpError(400, 'part must be morning or evening');
  return value;
}

function goalResult(value: unknown): GoalResult | null {
  if (value === null) return null;
  if (value !== 'met' && value !== 'partly' && value !== 'missed') throw new HttpError(400, 'result must be met, partly, missed, or null');
  return value;
}

/** Text that may be cleared: null or '' clears it, undefined leaves it alone. */
function clearableText(value: unknown, name: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
  return text(value, name, max);
}

function text(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new HttpError(400, `${name} must be text of up to ${max} characters`);
  }
  return value.trim();
}

function optionalText(value: unknown, name: string, max = 60): string | null {
  if (value === null || value === undefined || value === '') return null;
  return text(value, name, max);
}

function time(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, `${name} must be a time`);
  return value;
}

function day(value: unknown): string {
  if (typeof value !== 'string' || parseLocalDate(value) === null) throw new HttpError(400, 'day must look like 2026-11-05');
  return value;
}

function entryBody(body: unknown) {
  const raw = (body ?? {}) as Record<string, unknown>;
  const entry = {
    start: time(raw['start'], 'start'),
    end: time(raw['end'], 'end'),
    label: text(raw['label'], 'What you did', 200),
    category: optionalText(raw['category'], 'category'),
  };
  if (entry.end <= entry.start) throw new HttpError(400, 'The end must be after the start');
  if (entry.end - entry.start > 36 * 3600_000) throw new HttpError(400, 'An entry can be at most 36 hours');
  return entry;
}

function schedule(value: unknown) {
  try {
    return parseSchedule(value);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
}

function reminderView(reminder: Reminder, now: number) {
  return { ...reminder, next: reminder.enabled ? nextSlot(reminder.schedule, Math.max(now, reminder.lastFiredAt ?? 0)) : null };
}

// ------------------------------------------------------------------ routes

async function serveStatic(response: ServerResponse, file: string): Promise<void> {
  const body = await readFile(join(STATIC_DIR, file));
  response.writeHead(200, { ...SECURITY_HEADERS, 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
}

function login(request: IncomingMessage, response: ServerResponse, url: URL, token: string): void {
  const key = url.searchParams.get('key') ?? '';
  if (!safeEqual(key, token)) {
    response
      .writeHead(401, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
      .end('This link has expired. Open رقيب again with: npm run raqib -- open');
    return;
  }
  const go = url.searchParams.get('go') ?? 'today';
  const date = url.searchParams.get('date');
  const hash = PAGES.has(go) ? go : 'today';
  const away = url.searchParams.get('away');
  const suffix =
    hash === 'back' && away && /^\d{1,15}-\d{1,15}$/.test(away) ? `/${away}` : date && parseLocalDate(date) !== null ? `/${date}` : '';
  response
    .writeHead(302, {
      ...SECURITY_HEADERS,
      'set-cookie': `${COOKIE}=${cookieValue(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
      location: `/ui/#${hash}${suffix}`,
    })
    .end();
  void request;
}

function checkUiRequest(request: IncomingMessage, port: number, token: string): void {
  const cookie = cookies(request).get(COOKIE) ?? '';
  if (!safeEqual(cookie, cookieValue(token))) throw new HttpError(401, 'not signed in');
  if (request.headers['x-raqib'] !== '1') throw new HttpError(403, 'missing X-Raqib header');
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    throw new HttpError(403, 'origin not allowed');
  }
}

function id(match: RegExpExecArray): number {
  return Number(match[1]);
}

export function createUi(deps: UiDeps) {
  const now = deps.now ?? Date.now;
  const { journal } = deps;

  return async (request: IncomingMessage, response: ServerResponse, port: number): Promise<void> => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    const path = url.pathname;
    const method = request.method ?? 'GET';

    if (method === 'GET' && path === '/ui/login') return login(request, response, url, deps.token);
    const file = STATIC_FILES[path];
    if (method === 'GET' && file) return serveStatic(response, file);
    if (!path.startsWith('/v1/ui/')) throw new HttpError(404, 'not found');

    checkUiRequest(request, port, deps.token);
    const route = path.slice('/v1/ui'.length);
    let m: RegExpExecArray | null;

    if (method === 'GET' && route === '/day') {
      return send(response, 200, await buildDay(deps, url.searchParams.get('date') ?? dayKey(now()), now()));
    }
    if (method === 'GET' && route === '/status') {
      return send(response, 200, { now: now(), today: dayKey(now()), settings: readSettings(journal) });
    }

    if (method === 'POST' && route === '/entries') return send(response, 201, journal.addEntry(entryBody(await readJson(request)), now()));
    if ((m = /^\/entries\/(\d+)$/.exec(route))) {
      if (method === 'PUT') {
        const entry = entryBody(await readJson(request));
        if (!journal.updateEntry(id(m), entry)) throw new HttpError(404, 'no such entry');
        return send(response, 200, { id: id(m), ...entry });
      }
      if (method === 'DELETE') return send(response, journal.deleteEntry(id(m)) ? 204 : 404);
    }

    if (method === 'POST' && route === '/tasks') {
      const body = (await readJson(request)) as Record<string, unknown>;
      return send(response, 201, journal.addTask(day(body['day']), text(body['text'], 'Task', 300), now()));
    }
    if (method === 'POST' && route === '/tasks/carry') {
      const body = (await readJson(request)) as Record<string, unknown>;
      return send(response, 200, journal.carryOver(day(body['from']), day(body['to']), now()));
    }
    if ((m = /^\/tasks\/(\d+)$/.exec(route))) {
      if (method === 'PATCH') {
        const body = (await readJson(request)) as Record<string, unknown>;
        const change: { text?: string; done?: boolean } = {};
        if (body['text'] !== undefined) change.text = text(body['text'], 'Task', 300);
        if (body['done'] !== undefined) {
          if (typeof body['done'] !== 'boolean') throw new HttpError(400, 'done must be true or false');
          change.done = body['done'];
        }
        const task = journal.updateTask(id(m), change, now());
        if (!task) throw new HttpError(404, 'no such task');
        return send(response, 200, task);
      }
      if (method === 'DELETE') return send(response, journal.deleteTask(id(m)) ? 204 : 404);
    }

    if (method === 'GET' && route === '/week') {
      return send(response, 200, await buildWeek(deps, url.searchParams.get('date') ?? dayKey(now()), now()));
    }

    if (method === 'PUT' && route === '/checkins') {
      const body = (await readJson(request)) as Record<string, unknown>;
      const change: { mood?: number | null; energy?: number | null; note?: string | null } = {};
      const mood = rating(body['mood'], 'mood');
      const energy = rating(body['energy'], 'energy');
      const note = clearableText(body['note'], 'Note', 1000);
      if (mood !== undefined) change.mood = mood;
      if (energy !== undefined) change.energy = energy;
      if (note !== undefined) change.note = note;
      return send(response, 200, journal.setCheckin(day(body['day']), checkinPart(body['part']), change, now()));
    }

    if (method === 'POST' && route === '/goals') {
      const body = (await readJson(request)) as Record<string, unknown>;
      return send(response, 201, journal.addGoal(day(body['day']), text(body['text'], 'Goal', 200), now()));
    }
    if ((m = /^\/goals\/(\d+)$/.exec(route))) {
      if (method === 'PATCH') {
        const body = (await readJson(request)) as Record<string, unknown>;
        const change: { text?: string; result?: GoalResult | null } = {};
        if (body['text'] !== undefined) change.text = text(body['text'], 'Goal', 200);
        if (body['result'] !== undefined) change.result = goalResult(body['result']);
        const goal = journal.updateGoal(id(m), change);
        if (!goal) throw new HttpError(404, 'no such goal');
        return send(response, 200, goal);
      }
      if (method === 'DELETE') return send(response, journal.deleteGoal(id(m)) ? 204 : 404);
    }

    if ((m = /^\/reviews\/(\d{4}-\d{2}-\d{2})$/.exec(route)) && method === 'PUT') {
      const week = day(m[1]);
      if (mondayOf(week) !== week) throw new HttpError(400, 'a review is for a week, named by its Monday');
      const body = (await readJson(request)) as Record<string, unknown>;
      const change: { wentWell?: string | null; toChange?: string | null } = {};
      const wentWell = clearableText(body['wentWell'], 'What went well', 2000);
      const toChange = clearableText(body['toChange'], 'What to change', 2000);
      if (wentWell !== undefined) change.wentWell = wentWell;
      if (toChange !== undefined) change.toChange = toChange;
      return send(response, 200, journal.setReview(week, change, now()));
    }

    if (method === 'GET' && route === '/reminders') return send(response, 200, journal.reminders().map((r) => reminderView(r, now())));
    if (method === 'POST' && route === '/reminders') {
      const body = (await readJson(request)) as Record<string, unknown>;
      const reminder = journal.addReminder(text(body['text'], 'Reminder', 200), schedule(body['schedule']), body['enabled'] !== false, now());
      return send(response, 201, reminderView(reminder, now()));
    }
    if ((m = /^\/reminders\/(\d+)\/test$/.exec(route)) && method === 'POST') {
      const reminder = journal.reminder(id(m));
      if (!reminder) throw new HttpError(404, 'no such reminder');
      await deps.testReminder(reminder);
      return send(response, 204);
    }
    if ((m = /^\/reminders\/(\d+)$/.exec(route))) {
      if (method === 'PATCH') {
        const body = (await readJson(request)) as Record<string, unknown>;
        const change: { text?: string; schedule?: ReturnType<typeof parseSchedule>; enabled?: boolean } = {};
        if (body['text'] !== undefined) change.text = text(body['text'], 'Reminder', 200);
        if (body['schedule'] !== undefined) change.schedule = schedule(body['schedule']);
        if (body['enabled'] !== undefined) {
          if (typeof body['enabled'] !== 'boolean') throw new HttpError(400, 'enabled must be true or false');
          change.enabled = body['enabled'];
        }
        const reminder = journal.updateReminder(id(m), change, now());
        if (!reminder) throw new HttpError(404, 'no such reminder');
        return send(response, 200, reminderView(reminder, now()));
      }
      if (method === 'DELETE') return send(response, journal.deleteReminder(id(m)) ? 204 : 404);
    }

    if (route === '/settings') {
      if (method === 'GET') return send(response, 200, readSettings(journal));
      if (method === 'PUT') {
        let merged: PlannerSettings;
        try {
          merged = mergeSettings(readSettings(journal), await readJson(request));
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(400, (error as Error).message);
        }
        journal.set('settings', merged);
        return send(response, 200, merged);
      }
    }
    if (method === 'POST' && route === '/evening/test') {
      await deps.testEvening();
      return send(response, 204);
    }
    if (method === 'POST' && route === '/projects/reminder/test') {
      if (!deps.testProjectReminder) throw new HttpError(503, 'notifications are not available');
      return send(response, 200, { sent: await deps.testProjectReminder() });
    }

    if (await projectRoutes(journal, method, route, url, request, response, dayKey(now()))) return;

    throw new HttpError(404, 'not found');
  };
}
