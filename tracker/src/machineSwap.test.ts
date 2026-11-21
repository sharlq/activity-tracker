import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { FORM_FLAG, MACHINE_SWAPS, historyFor, machineFor, machineSwapSql } from './machineSwap.ts';
import { strengthScores } from './strength.ts';
import { weightLabel } from './progression.ts';
import { Store } from './store.ts';

test('a fresh database gets the machines in the benches\' and the cable fly\'s places, and keeps the old ones archived', () => {
  const dir = mkdtempSync(join(tmpdir(), 'machine-swap-'));
  try {
    const file = join(dir, 'data.db');
    new Store(file).close();
    const db = new Database(file, { readonly: true });
    const rows = db.prepare('SELECT d.name AS day, e.position, e.name, e.active, e.per_side, e.sets, e.rep_min, e.rep_max, e.later_slot, e.aliases FROM plan_exercises e JOIN plan_days d ON d.id = e.day_id ORDER BY d.position, e.position, e.active DESC').all() as Record<string, unknown>[];
    const goals = db.prepare("SELECT COUNT(*) AS n FROM exercise_goals WHERE plan_exercise_id IN (SELECT id FROM plan_exercises WHERE per_side = 1)").get() as { n: number };
    db.close();
    const at = (day: string, position: number) => rows.filter((r) => r['day'] === day && r['position'] === position).map((r) => `${r['name']}${r['active'] ? '' : ' (archived)'}`);
    assert.deepEqual(at('Upper A', 1), ['Iso-Lateral Flat Chest Press (Machine)', 'Barbell Bench Press (archived)']);
    assert.deepEqual(at('Upper B', 1), ['Iso-Lateral Flat Chest Press (Machine)', 'Dumbbell Bench Press (archived)']);
    assert.deepEqual(at('Upper B', 3), ['Incline Chest Fly (Plate-Loaded)', 'Cable Seated Incline Fly (archived)']);
    const press = rows.find((r) => r['day'] === 'Upper A' && r['active'] === 1 && r['position'] === 1)!;
    assert.deepEqual([press['sets'], press['rep_min'], press['rep_max'], press['per_side'], press['later_slot'], press['aliases']], [3, 6, 10, 1, 0, '[]']);
    const fly = rows.find((r) => r['name'] === 'Incline Chest Fly (Plate-Loaded)')!;
    assert.deepEqual([fly['rep_min'], fly['rep_max'], fly['later_slot']], [10, 15, 1]);
    // One press per day, and nothing carried over.
    assert.equal(rows.filter((r) => r['active'] === 1 && String(r['name']).includes('Chest Press')).length, 2);
    assert.equal(goals.n, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('machineFor: any spelling of an old lift; per side in labels', () => {
  assert.equal(machineFor(' dumbbell bench press')?.name, 'Iso-Lateral Flat Chest Press (Machine)');
  assert.equal(machineFor('Cable Seated Incline Fly')?.name, 'Incline Chest Fly (Plate-Loaded)');
  assert.equal(machineFor('Dumbbell Shoulder Press'), null);
  assert.equal(weightLabel(40, { perSide: true }), '40 kg per side');
});

test('gapsBetweenSets: seconds since the set logged before it, in tap order, whatever the exercise', async () => {
  const { averageGap, gapsBetweenSets } = await import('./setTimes.ts');
  const gaps = gapsBetweenSets([
    { num: 1, at: 1_000 }, { num: 3, at: 181_000 }, { num: 2, at: 91_000 }, { num: 4, at: null },
  ]);
  assert.deepEqual([...gaps.entries()].sort((a, b) => a[0] - b[0]), [[1, null], [2, 90], [3, 90], [4, null]]);
  assert.equal(averageGap([null, 90, 150]), 120);
  assert.equal(averageGap([null]), null);
});

test('the hip thrust machine takes the Smith hip thrust’s place, goals from 80 kg, and its history flagged for form', () => {
  const dir = mkdtempSync(join(tmpdir(), 'machine-swap-'));
  try {
    const file = join(dir, 'data.db');
    new Store(file).close();
    const db = new Database(file);
    const plan = db.prepare("SELECT d.name AS day, e.id, e.position, e.name, e.active, e.step_kg FROM plan_exercises e JOIN plan_days d ON d.id = e.day_id WHERE e.name LIKE '%Hip Thrust%' ORDER BY e.active DESC").all() as Record<string, unknown>[];
    assert.deepEqual(plan.map((r) => [r['day'], r['position'], r['name'], r['active']]), [['Lower B', 3, 'Iso-Lateral Hip Thrust (Machine)', 1], ['Lower B', 3, 'Smith Machine Hip Thrust', 0]]);
    const goals = db.prepare('SELECT weight_kg FROM exercise_goals WHERE plan_exercise_id = ? ORDER BY day').all(plan[0]!['id']).map((r) => (r as { weight_kg: number }).weight_kg);
    assert.deepEqual(goals, [80, 90, 100, 110, 120]);
    // Old-app sets under the stand-in name: renamed and flagged; a typo stays a typo. Running it again adds nothing.
    db.exec("INSERT INTO workouts (id, day, name, created_ms) VALUES (1, '2026-09-17', 'Legs', 0)");
    db.exec("INSERT INTO workout_sets (workout_id, position, exercise, set_no, reps, weight_kg, flag) VALUES (1, 1, 'Smith Machine Hip Thrust', 1, 12, 150, NULL), (1, 1, 'smith machine hip thrust', 2, 11, 1500, 'outlier'), (1, 2, 'Barbell Squat', 1, 8, 80, NULL), (1, 3, 'Bodyweight Single-Leg Hip Thrust', 1, 12, 40, NULL)");
    const swap = MACHINE_SWAPS.filter((s) => s.renameHistory);
    db.exec(machineSwapSql(1, swap));
    db.exec(machineSwapSql(2, swap));
    const sets = db.prepare('SELECT exercise, flag FROM workout_sets ORDER BY id').all() as { exercise: string; flag: string | null }[];
    assert.deepEqual(sets.map((s) => [s.exercise, s.flag]), [['Iso-Lateral Hip Thrust (Machine)', FORM_FLAG], ['Iso-Lateral Hip Thrust (Machine)', 'outlier'], ['Barbell Squat', null], ['Iso-Lateral Hip Thrust (Machine)', null]]);
    // One side's 40 kg is both sides' 80, once however often it runs.
    assert.equal((db.prepare('SELECT weight_kg AS w FROM workout_sets ORDER BY id DESC LIMIT 1').get() as { w: number }).w, 80);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM plan_exercises WHERE name = 'Iso-Lateral Hip Thrust (Machine)'").get() as { n: number }).n, 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(historyFor(' smith machine hip thrust'), { name: 'Iso-Lateral Hip Thrust (Machine)', flag: FORM_FLAG, weightTimes: 1 });
  assert.deepEqual(historyFor('Bodyweight Single-Leg Hip Thrust'), { name: 'Iso-Lateral Hip Thrust (Machine)', flag: null, weightTimes: 2 });
  assert.equal(historyFor('Barbell Bench Press'), null);
});

test('strength: sets flagged for form don’t count; the hip thrust machine counts at 0.8', () => {
  const bw = [{ day: '2026-11-01', weight: 72 }];
  const set = (weight: number, flag: string | null = null) => ({ day: '2026-11-10', exercise: 'Iso-Lateral Hip Thrust (Machine)', weight, reps: 12, flag });
  const glutes = (sets: ReturnType<typeof set>[]) => strengthScores(sets, bw, '2026-11-20').groups.find((g) => g.id === 'glutes')!;
  assert.equal(glutes([set(150, FORM_FLAG)]).score, null);
  // 80 × 12 → 112 kg e1RM × 0.8 = 89.6 kg as a barbell hip thrust.
  assert.equal(glutes([set(150, FORM_FLAG), set(80)]).best?.equivalent, 89.6);
  assert.equal(glutes([set(80)]).confidence, 'medium');
});
