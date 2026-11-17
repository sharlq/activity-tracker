import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { machineFor } from './machineSwap.ts';
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
