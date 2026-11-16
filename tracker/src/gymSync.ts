// Sends رقيب's training plan and workout history up to the gym app (gym/, on Convex), so the
// phone always has what the PC knows. It runs when رقيب starts and when its window opens,
// and only once gym-sync.json in the data folder says where to send it:
//
//   { "url": "https://your-deployment.convex.cloud", "syncKey": "the SYNC_KEY you set in Convex" }
//
// Safe to repeat: the plan goes up only the first time (after that the phone owns plans),
// PC workouts are matched by their id, and workouts logged on the phone are never touched.
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
    const workouts = all('SELECT * FROM workouts ORDER BY id').map((w) => ({
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

export interface GymSyncResult {
  planPushed: boolean;
  workouts: number;
  added: number;
  updated: number;
}

export async function pushToGym(dbFile: string, target: GymTarget, options: { replacePlan?: boolean; fetch?: Fetch } = {}): Promise<GymSyncResult> {
  const { plan, workouts } = collectForGym(dbFile);
  const pushed = (await convexMutation(target, 'sync:pushPlan', { ...plan, replacePlan: options.replacePlan ?? false }, options.fetch)) as { planPushed: boolean };
  let added = 0;
  let updated = 0;
  for (let i = 0; i < workouts.length; i += 40) {
    const r = (await convexMutation(target, 'sync:pushWorkouts', { workouts: workouts.slice(i, i + 40) }, options.fetch)) as { added: number; updated: number };
    added += r.added;
    updated += r.updated;
  }
  return { planPushed: pushed.planPushed, workouts: workouts.length, added, updated };
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
      (r) => logger.info(`Gym sync (${why}): ${r.workouts} workouts, ${r.added} added, ${r.updated} changed${r.planPushed ? ', plan sent' : ''}`),
      (error: unknown) => logger.error(`Gym sync (${why}) failed`, error),
    ).finally(() => {
      running = false;
    });
  };
}
