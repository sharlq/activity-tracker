// Sends رقيب's training plan and workout history up to the gym app (gym/, on Convex), so the
// phone always has what the PC knows. It runs when رقيب starts and when its window opens,
// and only once gym-sync.json in the data folder says where to send it:
//
//   { "url": "https://your-deployment.convex.cloud", "syncKey": "the SYNC_KEY you set in Convex" }
//
// Safe to repeat: the plan goes up only the first time (after that the phone owns plans),
// PC workouts are matched by their id, and workouts logged on the phone are never touched.
// Workouts logged on the phone come back down first (pullFromGym), under the phone's own
// ids (100,000,000 and up), so they show here and the PC's suggestions count them.
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from './logger.ts';

export const GYM_SYNC_FILE = 'gym-sync.json';

export interface GymTarget {
  url: string;
  syncKey: string;
}

/** Where to sync to, from gym-sync.json in the data folder; null when there's no file. */
export function loadGymTarget(dir: string): GymTarget | null {
  const file = join(dir, GYM_SYNC_FILE);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const url = r['url'];
  const syncKey = r['syncKey'];
  if (typeof url !== 'string' || !/^https?:\/\/[^\s/]+/.test(url)) throw new Error(`${file}: "url" must be the Convex deployment URL (https://….convex.cloud)`);
  if (typeof syncKey !== 'string' || syncKey.length < 20) throw new Error(`${file}: "syncKey" must be the SYNC_KEY set in Convex (20 characters or more)`);
  return { url: url.replace(/\/+$/, ''), syncKey };
}

/** The rest timer's first length: from the plan's note ("rest 2–3 min"), else by the kind of lift. */
export function restFrom(name: string, note: string | null, laterSlot: boolean): number {
  const m = /rest\s+(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*min/i.exec(note ?? '');
  if (m) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    return Math.round(((a + b) / 2) * 60);
  }
  return /^barbell/i.test(name) && !laterSlot ? 150 : 90;
}

type Row = Record<string, unknown>;

/** Ids the gym app gives what's logged there start here; below it is the PC's own. */
export const GYM_FIRST_NUM = 100_000_000;
/** The settings row holding the last phone change already pulled (ms). */
export const GYM_PULLED_KEY = 'gym.pulledUntil';

/** Everything the gym app gets from the PC, read from the database without changing it. */
export function collectForGym(dbFile: string) {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const all = (sql: string) => db.prepare(sql).all() as Row[];
    const goals = all('SELECT plan_exercise_id AS id, day, weight_kg AS weight FROM exercise_goals ORDER BY day');
    const exercises = all('SELECT * FROM plan_exercises ORDER BY day_id, position, id').map((r) => {
      let aliases: string[] = [];
      try {
        const parsed = JSON.parse(String(r['aliases'])) as unknown;
        if (Array.isArray(parsed)) aliases = parsed.filter((a): a is string => typeof a === 'string');
      } catch {
        // A broken list is no aliases.
      }
      const laterSlot = r['later_slot'] === 1;
      const note = (r['note'] as string | null) ?? null;
      return {
        num: r['id'] as number, dayNum: r['day_id'] as number, position: r['position'] as number, name: r['name'] as string, aliases,
        sets: r['sets'] as number, repMin: r['rep_min'] as number, repMax: r['rep_max'] as number, step: r['step_kg'] as number,
        laterSlot, perHand: r['per_hand'] === 1, bodyweight: r['bodyweight'] === 1, note, active: r['active'] === 1,
        restSeconds: restFrom(r['name'] as string, note, laterSlot),
        goals: goals.filter((g) => g['id'] === r['id']).map((g) => ({ day: g['day'] as string, weight: g['weight'] as number })),
      };
    });
    const height = db.prepare("SELECT value FROM settings WHERE key = 'training.heightCm'").get() as { value: string } | undefined;
    const plan = {
      days: all('SELECT id, name, position, note FROM plan_days').map((d) => ({ num: d['id'], name: d['name'], position: d['position'], note: d['note'] ?? null })),
      exercises,
      checkpoints: all('SELECT day, label FROM checkpoints'),
      bodyGoals: all('SELECT day, weight_kg AS weight, lean_kg AS lean FROM body_goals'),
      weighIns: all('SELECT * FROM weigh_ins').map((w) => ({ day: w['day'], weight: w['weight_kg'], bodyFat: w['body_fat_pct'] ?? null, waist: w['waist_cm'] ?? null, note: w['note'] ?? null, at: w['updated_ms'] })),
      settings: height ? [{ key: 'training.heightCm', value: JSON.parse(height.value) as unknown }] : [],
    };

    const sets = all('SELECT * FROM workout_sets ORDER BY workout_id, position, set_no, id');
    const logs = all('SELECT * FROM exercise_logs');
    const workouts = all(`SELECT * FROM workouts WHERE id < ${GYM_FIRST_NUM} ORDER BY id`).map((w) => ({
      num: w['id'] as number, day: w['day'] as string, start: (w['start_ms'] as number | null) ?? null, end: null, name: w['name'] as string,
      kind: w['kind'] as string, minutes: (w['minutes'] as number | null) ?? null, calories: (w['calories'] as number | null) ?? null,
      note: (w['note'] as string | null) ?? null, source: w['source'] as string, externalId: (w['external_id'] as string | null) ?? null,
      planDayNum: (w['plan_day_id'] as number | null) ?? null,
      sets: sets.filter((s) => s['workout_id'] === w['id']).map((s) => ({
        num: s['id'] as number, exercise: s['exercise'] as string, position: s['position'] as number, setNo: s['set_no'] as number,
        reps: (s['reps'] as number | null) ?? null, weight: (s['weight_kg'] as number | null) ?? null, rpe: (s['rpe'] as number | null) ?? null,
        seconds: (s['seconds'] as number | null) ?? null, distance: (s['distance_m'] as number | null) ?? null, flag: (s['flag'] as string | null) ?? null, at: null,
      })),
      logs: logs.filter((l) => l['workout_id'] === w['id']).map((l) => ({ exercise: l['exercise'] as string, formReset: l['form_reset'] === 1, note: (l['note'] as string | null) ?? null })),
      createdAt: w['created_ms'] as number, updatedAt: w['created_ms'] as number, origin: 'pc' as const,
    }));
    return { plan, workouts };
  } finally {
    db.close();
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** One Convex mutation over its plain HTTP API, so رقيب needs no Convex package. */
export async function convexMutation(target: GymTarget, path: string, args: Record<string, unknown>, fetchImpl: Fetch = fetch): Promise<unknown> {
  const response = await fetchImpl(`${target.url}/api/mutation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args: { key: target.syncKey, ...args }, format: 'json' }),
  });
  let body: { status?: string; value?: unknown; errorMessage?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Not JSON: reported below by its status.
  }
  if (body.status === 'success') return body.value;
  throw new Error(body.errorMessage ?? `Convex answered ${response.status}`);
}

/** One Convex query over its plain HTTP API. */
export async function convexQuery(target: GymTarget, path: string, args: Record<string, unknown>, fetchImpl: Fetch = fetch): Promise<unknown> {
  const response = await fetchImpl(`${target.url}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args: { key: target.syncKey, ...args }, format: 'json' }),
  });
  let body: { status?: string; value?: unknown; errorMessage?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Not JSON: reported below by its status.
  }
  if (body.status === 'success') return body.value;
  throw new Error(body.errorMessage ?? `Convex answered ${response.status}`);
}

/** A workout as the gym app's changedSince returns it. */
export interface GymWorkout {
  num: number; day: string; start: number | null; end: number | null; name: string; kind: string;
  minutes: number | null; calories: number | null; note: string | null; source: string; externalId: string | null;
  planDayNum: number | null; createdAt: number; updatedAt: number; origin: string; deleted?: boolean;
  sets: { num: number; exercise: string; position: number; setNo: number; reps: number | null; weight: number | null; rpe: number | null; seconds: number | null; distance: number | null; flag: string | null; at: number | null }[];
  logs: { exercise: string; formReset: boolean; note: string | null }[];
}

/** Writes phone workouts into the database: new and changed ones replace what's here, deleted ones go. */
export function applyGymWorkouts(dbFile: string, workouts: GymWorkout[]): { saved: number; removed: number; until: number | null } {
  const db = new Database(dbFile, { fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  try {
    let saved = 0;
    let removed = 0;
    let until: number | null = null;
    const drop = (id: number) => {
      db.prepare('DELETE FROM workout_sets WHERE workout_id = ?').run(id);
      db.prepare('DELETE FROM exercise_logs WHERE workout_id = ?').run(id);
      return db.prepare('DELETE FROM workouts WHERE id = ?').run(id).changes;
    };
    const addWorkout = db.prepare(`INSERT INTO workouts (id, day, start_ms, name, kind, minutes, calories, note, source, external_id, created_ms, plan_day_id)
      VALUES (@id, @day, @start, @name, @kind, @minutes, @calories, @note, @source, @externalId, @createdAt, @planDayNum)`);
    const addSet = db.prepare(`INSERT INTO workout_sets (id, workout_id, position, exercise, set_no, reps, weight_kg, rpe, seconds, distance_m, flag)
      VALUES (@num, @workout, @position, @exercise, @setNo, @reps, @weight, @rpe, @seconds, @distance, @flag)`);
    const addLog = db.prepare('INSERT OR REPLACE INTO exercise_logs (workout_id, exercise, form_reset, note) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      for (const w of workouts) {
        until = Math.max(until ?? 0, w.updatedAt);
        // Only the phone's own ids: a PC workout is never overwritten from there.
        if (w.num < GYM_FIRST_NUM) continue;
        if (w.deleted) {
          removed += drop(w.num);
          continue;
        }
        drop(w.num);
        // Minutes from the start and finish, when the phone didn't give any.
        const minutes = w.minutes ?? (w.start !== null && w.end !== null && w.end > w.start ? Math.round((w.end - w.start) / 60_000) : null);
        addWorkout.run({ ...w, id: w.num, minutes, externalId: null, source: 'gym' });
        for (const s of w.sets) addSet.run({ ...s, workout: w.num });
        for (const l of w.logs) addLog.run(w.num, l.exercise, l.formReset ? 1 : 0, l.note);
        saved++;
      }
      if (until !== null) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(GYM_PULLED_KEY, JSON.stringify(until));
    })();
    return { saved, removed, until };
  } finally {
    db.close();
  }
}

function pulledUntil(dbFile: string): number {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(GYM_PULLED_KEY) as { value: string } | undefined;
    const n = row ? Number(JSON.parse(row.value)) : 0;
    return Number.isFinite(n) ? n : 0;
  } finally {
    db.close();
  }
}

/** Fetches what was logged or changed on the phone since the last pull, and saves it here. */
export async function pullFromGym(dbFile: string, target: GymTarget, options: { fetch?: Fetch } = {}): Promise<{ saved: number; removed: number }> {
  let since = pulledUntil(dbFile);
  let saved = 0;
  let removed = 0;
  for (;;) {
    const rows = (await convexQuery(target, 'sync:changedSince', { since }, options.fetch)) as GymWorkout[];
    const r = applyGymWorkouts(dbFile, rows);
    saved += r.saved;
    removed += r.removed;
    // changedSince returns at most 200, so ask again while it's full.
    if (rows.length < 200 || r.until === null || r.until <= since) break;
    since = r.until;
  }
  return { saved, removed };
}

export interface GymSyncResult {
  pulled: number;
  removed: number;
  planPushed: boolean;
  workouts: number;
  added: number;
  updated: number;
}

export async function pushToGym(dbFile: string, target: GymTarget, options: { replacePlan?: boolean; fetch?: Fetch } = {}): Promise<GymSyncResult> {
  const { saved: pulled, removed } = await pullFromGym(dbFile, target, options);
  const { plan, workouts } = collectForGym(dbFile);
  const pushed = (await convexMutation(target, 'sync:pushPlan', { ...plan, replacePlan: options.replacePlan ?? false }, options.fetch)) as { planPushed: boolean };
  let added = 0;
  let updated = 0;
  for (let i = 0; i < workouts.length; i += 40) {
    const r = (await convexMutation(target, 'sync:pushWorkouts', { workouts: workouts.slice(i, i + 40) }, options.fetch)) as { added: number; updated: number };
    added += r.added;
    updated += r.updated;
  }
  return { pulled, removed, planPushed: pushed.planPushed, workouts: workouts.length, added, updated };
}

/** How often opening the window may sync again: often enough to be current, not on every click. */
export const GYM_SYNC_GAP_MS = 5 * 60_000;

/**
 * The sync as رقيب runs it: in the background, one at a time, at most once per gap, and
 * quietly off until gym-sync.json exists. Failures go to the log, never to the window.
 */
export function gymSyncer(dbFile: string, dir: string, logger: Logger, now: () => number = Date.now, push: typeof pushToGym = pushToGym) {
  let running = false;
  let lastStart = -Infinity;
  let warned = false;
  return (why: string): Promise<void> | null => {
    if (running || now() - lastStart < GYM_SYNC_GAP_MS) return null;
    let target: GymTarget | null;
    try {
      target = loadGymTarget(dir);
    } catch (error) {
      if (!warned) logger.error('Gym sync is off', error);
      warned = true;
      return null;
    }
    if (!target) return null;
    warned = false;
    running = true;
    lastStart = now();
    return push(dbFile, target).then(
      (r) => logger.info(`Gym sync (${why}): ${r.pulled} from the phone${r.removed ? `, ${r.removed} removed` : ''}, ${r.workouts} workouts, ${r.added} added, ${r.updated} changed${r.planPushed ? ', plan sent' : ''}`),
      (error: unknown) => logger.error(`Gym sync (${why}) failed`, error),
    ).finally(() => {
      running = false;
    });
  };
}
