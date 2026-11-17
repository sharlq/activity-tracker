import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StrengthSet } from './strength.ts';
import { bodyweightOn, levelOf, liftRule, scoreOf, strengthBalance, strengthScores, strengthTrend } from './strength.ts';

const bench = [0.5, 0.75, 1, 1.5, 2];
const set = (exercise: string, weight: number | null, reps: number, day = '2026-11-10', flag: string | null = null): StrengthSet => ({ day, exercise, weight, reps, flag });
const bw = [{ day: '2026-11-01', weight: 80 }];

describe('strength score', () => {
  it('puts each standard on a hundred', () => {
    assert.equal(scoreOf(0.5, bench), 100);
    assert.equal(scoreOf(1, bench), 300);
    assert.equal(scoreOf(1.25, bench), 350);
    assert.equal(scoreOf(0.25, bench), 50);
    assert.equal(scoreOf(2, bench), 500);
    assert.equal(scoreOf(9, bench), 600);
    assert.equal(levelOf(99), null);
    assert.equal(levelOf(350), 'Intermediate');
    assert.equal(levelOf(600), 'Elite');
  });

  it('knows the lifts, and leaves isolation work out', () => {
    assert.equal(liftRule('Barbell Bench Press')?.group, 'chest');
    assert.equal(liftRule('dumbbell bench press')?.load, 'double');
    assert.equal(liftRule('Pull-Up')?.load, 'bodyweight');
    assert.equal(liftRule('Romanian Deadlift')?.group, 'posterior');
    assert.equal(liftRule('Barbell Reverse Curl'), null);
    assert.equal(liftRule('Cable Single Arm Lateral Raise'), null);
    assert.equal(liftRule('Squat Jump'), null);
  });

  it('scores a group by its best lift as the reference lift', () => {
    // 80 × 1.0 bodyweight: 80 kg × 1 rep is a 1RM of 82.67 → 1.03 × bw → 307.
    const s = strengthScores([set('Barbell Bench Press', 80, 1), set('Barbell Bench Press', 60, 5)], bw, '2026-11-17');
    const chest = s.groups.find((g) => g.id === 'chest')!;
    assert.equal(chest.best?.weight, 80);
    assert.equal(chest.score, 307);
    assert.equal(chest.level, 'Intermediate');
    assert.equal(chest.next?.level, 'Advanced');
    // 1.5 × 80 = 120 kg 1RM at 1 rep: 116.25 → 117.5 on the bar.
    assert.equal(chest.next?.weight, 117.5);
  });

  it('counts both dumbbells and the bodyweight on pull-ups', () => {
    const s = strengthScores([set('Dumbbell Bench Press', 30, 10), set('Pull-Up', null, 8)], bw, '2026-11-17');
    const chest = s.groups.find((g) => g.id === 'chest')!;
    assert.equal(chest.best?.e1rm, 80); // 60 × (1 + 10/30)
    const back = s.groups.find((g) => g.id === 'back')!;
    assert.equal(back.best?.e1rm, 101.3); // 80 × (1 + 8/30)
  });

  it('leaves out old sets, typos and long sets', () => {
    const s = strengthScores([set('Barbell Squat', 200, 5, '2026-01-01'), set('Barbell Squat', 300, 5, '2026-11-10', 'outlier'), set('Barbell Squat', 100, 20)], bw, '2026-11-17');
    assert.equal(s.groups.find((g) => g.id === 'quads')!.score, null);
    assert.equal(s.lower, null);
  });

  it('averages upper and lower body for the overall score', () => {
    const s = strengthScores([set('Barbell Bench Press', 80, 1), set('Barbell Squat', 120, 1)], bw, '2026-11-17');
    assert.equal(s.upper, 307);
    assert.equal(s.lower, s.groups.find((g) => g.id === 'quads')!.score);
    assert.equal(s.overall, Math.round(((s.upper as number) + (s.lower as number)) / 2));
  });

  it('needs a bodyweight', () => {
    assert.equal(strengthScores([set('Barbell Bench Press', 80, 1)], [], '2026-11-17').overall, null);
    assert.equal(strengthScores([set('Barbell Bench Press', 80, 1)], [], '2026-11-17', 'men', 80).upper, 307);
    assert.equal(bodyweightOn([{ day: '2026-12-01', weight: 70 }], '2026-11-01'), 70);
  });

  it('uses the women’s standards when asked', () => {
    const men = strengthScores([set('Barbell Bench Press', 60, 1)], bw, '2026-11-17', 'men');
    const women = strengthScores([set('Barbell Bench Press', 60, 1)], bw, '2026-11-17', 'women');
    assert.ok((women.upper as number) > (men.upper as number));
  });
});

describe('strength balance', () => {
  it('flags the group that lags the rest', () => {
    const s = strengthScores(
      [set('Barbell Bench Press', 80, 1), set('Barbell Bent-Over Row', 72, 1), set('Barbell Overhead Press', 60, 1), set('Barbell Squat', 60, 1)],
      bw,
      '2026-11-17',
    );
    const b = strengthBalance(s);
    assert.deepEqual(b.lagging.map((g) => g.id), ['quads']);
    const ul = b.pairs.find((p) => p.id === 'upper-lower')!;
    assert.equal(ul.status, 'a ahead');
    assert.match(ul.message, /^Lower body lags upper body by \d+ points$/);
    assert.equal(b.pairs.find((p) => p.id === 'biceps-triceps')!.status, 'unknown');
  });

  it('follows the score back in time', () => {
    const t = strengthTrend([set('Barbell Bench Press', 80, 1, '2026-11-10')], bw, '2026-11-17', 'men', null, 3, 7);
    assert.deepEqual(t.map((p) => p.day), ['2026-11-03', '2026-11-10', '2026-11-17']);
    assert.deepEqual(t.map((p) => p.groups.chest), [null, 307, 307]);
  });
});
