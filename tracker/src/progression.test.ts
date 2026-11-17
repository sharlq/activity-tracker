import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExerciseRule, Session } from './progression.ts';
import { bodyFlags, estimated1RM, expectedOn, ffmi, flags, goalFor, goalProgress, medianChange, rollingAverage, suggest, thresholds, verdict, weightLabel } from './progression.ts';

const rule = (sets: number, repMin: number, repMax: number, laterSlot = false, step = 2.5, extra: Partial<ExerciseRule> = {}): ExerciseRule => ({ sets, repMin, repMax, step, laterSlot, ...extra });
const squat = rule(3, 6, 10);

describe('the progression engine', () => {
  it('holds a squat at 85 × 8/8/8 (24 < 27)', () => {
    const v = verdict(squat, 85, [8, 8, 8]);
    assert.equal(v.kind, 'HOLD');
    assert.equal(v.total, 24);
    assert.equal(v.threshold, 27);
    assert.equal(v.nextWeight, 85);
    assert.deepEqual(v.beat, [8, 8, 8]);
    assert.equal(v.message, 'Same weight: beat your reps');
  });

  it('adds weight to a squat at 85 × 10/9/8 (27)', () => {
    const v = verdict(squat, 85, [10, 9, 8]);
    assert.equal(v.kind, 'ADD_WEIGHT');
    assert.equal(v.nextWeight, 87.5);
    assert.equal(v.message, 'Add 2.5 kg next time');
  });

  it('holds a row at 85 × 8/7/6', () => {
    assert.equal(verdict(rule(3, 6, 10), 85, [8, 7, 6]).kind, 'HOLD');
  });

  it('calls a DB bench at 30 × 10/6/4 too heavy (4 < 8)', () => {
    const v = verdict(rule(3, 8, 12, false, 2.5, { perHand: true }), 30, [10, 6, 4]);
    assert.equal(v.kind, 'TOO_HEAVY');
    assert.equal(v.lowestOk, 8);
    assert.equal(v.message, 'Too heavy: drop 2.5 kg or rest longer');
    assert.equal(v.nextWeight, 27.5);
  });

  it('calls a later-slot shoulder press at 25 × 7/5/4 too heavy (lowest OK 6)', () => {
    const v = verdict(rule(3, 8, 12, true), 25, [7, 5, 4]);
    assert.equal(v.lowestOk, 6);
    assert.equal(v.kind, 'TOO_HEAVY');
  });

  it('adds weight to a later-slot incline fly at 22.5 × 15/13/12 (40 = 40)', () => {
    const v = verdict(rule(3, 10, 15, true), 22.5, [15, 13, 12]);
    assert.equal(v.threshold, 40);
    assert.equal(v.kind, 'ADD_WEIGHT');
  });

  it('holds the same reps in a first slot (threshold 42)', () => {
    const v = verdict(rule(3, 10, 15), 22.5, [15, 13, 12]);
    assert.equal(v.threshold, 42);
    assert.equal(v.kind, 'HOLD');
  });

  it('adds load to pull-ups at BW × 9/8/8 (25)', () => {
    const pullUp = rule(3, 6, 10, true, 2.5, { bodyweight: true });
    const v = verdict(pullUp, 0, [9, 8, 8]);
    assert.equal(v.total, 25);
    assert.equal(v.kind, 'ADD_WEIGHT');
    assert.equal(v.nextWeight, 2.5);
    assert.equal(weightLabel(v.nextWeight, pullUp), '+2.5');
  });

  it('uses 2 sets for a 2-set exercise with an empty third set', () => {
    const curl = rule(2, 8, 12, true);
    assert.deepEqual(thresholds(curl), { threshold: 22, lowestOk: 6 });
    assert.deepEqual(thresholds(rule(2, 8, 12)), { threshold: 23, lowestOk: 8 });
    const v = verdict(curl, 17, [12, 10, null]);
    assert.equal(v.total, 22);
    assert.equal(v.kind, 'ADD_WEIGHT');
    assert.equal(verdict(curl, 17, [11, 10, null]).kind, 'HOLD');
  });

  it('labels weights', () => {
    const pullUp = { bodyweight: true };
    assert.equal(weightLabel(0, pullUp), 'BW');
    assert.equal(weightLabel(5, pullUp), '+5');
    assert.equal(weightLabel(30, { perHand: true }), '30 kg per hand');
    assert.equal(weightLabel(87.5), '87.5 kg');
  });

  it('estimates a 1RM from the best set', () => {
    assert.equal(estimated1RM(100, [5, 3]), 116.67);
  });

  it('suggests the next weight and the reps to beat', () => {
    const s = (day: string, weight: number, reps: number[]): Session => ({ day, weight, reps });
    assert.equal(suggest(squat, [], 85).weight, 85);
    const hold = suggest(squat, [s('2026-11-10', 85, [8, 8, 8])], 85);
    assert.equal(hold.weight, 85);
    assert.deepEqual(hold.beat, [8, 8, 8]);
    const up = suggest(squat, [s('2026-11-03', 87.5, [7, 6, 6]), s('2026-11-10', 85, [10, 9, 8])], 85);
    assert.equal(up.weight, 87.5);
    assert.deepEqual(up.beat, [7, 6, 6]);
  });
});

const CHECKPOINTS = [
  { day: '2026-11-14', weight: 67.5 },
  { day: '2027-02-14', weight: 72.5 },
  { day: '2027-05-14', weight: 75 },
  { day: '2027-08-14', weight: 77.5 },
  { day: '2027-11-14', weight: 80 },
];

describe('goals', () => {
  it('targets the next checkpoint on or after the day', () => {
    assert.deepEqual(goalFor(CHECKPOINTS, '2026-12-01'), { day: '2027-02-14', weight: 72.5 });
    assert.deepEqual(goalFor(CHECKPOINTS, '2027-02-14'), { day: '2027-02-14', weight: 72.5 });
    // The first checkpoint is the starting point, not a goal.
    assert.deepEqual(goalFor(CHECKPOINTS, '2026-11-14'), { day: '2027-02-14', weight: 72.5 });
    assert.deepEqual(goalFor(CHECKPOINTS, '2026-01-01'), { day: '2027-02-14', weight: 72.5 });
    assert.deepEqual(goalFor(CHECKPOINTS, '2028-01-01'), { day: '2027-11-14', weight: 80 });
  });

  it('draws a straight line between checkpoints', () => {
    assert.equal(expectedOn(CHECKPOINTS, '2026-11-14'), 67.5);
    assert.equal(expectedOn(CHECKPOINTS, '2026-01-01'), 67.5);
    assert.equal(expectedOn(CHECKPOINTS, '2027-02-14'), 72.5);
    const mid = expectedOn(CHECKPOINTS, '2026-12-30') as number; // 46 of 92 days.
    assert.ok(Math.abs(mid - 70) < 0.01, String(mid));
  });

  it('says on track, behind, or ahead, within one step', () => {
    assert.equal(goalProgress(CHECKPOINTS, '2026-12-30', 70, 2.5)?.status, 'on track');
    assert.equal(goalProgress(CHECKPOINTS, '2026-12-30', 67.5, 2.5)?.status, 'on track');
    assert.equal(goalProgress(CHECKPOINTS, '2026-12-30', 65, 2.5)?.status, 'behind');
    assert.equal(goalProgress(CHECKPOINTS, '2026-12-30', 72.5, 2.5)?.status, 'on track');
    assert.equal(goalProgress(CHECKPOINTS, '2026-12-30', 75, 2.5)?.status, 'ahead');
    assert.equal(goalProgress(CHECKPOINTS, '2026-12-30', 70, 2.5)?.ratio, 0.97); // 70 / 72.5
  });
});

describe('stalls and regressions', () => {
  const s = (day: string, weight: number, reps: number[], extra: Partial<Session> = {}): Session => ({ day, weight, reps, ...extra });

  it('flags 4 sessions at one weight without more reps', () => {
    const list = [s('2026-10-01', 85, [8, 8, 8]), s('2026-10-04', 85, [8, 8, 7]), s('2026-10-08', 85, [8, 8, 8]), s('2026-10-11', 85, [8, 7, 7])];
    assert.deepEqual(flags(squat, list).map((f) => f.kind), ['stalled']);
    assert.deepEqual(flags(squat, list.slice(0, 3)), []);
    const better = [...list.slice(0, 3), s('2026-10-11', 85, [9, 8, 8])];
    assert.deepEqual(flags(squat, better), []);
  });

  it('leaves copied sessions out', () => {
    const list = [s('2026-10-01', 85, [8, 8, 8]), s('2026-10-04', 85, [8, 8, 8], { copied: true }), s('2026-10-08', 85, [8, 8, 8], { copied: true }), s('2026-10-11', 85, [8, 8, 8])];
    assert.deepEqual(flags(squat, list), []);
  });

  it('flags earning more weight twice without taking it', () => {
    const list = [s('2026-10-01', 85, [10, 9, 8]), s('2026-10-04', 85, [10, 10, 9])];
    assert.deepEqual(flags(squat, list).map((f) => f.kind), ['left on the table']);
  });

  it('flags going lighter, but not after a form reset or a too-heavy session', () => {
    const drop = [s('2026-10-01', 85, [8, 8, 8]), s('2026-10-04', 80, [8, 8, 8])];
    assert.deepEqual(flags(squat, drop).map((f) => f.kind), ['regression']);
    const reset = [s('2026-10-01', 85, [8, 8, 8]), s('2026-10-04', 80, [8, 8, 8], { formReset: true })];
    assert.deepEqual(flags(squat, reset), []);
    const tooHeavy = [s('2026-10-01', 85, [8, 5, 4]), s('2026-10-04', 82.5, [8, 8, 8])];
    assert.deepEqual(flags(squat, tooHeavy), []);
  });

  it('starts the stall count again after a form reset', () => {
    const list = [s('2026-10-01', 80, [8, 8, 8]), s('2026-10-04', 80, [8, 8, 8], { formReset: true }), s('2026-10-08', 80, [8, 8, 8]), s('2026-10-11', 80, [8, 8, 8])];
    assert.deepEqual(flags(squat, list), []);
  });
});

describe('body and the dashboard', () => {
  it('works out FFMI and the 7-day average', () => {
    assert.equal(ffmi(58.6, 172), 19.81);
    const avg = rollingAverage([{ day: '2026-11-01', weight: 71, waist: null }, { day: '2026-11-05', weight: 72, waist: null }, { day: '2026-11-10', weight: 73, waist: null }]);
    assert.deepEqual(avg, [{ day: '2026-11-01', weight: 71 }, { day: '2026-11-05', weight: 71.5 }, { day: '2026-11-10', weight: 72.5 }]);
  });

  it('says eat more when weight is flat for 3 weeks', () => {
    const flat = ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'].map((day) => ({ day, weight: 71.5, waist: null }));
    assert.deepEqual(bodyFlags(flat, '2026-11-12', 0).map((f) => f.kind), ['flat']);
    const rising = flat.map((p, i) => ({ ...p, weight: 71.5 + i * 0.2 }));
    assert.deepEqual(bodyFlags(rising, '2026-11-12', 0), []);
  });

  it('flags a growing waist only while lifts stall', () => {
    const points = [{ day: '2026-10-15', weight: 71, waist: 80 }, { day: '2026-11-01', weight: 71.6, waist: 81 }, { day: '2026-11-12', weight: 72.2, waist: 82 }];
    assert.deepEqual(bodyFlags(points, '2026-11-12', 0.5).map((f) => f.kind), ['waist']);
    assert.deepEqual(bodyFlags(points, '2026-11-12', 0.1), []);
  });

  it('takes the median % change across exercises', () => {
    const ex = (a: number, b: number) => ({ sessions: [{ day: '2026-08-01', weight: a, reps: [] }, { day: '2026-10-01', weight: b, reps: [] }] });
    assert.equal(medianChange([ex(100, 110), ex(50, 50), ex(20, 22)], '2026-08-14', '2026-11-14'), 10);
  });
});

describe('copied sessions', () => {
  it('marks 3+ sessions in a row identical to the one before', async () => {
    const { copiedRuns } = await import('./progression.ts');
    const a = { weight: 85, reps: [8, 8, 8] };
    const b = { weight: 85, reps: [9, 8, 8] };
    assert.deepEqual([...copiedRuns([a, a, a, a, b])], [1, 2, 3]);
    assert.deepEqual([...copiedRuns([a, a, a, b, b])], []);
  });
});

it('nextSets: a set more when stuck, back to the plan at a new weight, one fewer when the extra set costs reps', async () => {
  const { nextSets, suggest } = await import('./progression.ts');
  const rule = { sets: 3, repMin: 8, repMax: 12, step: 2.5, laterSlot: false };
  const at = (day: string, weight: number, reps: number[]) => ({ day, weight, reps });
  const stuck = [at('01', 22.5, [9, 8, 8]), at('02', 22.5, [8, 8, 8]), at('03', 22.5, [8, 8, 9])];
  assert.deepEqual(nextSets(rule, []), { sets: 3, reason: null });
  assert.deepEqual(nextSets(rule, stuck.slice(0, 2)), { sets: 3, reason: null });
  assert.equal(nextSets(rule, stuck).sets, 4);
  assert.equal(suggest(rule, stuck, null).sets, 4);
  // Doing 4: the extra set doesn't count toward the verdict, and they're kept while reps move.
  const four = [...stuck, at('04', 22.5, [9, 9, 8, 6])];
  assert.deepEqual(nextSets(rule, four), { sets: 4, reason: 'Keep 4 sets until the reps move' });
  // The extra set cost reps on the plan's sets: back one.
  assert.equal(nextSets(rule, [...stuck, at('04', 22.5, [8, 7, 8, 6])]).sets, 3);
  // Stuck again at 4: a fifth, but never past plan + 2.
  const stuck4 = [...four, at('05', 22.5, [9, 8, 8, 6]), at('06', 22.5, [8, 9, 8, 6])];
  assert.equal(nextSets(rule, stuck4).sets, 5);
  const five = [...stuck4, at('07', 22.5, [9, 8, 8, 7, 6]), at('08', 22.5, [8, 9, 8, 6, 6]), at('09', 22.5, [9, 9, 8, 6, 5])];
  assert.equal(nextSets(rule, five).sets, 5);
  // Earning weight or too heavy: the plan's 3.
  assert.deepEqual(nextSets(rule, [...four, at('05', 22.5, [12, 11, 10, 8])]), { sets: 3, reason: 'Back to 3 sets at the new weight' });
  assert.equal(nextSets(rule, [...four, at('05', 25, [7, 5, 4, 3])]).sets, 3);
  // Copied sessions don't make a stall.
  assert.equal(nextSets(rule, stuck.map((s, i) => ({ ...s, copied: i > 0 }))).sets, 3);
});
