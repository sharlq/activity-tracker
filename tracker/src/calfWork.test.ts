import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { calfWorkSql, SEATED_CALF_RAISE, TIBIALIS_RAISE } from './calfWork.ts';
import { STANDING_CALF_RAISE, machineFor } from './machineSwap.ts';
import { works } from './muscles.ts';
import { Store } from './store.ts';

test('the calf day: the standing machine in the dumbbell raise\'s place, then the seated machine and the tibialis raise', () => {
  const dir = mkdtempSync(join(tmpdir(), 'calf-work-'));
  try {
    const file = join(dir, 'data.db');
    new Store(file).close();
    const db = new Database(file);
    const day = () => db.prepare("SELECT e.position, e.name, e.active, e.sets, e.rep_min, e.rep_max, e.note FROM plan_exercises e JOIN plan_days d ON d.id = e.day_id WHERE d.name = 'Lower A' ORDER BY e.active DESC, e.position").all() as Record<string, unknown>[];
    const before = day();
    const active = before.filter((r) => r['active'] === 1).map((r) => `${r['position']} ${r['name']}`);
    assert.deepEqual(active, [
      '1 Barbell Squat', '2 Romanian Deadlift', '3 Machine Seated Leg Curl', '4 Machine Single-Leg Extension',
      `5 ${STANDING_CALF_RAISE}`, `6 ${SEATED_CALF_RAISE.name}`, `7 ${TIBIALIS_RAISE.name}`, '8 Machine Seated Crunch',
    ]);
    // The dumbbell raise is archived, not deleted, and the machine keeps its sets and reps.
    assert.deepEqual(before.filter((r) => r['active'] === 0).map((r) => r['name']), ['Dumbbell Single-Leg Calf Raise']);
    const standing = before.find((r) => r['name'] === STANDING_CALF_RAISE)!;
    assert.deepEqual([standing['sets'], standing['rep_min'], standing['rep_max']], [3, 10, 15]);
    const tib = before.find((r) => r['name'] === TIBIALIS_RAISE.name)!;
    assert.deepEqual([tib['sets'], tib['rep_min'], tib['rep_max']], [3, 12, 15]);
    // Running it again changes nothing.
    db.exec(calfWorkSql(Date.now()));
    assert.deepEqual(day(), before);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the dumbbell calf raise comes in as the standing machine; the tibialis raise trains the tibialis', () => {
  assert.equal(machineFor('Dumbbell Single-Leg Calf Raise')?.name, STANDING_CALF_RAISE);
  assert.deepEqual(works(TIBIALIS_RAISE.name)?.main, ['Tibialis']);
  assert.deepEqual(works(SEATED_CALF_RAISE.name)?.main, ['Calves']);
});
