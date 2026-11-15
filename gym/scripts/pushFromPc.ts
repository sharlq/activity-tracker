// Copies رقيب's training plan and workout history from the PC's database up to Convex, so
// the gym app starts with everything. Safe to run again: the plan goes up only the first
// time (after that the phone owns plans), PC workouts are matched by their id, and
// workouts logged in the gym app are never touched.
//
//   SYNC_KEY=... npm run push-from-pc            (uses VITE_CONVEX_URL from .env.local)
//   SYNC_KEY=... npm run push-from-pc -- --replace-plan   (overwrite the phone's plans with the PC's)
//   SYNC_KEY=... CONVEX_URL=https://... npm run push-from-pc
import Database from 'better-sqlite3';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function envFile(): Record<string, string> {
  const file = new URL('../.env.local', import.meta.url);
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => /^([A-Z_]+)=(.*?)(\s*#.*)?$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1] as string, (m[2] as string).replace(/^["']|["']$/g, '')]),
  );
}

const env = envFile();
const url = process.env['CONVEX_URL'] ?? env['VITE_CONVEX_URL'];
const key = process.env['SYNC_KEY'] ?? env['SYNC_KEY'];
if (!url || !key) {
  console.error('Set SYNC_KEY (and CONVEX_URL, or VITE_CONVEX_URL in gym/.env.local).');
  process.exit(1);
}
const home = process.env['ACTIVITY_TRACKER_HOME'] ?? join(homedir(), '.activity-tracker');
const db = new Database(join(home, 'data.db'), { readonly: true, fileMustExist: true });
const client = new ConvexHttpClient(url);

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
  return {
    num: r['id'] as number, dayNum: r['day_id'] as number, position: r['position'] as number, name: r['name'] as string, aliases,
    sets: r['sets'] as number, repMin: r['rep_min'] as number, repMax: r['rep_max'] as number, step: r['step_kg'] as number,
    laterSlot, perHand: r['per_hand'] === 1, bodyweight: r['bodyweight'] === 1, note: (r['note'] as string | null) ?? null, active: r['active'] === 1,
    restSeconds: restFrom(r['name'] as string, (r['note'] as string | null) ?? null, laterSlot),
    goals: goals.filter((g) => g['id'] === r['id']).map((g) => ({ day: g['day'] as string, weight: g['weight'] as number })),
  };
});

const setting = db.prepare("SELECT value FROM settings WHERE key = 'training.heightCm'").get() as { value: string } | undefined;
const plan = await client.mutation(anyApi['sync']!['pushPlan']!, {
  key,
  days: all('SELECT id, name, position, note FROM plan_days').map((d) => ({ num: d['id'], name: d['name'], position: d['position'], note: d['note'] ?? null })),
  exercises,
  checkpoints: all('SELECT day, label FROM checkpoints'),
  bodyGoals: all('SELECT day, weight_kg AS weight, lean_kg AS lean FROM body_goals'),
  weighIns: all('SELECT * FROM weigh_ins').map((w) => ({ day: w['day'], weight: w['weight_kg'], bodyFat: w['body_fat_pct'] ?? null, waist: w['waist_cm'] ?? null, note: w['note'] ?? null, at: w['updated_ms'] })),
  settings: setting ? [{ key: 'training.heightCm', value: JSON.parse(setting.value) as unknown }] : [],
  replacePlan: process.argv.includes('--replace-plan'),
});
console.log(plan.planPushed ? `Plan: ${plan.days} days, ${plan.exercises} exercises, as "Main plan"` : 'Plan: left as it is (the phone has plans; --replace-plan overwrites them)');

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
  createdAt: w['created_ms'] as number, updatedAt: w['created_ms'] as number, origin: 'pc',
}));

let added = 0;
let updated = 0;
for (let i = 0; i < workouts.length; i += 40) {
  const r = await client.mutation(anyApi['sync']!['pushWorkouts']!, { key, workouts: workouts.slice(i, i + 40) });
  added += r.added;
  updated += r.updated;
}
console.log(`Workouts: ${workouts.length} on the PC, ${added} added, ${updated} updated`);
