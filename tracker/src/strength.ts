// Strength score and strength balance, in the spirit of Caliber's: how strong each muscle
// group is for your bodyweight, and whether some groups lag the rest.
//
// Each group has a reference lift with five bodyweight-ratio standards (Beginner … Elite,
// approximations of the widely published tables). Every logged lift that trains a group
// is turned into that reference lift's equivalent: its estimated 1RM (Epley, like the
// progression engine) on the full load (both dumbbells, both sides, bodyweight plus added
// for pull-ups) times a factor. Cable stacks and plate-loaded machines aren't calibrated
// like a bar, and one arm on a cable moves more than half of two, so their factors are
// conservative. A group's score is its best lift over the last 90 days,
// on a scale where each level is 100 points: 100 Beginner, 200 Novice, 300 Intermediate,
// 400 Advanced, 500 Elite. The overall score is the mean of upper body and lower body, so
// arms don't outweigh legs. Pure: it reads sets and weigh-ins, nothing else.
import { estimated1RM } from './progression.ts';

export type GroupId = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads' | 'posterior';
export type Standards = 'men' | 'women';

export interface GroupInfo {
  id: GroupId;
  name: string;
  region: 'upper' | 'lower';
  /** What its scores are in: a 1RM on this lift. */
  reference: string;
  /** 1RM ÷ bodyweight at Beginner, Novice, Intermediate, Advanced, Elite. */
  men: readonly number[];
  women: readonly number[];
}

export const GROUPS: readonly GroupInfo[] = [
  { id: 'chest', name: 'Chest', region: 'upper', reference: 'Barbell Bench Press', men: [0.5, 0.75, 1, 1.5, 2], women: [0.25, 0.5, 0.75, 1, 1.5] },
  { id: 'back', name: 'Back', region: 'upper', reference: 'Barbell Bent-Over Row', men: [0.5, 0.75, 1, 1.5, 1.75], women: [0.25, 0.4, 0.65, 0.9, 1.2] },
  { id: 'shoulders', name: 'Shoulders', region: 'upper', reference: 'Barbell Overhead Press', men: [0.35, 0.55, 0.8, 1.1, 1.4], women: [0.2, 0.35, 0.5, 0.75, 1] },
  { id: 'biceps', name: 'Biceps', region: 'upper', reference: 'Barbell Curl', men: [0.2, 0.4, 0.6, 0.85, 1.15], women: [0.1, 0.2, 0.4, 0.6, 0.85] },
  { id: 'triceps', name: 'Triceps', region: 'upper', reference: 'Cable Tricep Pushdown', men: [0.25, 0.5, 0.75, 1, 1.35], women: [0.15, 0.3, 0.5, 0.7, 1] },
  { id: 'quads', name: 'Quads', region: 'lower', reference: 'Barbell Squat', men: [0.75, 1.25, 1.5, 2.25, 2.75], women: [0.5, 0.75, 1.25, 1.5, 2] },
  { id: 'posterior', name: 'Glutes & hamstrings', region: 'lower', reference: 'Barbell Deadlift', men: [1, 1.5, 2, 2.5, 3], women: [0.5, 1, 1.25, 1.75, 2.5] },
];

export const LEVELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'] as const;

/**
 * How a lift's logged weight becomes the load moved: 'total' as logged (a bar, a stack),
 * 'double' twice it (a dumbbell per hand, one arm at a time, plates per side), and
 * 'bodyweight' your weight plus what's logged (added kg; none is just you).
 */
type Load = 'total' | 'double' | 'bodyweight';

interface LiftRule {
  match: RegExp;
  group: GroupId;
  load: Load;
  /** Its 1RM × this = the reference lift's 1RM. */
  factor: number;
}

/** First match wins; a lift that matches none (isolation work, forearms, jumps) doesn't count. */
const LIFTS: readonly LiftRule[] = [
  // Chest: bench press.
  { match: /^(barbell )?bench press$/, group: 'chest', load: 'total', factor: 1 },
  { match: /^(barbell )?incline bench press$/, group: 'chest', load: 'total', factor: 1.15 },
  { match: /^(dumbbell|db) bench press$/, group: 'chest', load: 'double', factor: 1.1 },
  { match: /^(dumbbell|db) incline bench press$/, group: 'chest', load: 'double', factor: 1.25 },
  { match: /iso-lateral.*chest press|chest press \(machine\)/, group: 'chest', load: 'double', factor: 0.7 },
  // Back: bent-over row.
  { match: /^barbell (bent-over |pendlay )?row$/, group: 'back', load: 'total', factor: 1 },
  { match: /t-bar row/, group: 'back', load: 'total', factor: 1 },
  { match: /^(dumbbell|db) (single arm |one arm )?row$/, group: 'back', load: 'double', factor: 0.9 },
  { match: /^(pull|chin)-?up$/, group: 'back', load: 'bodyweight', factor: 0.9 },
  { match: /single arm lat pulldown/, group: 'back', load: 'double', factor: 0.65 },
  { match: /lat pulldown/, group: 'back', load: 'total', factor: 0.9 },
  { match: /single arm (seated )?row/, group: 'back', load: 'double', factor: 0.65 },
  { match: /^cable seated row$|^seated cable row$/, group: 'back', load: 'total', factor: 0.9 },
  // Shoulders: overhead press.
  { match: /^(barbell )?(overhead|military|shoulder) press$/, group: 'shoulders', load: 'total', factor: 1 },
  { match: /^(dumbbell|db) (seated )?shoulder press$/, group: 'shoulders', load: 'double', factor: 1.15 },
  { match: /^machine shoulder press$/, group: 'shoulders', load: 'total', factor: 0.9 },
  // Biceps: barbell curl.
  { match: /^(barbell|ez[- ]?bar) (bicep )?curl$/, group: 'biceps', load: 'total', factor: 1 },
  { match: /^(dumbbell|db) (bicep |hammer )?curl$|^dumbbell hammer curl$/, group: 'biceps', load: 'double', factor: 1 },
  { match: /^dumbbell preacher curl$/, group: 'biceps', load: 'double', factor: 1.1 },
  { match: /^barbell preacher curl$/, group: 'biceps', load: 'total', factor: 1.1 },
  { match: /^cable (single arm )?curl \(alternating\)$|^cable single arm curl$/, group: 'biceps', load: 'double', factor: 0.7 },
  { match: /^cable curl$/, group: 'biceps', load: 'total', factor: 0.9 },
  // Triceps: cable pushdown.
  { match: /^cable single arm tricep (pushdown|extension)$/, group: 'triceps', load: 'double', factor: 0.8 },
  { match: /^(cable )?tricep (pushdown|extension)$|^cable tricep (pushdown|extension)$/, group: 'triceps', load: 'total', factor: 1 },
  // Quads: back squat.
  { match: /^(barbell )?(back )?squat$/, group: 'quads', load: 'total', factor: 1 },
  { match: /^(barbell )?front squat$/, group: 'quads', load: 'total', factor: 1.2 },
  { match: /hack (squat|press)/, group: 'quads', load: 'total', factor: 0.7 },
  { match: /leg press/, group: 'quads', load: 'total', factor: 0.5 },
  { match: /^(dumbbell|db) bulgarian split squat$/, group: 'quads', load: 'double', factor: 1.8 },
  { match: /^(dumbbell|db) (walking )?lunge$/, group: 'quads', load: 'double', factor: 1.5 },
  // Glutes and hamstrings: deadlift.
  { match: /^(barbell |conventional |sumo )?deadlift$/, group: 'posterior', load: 'total', factor: 1 },
  { match: /^(trap|hex) bar deadlift$/, group: 'posterior', load: 'total', factor: 0.95 },
  { match: /^(barbell )?(romanian deadlift|rdl|stiff[- ]leg(ged)? deadlift)$/, group: 'posterior', load: 'total', factor: 1.25 },
  { match: /^(dumbbell|db) (romanian deadlift|rdl)$/, group: 'posterior', load: 'double', factor: 1.25 },
  { match: /^(barbell |smith machine )?hip thrust$/, group: 'posterior', load: 'total', factor: 0.65 },
];

/** Sets with more reps than this say little about a 1RM. */
export const MAX_REPS = 15;
/** A group's score is its best lift over this many days. */
export const WINDOW_DAYS = 90;
/** A group this many points off the rest (0.4 of a level) is out of balance. */
export const BALANCE_GAP = 40;

const ruleCache = new Map<string, LiftRule | null>();
export function liftRule(name: string): LiftRule | null {
  const key = name.trim().toLowerCase();
  let rule = ruleCache.get(key);
  if (rule === undefined) {
    rule = LIFTS.find((r) => r.match.test(key)) ?? null;
    ruleCache.set(key, rule);
  }
  return rule;
}

export interface StrengthSet {
  day: string;
  exercise: string;
  weight: number | null;
  reps: number | null;
  flag?: string | null;
}

export interface WeighIn {
  day: string;
  weight: number;
}

/** The weight on or before the day, else the first one after; null with none. */
export function bodyweightOn(weighIns: readonly WeighIn[], day: string): number | null {
  const sorted = [...weighIns].sort((a, b) => a.day.localeCompare(b.day));
  return sorted.filter((w) => w.day <= day).at(-1)?.weight ?? sorted[0]?.weight ?? null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/** Points for a 1RM ÷ bodyweight against a group's five standards. */
export function scoreOf(ratio: number, standards: readonly number[]): number {
  const t = standards;
  const first = t[0] as number;
  if (ratio < first) return Math.max(0, Math.round((100 * ratio) / first));
  for (let i = 0; i < t.length - 1; i++) {
    const lo = t[i] as number;
    const hi = t[i + 1] as number;
    if (ratio < hi) return Math.round(100 * (i + 1) + (100 * (ratio - lo)) / (hi - lo));
  }
  const last = t.at(-1) as number;
  const prev = t.at(-2) as number;
  return Math.min(600, Math.round(500 + (100 * (ratio - last)) / (last - prev)));
}

/** The level a score has reached; null below Beginner. */
export function levelOf(score: number): (typeof LEVELS)[number] | null {
  return score < 100 ? null : LEVELS[Math.min(4, Math.floor(score / 100) - 1)] ?? null;
}

export interface LiftBest {
  exercise: string;
  day: string;
  weight: number | null;
  reps: number;
  /** The lift's own estimated 1RM, on the full load. */
  e1rm: number;
  /** As the group's reference lift. */
  equivalent: number;
  score: number;
}

export interface GroupScore {
  id: GroupId;
  name: string;
  region: 'upper' | 'lower';
  reference: string;
  /** Null when nothing in the window trains it. */
  score: number | null;
  level: string | null;
  ratio: number | null;
  best: LiftBest | null;
  /** Each lift's best in the window, highest first. */
  lifts: LiftBest[];
  /** The next level, and what the best lift would need at the same reps to reach it. */
  next: { level: string; score: number; weight: number; reps: number } | null;
}

export interface Scores {
  day: string;
  bodyweight: number | null;
  overall: number | null;
  overallLevel: string | null;
  upper: number | null;
  lower: number | null;
  groups: GroupScore[];
}

const mean = (xs: readonly (number | null)[]): number | null => {
  const list = xs.filter((x): x is number => x !== null);
  return list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;
};

/** The full load of a set, in kg, or null when it can't be told. */
function loadOf(rule: LiftRule, weight: number | null, bodyweight: number): number | null {
  if (rule.load === 'bodyweight') return bodyweight + (weight ?? 0);
  if (weight === null || weight <= 0) return null;
  return rule.load === 'double' ? weight * 2 : weight;
}

/** Back from a full load to what's logged: the inverse of loadOf. */
function loggedOf(rule: LiftRule, load: number, bodyweight: number): number {
  return rule.load === 'bodyweight' ? load - bodyweight : rule.load === 'double' ? load / 2 : load;
}

/** Every group's score on a day, from the sets in the 90 days up to it. */
export function strengthScores(sets: readonly StrengthSet[], weighIns: readonly WeighIn[], day: string, standards: Standards = 'men', bodyweightFallback: number | null = null): Scores {
  const bw = bodyweightOn(weighIns, day) ?? bodyweightFallback;
  const from = shiftDay(day, -WINDOW_DAYS);
  const best = new Map<string, LiftBest & { rule: LiftRule }>();
  if (bw !== null) {
    for (const s of sets) {
      if (s.day > day || s.day < from || s.flag === 'outlier' || s.reps === null || s.reps < 1 || s.reps > MAX_REPS) continue;
      const rule = liftRule(s.exercise);
      if (!rule) continue;
      const load = loadOf(rule, s.weight, bw);
      if (load === null || load <= 0) continue;
      const e1rm = estimated1RM(load, [s.reps]);
      const equivalent = e1rm * rule.factor;
      const key = s.exercise.trim().toLowerCase();
      const had = best.get(key);
      if (!had || equivalent > had.equivalent) best.set(key, { exercise: s.exercise, day: s.day, weight: s.weight, reps: s.reps, e1rm: r1(e1rm), equivalent, score: 0, rule });
    }
  }
  const groups: GroupScore[] = GROUPS.map((g) => {
    const standardsOf = g[standards];
    const lifts = [...best.values()]
      .filter((b) => b.rule.group === g.id)
      .map((b) => ({ ...b, score: scoreOf(b.equivalent / (bw as number), standardsOf) }))
      .sort((a, b) => b.equivalent - a.equivalent);
    const top = lifts[0];
    if (!top || bw === null) return { id: g.id, name: g.name, region: g.region, reference: g.reference, score: null, level: null, ratio: null, best: null, lifts: [], next: null };
    const score = top.score;
    const reached = Math.floor(score / 100);
    const nextIndex = reached; // LEVELS[reached] is the one above the score
    const next =
      nextIndex < LEVELS.length
        ? (() => {
            const needEquivalent = (standardsOf[nextIndex] as number) * bw;
            const needLoad = needEquivalent / top.rule.factor / (1 + top.reps / 30);
            const step = 2.5;
            const weight = Math.ceil(loggedOf(top.rule, needLoad, bw) / step) * step;
            return { level: LEVELS[nextIndex] as string, score: (nextIndex + 1) * 100, weight: r1(weight), reps: top.reps };
          })()
        : null;
    const clean = ({ rule: _rule, ...b }: LiftBest & { rule: LiftRule }): LiftBest => ({ ...b, equivalent: r1(b.equivalent) });
    return { id: g.id, name: g.name, region: g.region, reference: g.reference, score, level: levelOf(score), ratio: Math.round((top.equivalent / bw) * 100) / 100, best: clean(top), lifts: lifts.map(clean), next };
  });
  const byId = new Map(groups.map((g) => [g.id, g.score]));
  const arms = mean([byId.get('biceps') ?? null, byId.get('triceps') ?? null]);
  const upper = mean([byId.get('chest') ?? null, byId.get('back') ?? null, byId.get('shoulders') ?? null, arms]);
  const lower = mean([byId.get('quads') ?? null, byId.get('posterior') ?? null]);
  const overall = mean([upper, lower]);
  return { day, bodyweight: bw, overall, overallLevel: overall === null ? null : levelOf(overall), upper, lower, groups };
}

// ------------------------------------------------------------------ balance

export interface BalancePair {
  id: string;
  /** "Push", "Pull", … */
  a: { name: string; score: number | null };
  b: { name: string; score: number | null };
  /** a − b; null when either side has no score. */
  diff: number | null;
  status: 'balanced' | 'a ahead' | 'b ahead' | 'unknown';
  message: string;
}

export interface Balance {
  pairs: BalancePair[];
  /** Groups well under the rest, weakest first. */
  lagging: { id: GroupId; name: string; score: number; behind: number }[];
  /** Groups well over the rest. */
  leading: { id: GroupId; name: string; score: number; ahead: number }[];
}

function pair(id: string, aName: string, a: number | null, bName: string, b: number | null): BalancePair {
  if (a === null || b === null) {
    const missing = a === null ? aName : bName;
    return { id, a: { name: aName, score: a }, b: { name: bName, score: b }, diff: null, status: 'unknown', message: `No recent ${missing.toLowerCase()} lifts to compare` };
  }
  const diff = a - b;
  if (Math.abs(diff) < BALANCE_GAP) return { id, a: { name: aName, score: a }, b: { name: bName, score: b }, diff, status: 'balanced', message: 'Balanced' };
  const [hi, lo] = diff > 0 ? [aName, bName] : [bName, aName];
  return { id, a: { name: aName, score: a }, b: { name: bName, score: b }, diff, status: diff > 0 ? 'a ahead' : 'b ahead', message: `${lo} lags ${hi.toLowerCase()} by ${Math.abs(diff)} points` };
}

export function strengthBalance(scores: Scores): Balance {
  const s = new Map(scores.groups.map((g) => [g.id, g.score]));
  const get = (id: GroupId) => s.get(id) ?? null;
  const push = mean([get('chest'), get('shoulders'), get('triceps')]);
  const pull = mean([get('back'), get('biceps')]);
  const pairs = [
    pair('push-pull', 'Push', push, 'Pull', pull),
    pair('upper-lower', 'Upper body', scores.upper, 'Lower body', scores.lower),
    pair('chest-back', 'Chest', get('chest'), 'Back', get('back')),
    pair('quads-posterior', 'Quads', get('quads'), 'Glutes & hamstrings', get('posterior')),
    pair('biceps-triceps', 'Biceps', get('biceps'), 'Triceps', get('triceps')),
  ];
  // Against the mean of the other groups, so one strong group doesn't hide in its own average.
  const scored = scores.groups.filter((g): g is GroupScore & { score: number } => g.score !== null);
  const lagging: Balance['lagging'] = [];
  const leading: Balance['leading'] = [];
  if (scored.length >= 3) {
    for (const g of scored) {
      const rest = mean(scored.filter((o) => o.id !== g.id).map((o) => o.score)) as number;
      if (g.score <= rest - BALANCE_GAP) lagging.push({ id: g.id, name: g.name, score: g.score, behind: rest - g.score });
      else if (g.score >= rest + BALANCE_GAP) leading.push({ id: g.id, name: g.name, score: g.score, ahead: g.score - rest });
    }
  }
  lagging.sort((a, b) => b.behind - a.behind);
  leading.sort((a, b) => b.ahead - a.ahead);
  return { pairs, lagging, leading };
}

// ------------------------------------------------------------------ over time

/** The overall score (and each group's) every `everyDays` back `points` times, oldest first. */
export function strengthTrend(sets: readonly StrengthSet[], weighIns: readonly WeighIn[], day: string, standards: Standards = 'men', bodyweightFallback: number | null = null, points = 26, everyDays = 7): { day: string; overall: number | null; groups: Partial<Record<GroupId, number | null>> }[] {
  const out = [];
  for (let i = points - 1; i >= 0; i--) {
    const d = shiftDay(day, -i * everyDays);
    const s = strengthScores(sets, weighIns, d, standards, bodyweightFallback);
    out.push({ day: d, overall: s.overall, groups: Object.fromEntries(s.groups.map((g) => [g.id, g.score])) });
  }
  return out;
}
