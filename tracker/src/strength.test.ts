import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StrengthSet } from './strength.ts';
import { bodyweightOn, levelOf, liftRule, liftRules, ratioFor, scoreOf, strengthBalance, strengthFocus, strengthGains, strengthScores, strengthTrend } from './strength.ts';

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
    assert.deepEqual(liftRules('Romanian Deadlift').map((r) => r.group), ['glutes', 'hamstrings']);
    assert.deepEqual(liftRules('Barbell Deadlift').map((r) => r.group), ['glutes', 'hamstrings']);
    assert.deepEqual(liftRules('Smith Machine Hip Thrust').map((r) => r.group), ['glutes']);
    assert.deepEqual(liftRules('Machine Seated Leg Curl').map((r) => r.group), ['hamstrings']);
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

  it('scores glutes and hamstrings apart, and counts them as one in the lower body', () => {
    // RDL 100 × 1 → 103.3 kg: 1.29 × bw. Hip thrust 160 × 1 → 165.3 kg: 2.07 × bw.
    const s = strengthScores([set('Romanian Deadlift', 100, 1), set('Barbell Hip Thrust', 160, 1), set('Barbell Squat', 120, 1)], bw, '2026-11-17');
    const glutes = s.groups.find((g) => g.id === 'glutes')!;
    const hams = s.groups.find((g) => g.id === 'hamstrings')!;
    assert.equal(glutes.best?.exercise, 'Barbell Hip Thrust');
    assert.equal(hams.best?.exercise, 'Romanian Deadlift');
    assert.deepEqual(glutes.lifts.map((l) => l.exercise), ['Barbell Hip Thrust', 'Romanian Deadlift']);
    assert.notEqual(glutes.score, hams.score);
    const quads = s.groups.find((g) => g.id === 'quads')!.score as number;
    assert.equal(s.lower, Math.round((quads + Math.round(((glutes.score as number) + (hams.score as number)) / 2)) / 2));
    assert.equal(strengthBalance(s).pairs.find((p) => p.id === 'glutes-hamstrings')!.status, 'a ahead');
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

describe('how old and how sure a score is', () => {
  const group = (s: ReturnType<typeof strengthScores>, id: string) => s.groups.find((g) => g.id === id)!;

  it('keeps a group nothing recent trains, marked lapsed, and lets it go after 180 days', () => {
    const sets = [set('Barbell Bench Press', 80, 1, '2026-07-01'), set('Barbell Squat', 120, 1, '2026-11-10')];
    const s = strengthScores(sets, bw, '2026-11-17');
    const chest = group(s, 'chest');
    assert.equal(chest.score, 307);
    assert.equal(chest.lapsed, true);
    assert.equal(chest.keptUntil, '2026-12-28');
    assert.equal(s.upper, 307);
    assert.equal(group(s, 'quads').lapsed, false);
    assert.equal(group(strengthScores(sets, bw, '2026-12-29'), 'chest').score, null);
  });

  it('holds a score until the last set as strong as the best leaves the window', () => {
    const one = strengthScores([set('Barbell Bench Press', 80, 1, '2026-09-01')], bw, '2026-11-17');
    assert.equal(group(one, 'chest').keptUntil, '2026-11-30');
    const again = strengthScores([set('Barbell Bench Press', 80, 1, '2026-09-01'), set('Barbell Bench Press', 80, 1, '2026-10-20'), set('Barbell Bench Press', 60, 1, '2026-11-10')], bw, '2026-11-17');
    assert.equal(group(again, 'chest').keptUntil, '2027-01-18');
    assert.equal(group(again, 'chest').lastDay, '2026-11-10');
  });

  it('trusts the lift itself, less a conversion, least a big one', () => {
    const s = strengthScores([set('Barbell Bench Press', 80, 1), set('Dumbbell Shoulder Press', 25, 5), set('Machine Seated Leg Curl', 40, 12)], bw, '2026-11-17');
    assert.equal(group(s, 'chest').confidence, 'high');
    assert.equal(group(s, 'shoulders').confidence, 'medium');
    assert.equal(group(s, 'hamstrings').confidence, 'low');
    assert.equal(group(s, 'quads').confidence, null);
  });

  it('lists recent lifts that count toward nothing, once each', () => {
    const s = strengthScores([set('Dumbbell Lateral Raise', 10, 12), set('dumbbell lateral raise', 12, 10), set('Barbell Bench Press', 80, 1), set('Cable Fly', 15, 12, '2026-05-01')], bw, '2026-11-17');
    assert.deepEqual(s.uncounted, ['Dumbbell Lateral Raise']);
  });

  it('marks a gap that rests on a low-confidence score', () => {
    const s = strengthScores([set('Barbell Hip Thrust', 160, 1), set('Machine Seated Leg Curl', 30, 12), set('Barbell Squat', 120, 1)], bw, '2026-11-17');
    const p = strengthBalance(s).pairs.find((x) => x.id === 'glutes-hamstrings')!;
    assert.equal(p.lowConfidence, true);
    assert.match(p.message, /\(low confidence\)$/);
    assert.equal(strengthBalance(s).pairs.find((x) => x.id === 'upper-lower')!.lowConfidence, false);
  });
});

describe('strength focus', () => {
  it('puts a lapsed group first, then what ages out soonest, a rough guess, and a lagging group, each once', () => {
    const sets = [
      set('Barbell Overhead Press', 60, 1, '2026-07-01'), // shoulders: lapsed
      set('Barbell Bench Press', 80, 1, '2026-08-25'), // chest: ages out 23 Nov
      set('Barbell Bent-Over Row', 72, 1, '2026-08-30'), // back: ages out 28 Nov
      set('Machine Seated Leg Curl', 30, 12), // hamstrings: low and lagging
      set('Barbell Squat', 60, 1), // quads: lagging
    ];
    const s = strengthScores(sets, bw, '2026-11-17');
    const all = strengthFocus(s, strengthBalance(s), 10);
    assert.deepEqual(all.map((f) => [f.kind, f.group]), [['lapsed', 'shoulders'], ['expiring', 'chest'], ['expiring', 'back'], ['confidence', 'hamstrings'], ['lagging', 'quads']]);
    assert.equal(all[1]!.title, 'Chest: best set ages out after 23 Nov');
    assert.match(all[3]!.detail, /Log a Barbell Romanian Deadlift/);
    assert.equal(strengthFocus(s, strengthBalance(s)).length, 3);
  });

  it('has nothing to say about a fresh, even, well-measured week', () => {
    const s = strengthScores([set('Barbell Bench Press', 80, 1), set('Barbell Bent-Over Row', 80, 1)], bw, '2026-11-17');
    assert.deepEqual(strengthFocus(s, strengthBalance(s)), []);
  });
});

describe('body figure', () => {
  it('shades each muscle by its level and escapes names', async () => {
    const { bodyFigureSvg, levelStep } = await import('./bodyFigure.ts');
    assert.equal(levelStep(null), null);
    assert.equal(levelStep(50), 0);
    assert.equal(levelStep(368), 3);
    assert.equal(levelStep(600), 5);
    const svg = bodyFigureSvg([
      { id: 'chest', name: 'Chest <&>', score: 520, level: 'Elite' },
      { id: 'back', name: 'Back', score: null, level: null },
    ]);
    assert.match(svg, /class="bf-m bf-l5" data-group="chest"/);
    assert.match(svg, /class="bf-m bf-none" data-group="back"/);
    assert.match(svg, /Chest &lt;&amp;&gt;: 520 · Elite/);
    assert.doesNotMatch(svg, /<&>/);
  });

  it('writes each score on its muscle, once, as something a keyboard can reach', async () => {
    const { bodyFigureSvg } = await import('./bodyFigure.ts');
    const svg = bodyFigureSvg([
      { id: 'chest', name: 'Chest', score: 368, level: 'Intermediate' },
      { id: 'quads', name: 'Quads', score: 301, level: 'Intermediate' },
      { id: 'back', name: 'Back', score: null, level: null },
    ]);
    assert.equal(svg.match(/class="bf-num"/g)?.length, 2);
    assert.match(svg, /<text class="bf-num" data-group="chest" tabindex="0" role="button" aria-label="Chest: 368 · Intermediate"[^>]*>368<\/text>/);
    assert.doesNotMatch(svg, /data-group="back" tabindex/);
  });

  it('shades against your average when asked', async () => {
    const { bodyFigureSvg, relativeSteps } = await import('./bodyFigure.ts');
    const groups = [
      { id: 'chest' as const, name: 'Chest', score: 368, level: 'Intermediate' },
      { id: 'back' as const, name: 'Back', score: 402, level: 'Advanced' },
      { id: 'glutes' as const, name: 'Glutes', score: 419, level: 'Advanced' },
      { id: 'quads' as const, name: 'Quads', score: 300, level: 'Intermediate' },
      { id: 'hamstrings' as const, name: 'Hamstrings', score: 213, level: 'Novice' },
      { id: 'biceps' as const, name: 'Biceps', score: null, level: null },
    ];
    // Each against the mean of the other four: hamstrings 159 under, quads 51 under, chest 35 over, glutes 98 over.
    const steps = relativeSteps(groups);
    assert.equal(steps.get('hamstrings'), 'bf-r-far');
    assert.equal(steps.get('quads'), 'bf-r-behind');
    assert.equal(steps.get('chest'), 'bf-r-near');
    assert.equal(steps.get('glutes'), 'bf-r-ahead');
    assert.equal(steps.has('biceps'), false);
    const svg = bodyFigureSvg(groups, 'relative');
    assert.match(svg, /class="bf-m bf-r-far" data-group="hamstrings"/);
    assert.match(svg, /class="bf-m bf-none" data-group="biceps"/);
    assert.equal(relativeSteps(groups.slice(0, 2)).size, 0);
  });
});

describe('targets, weigh-ins and gains', () => {
  const group = (s: ReturnType<typeof strengthScores>, id: string) => s.groups.find((g) => g.id === id)!;

  it('turns a score back into a ratio', () => {
    for (const score of [0, 50, 100, 250, 301, 499, 500, 550]) assert.equal(scoreOf(ratioFor(score, bench), bench), score);
  });

  it('gives a nearer step when the next level is more than 25 points off', () => {
    // 80 kg bodyweight, squat 120 × 1: a 124 kg 1RM, 1.55× → 307. Advanced (400) is far; 332 is near.
    const s = strengthScores([set('Barbell Squat', 120, 1)], bw, '2026-11-17');
    const quads = group(s, 'quads');
    assert.equal(quads.score, 307);
    assert.equal(quads.milestone?.score, 332);
    assert.equal(quads.milestone?.reps, 1);
    assert.ok((quads.milestone?.weight as number) > 120 && (quads.milestone?.weight as number) < (quads.next?.weight as number));
    // Bench 80 × 1 is 307 too, but a bench this close to 400 gets no step: 1.48× → 396.
    const near = group(strengthScores([set('Barbell Bench Press', 115, 1)], bw, '2026-11-17'), 'chest');
    assert.ok(near.next && near.next.score - (near.score as number) <= 25);
    assert.equal(near.milestone, null);
  });

  it('says which weigh-in the score uses', () => {
    const s = strengthScores([set('Barbell Bench Press', 80, 1)], [{ day: '2026-10-01', weight: 82 }, { day: '2026-11-01', weight: 80 }, { day: '2026-11-20', weight: 79 }], '2026-11-17');
    assert.equal(s.bodyweight, 80);
    assert.equal(s.bodyweightDay, '2026-11-01');
    assert.equal(strengthScores([set('Barbell Bench Press', 80, 1)], [], '2026-11-17', 'men', 80).bodyweightDay, null);
  });

  it('shows the last day a best was matched, not the first', () => {
    const s = strengthScores([set('Barbell Bench Press', 80, 5, '2026-11-01'), set('Barbell Bench Press', 80, 5, '2026-11-12'), set('Barbell Bench Press', 70, 5, '2026-11-15')], bw, '2026-11-17');
    assert.equal(group(s, 'chest').best?.day, '2026-11-12');
  });

  it('ranks each group’s change over the trend', () => {
    const gains = strengthGains([
      { groups: { chest: 300, quads: 200, back: null } },
      { groups: { chest: 310, quads: 260, back: 350 } },
      { groups: { chest: 305, quads: 280, back: null } },
    ]);
    assert.deepEqual(gains.map((g) => [g.id, g.change]), [['quads', 80], ['chest', 5]]);
  });
});
