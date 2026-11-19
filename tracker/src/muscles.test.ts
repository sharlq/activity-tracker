import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { Journal } from './journal.ts';
import { planLoad, verdict, works } from './muscles.ts';
import { Store } from './store.ts';
import { plansSource, plansView } from './uiTraining.ts';

describe('muscles a plan works', () => {
  it('matches the specific name before the general one', () => {
    assert.deepEqual(works('Machine Seated Leg Curl')?.main, ['Hamstrings']);
    assert.deepEqual(works('Dumbbell Curl')?.main, ['Biceps']);
    assert.deepEqual(works('Barbell Reverse Curl')?.main, ['Forearms']);
    assert.deepEqual(works('Cable Reverse Fly')?.main, ['Rear delts']);
    assert.deepEqual(works('Cable Seated Incline Fly')?.main, ['Chest']);
    assert.deepEqual(works('Cable Single Arm Lateral Raise')?.main, ['Side delts']);
    assert.deepEqual(works('Romanian Deadlift')?.main, ['Hamstrings', 'Glutes']);
    assert.deepEqual(works('Machine Single-Leg Extension')?.main, ['Quads']);
    assert.equal(works('Something Odd'), null);
  });

  it('counts helper sets as half and days with direct work as the frequency', () => {
    const load = planLoad([
      { name: 'Upper', exercises: [{ name: 'Barbell Bench Press', sets: 3 }, { name: 'Cable Tricep Extension', sets: 2 }, { name: 'Mystery Move', sets: 3 }] },
      { name: 'Upper 2', exercises: [{ name: 'Dumbbell Bench Press', sets: 4 }] },
    ]);
    const chest = load.muscles.find((m) => m.muscle === 'Chest')!;
    const triceps = load.muscles.find((m) => m.muscle === 'Triceps')!;
    assert.equal(chest.total, 7);
    assert.equal(chest.days, 2);
    assert.equal(triceps.direct, 2);
    assert.equal(triceps.indirect, 7);
    assert.equal(triceps.total, 5.5);
    assert.equal(triceps.days, 1);
    assert.deepEqual(load.unknown, [{ day: 'Upper', exercise: 'Mystery Move' }]);
    assert.equal(verdict(chest), 'low');
    assert.equal(verdict(load.muscles.find((m) => m.muscle === 'Calves')!), null);
  });
});

describe('every plan for the window', () => {
  const dirs: string[] = [];
  const saved = { ...plansSource };
  afterEach(() => {
    Object.assign(plansSource, saved);
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const journal = () => {
    const dir = mkdtempSync(join(tmpdir(), 'raqib-plans-'));
    dirs.push(dir);
    const db = join(dir, 'data.db');
    new Store(db).close();
    return new Journal(db);
  };

  it("shows the phone's plans when it syncs with the gym app", async () => {
    const j = journal();
    let asked = '';
    plansSource.target = () => ({ url: 'https://x.convex.cloud', syncKey: 's'.repeat(32) });
    plansSource.fetch = async (_url, init) => {
      asked = JSON.parse(init.body).path;
      const value = [
        { name: 'A', note: null, active: true, days: [{ name: 'Day 1', note: null, exercises: [{ name: 'Barbell Squat', sets: 3, repMin: 6, repMax: 10, note: null }] }] },
        { name: 'B', note: null, active: false, days: [] },
      ];
      return { ok: true, status: 200, json: async () => ({ status: 'success', value }) };
    };
    const v = await plansView(j);
    j.close();
    assert.equal(asked, 'sync:plans');
    assert.equal(v.source, 'phone');
    assert.deepEqual(v.plans.map((p) => p.name), ['A', 'B']);
    assert.equal(v.plans[0]!.load.muscles.find((m) => m.muscle === 'Quads')!.total, 3);
  });

  it("falls back to this PC's plan, saying why, when the gym app can't answer", async () => {
    const j = journal();
    plansSource.target = () => ({ url: 'https://x.convex.cloud', syncKey: 's'.repeat(32) });
    plansSource.fetch = async () => ({ ok: false, status: 404, json: async () => ({ status: 'error', errorMessage: "Could not find public function for 'sync:plans'" }) });
    const v = await plansView(j);
    j.close();
    assert.equal(v.source, 'pc');
    assert.match(v.error ?? '', /not updated yet/);
    assert.equal(v.plans.length, 1);
  });

  it("shows only this PC's plan when there's no gym app", async () => {
    const j = journal();
    plansSource.target = () => null;
    const v = await plansView(j);
    j.close();
    assert.equal(v.source, 'pc');
    assert.equal(v.error, null);
  });
});
