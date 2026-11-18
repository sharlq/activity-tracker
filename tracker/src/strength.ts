// Strength score and strength balance, in the spirit of Caliber's: how strong each muscle
// group is for your bodyweight, and whether some groups lag the rest.
//
// Each group has a reference lift with five bodyweight-ratio standards (Beginner … Elite,
// approximations of the widely published tables). Every logged lift that trains a group
// is turned into that reference lift's equivalent: its estimated 1RM (Epley, like the
// progression engine) on the full load (both dumbbells, both sides, bodyweight plus added
// for pull-ups) times a factor. Cable stacks and plate-loaded machines aren't calibrated
// like a bar, and one arm on a cable moves more than half of two, so their factors are
// conservative. A group's score is its best lift over the last 90 days (a group with none
// there keeps its best from the 90 before, marked lapsed, so it fades out of view rather
// than dropping out of the overall),
// on a scale where each level is 100 points: 100 Beginner, 200 Novice, 300 Intermediate,
// 400 Advanced, 500 Elite. The overall score is the mean of upper body and lower body, so
// arms don't outweigh legs; arms (biceps, triceps) and the posterior chain (glutes,
// hamstrings) count as one group each in it. A lift can train more than one group: a
// deadlift counts toward glutes and hamstrings, each as its own reference lift. Pure: it reads sets and weigh-ins, nothing else.
import { estimated1RM } from './progression.ts';

export type GroupId = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads' | 'glutes' | 'hamstrings';
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
  { id: 'glutes', name: 'Glutes', region: 'lower', reference: 'Barbell Hip Thrust', men: [0.75, 1.25, 1.75, 2.5, 3.25], women: [0.5, 1, 1.5, 2, 2.75] },
  { id: 'hamstrings', name: 'Hamstrings', region: 'lower', reference: 'Barbell Romanian Deadlift', men: [0.8, 1.2, 1.6, 2, 2.4], women: [0.4, 0.8, 1, 1.4, 2] },
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

/**
 * The first match for each group wins, so a lift can count toward several groups (a deadlift
 * trains glutes and hamstrings); a lift that matches none (isolation work, forearms, jumps)
 * doesn't count.
 */
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
  // Glutes: hip thrust. Deadlifts load the glutes too, but less than a thrust does.
  { match: /^(barbell )?hip thrust$/, group: 'glutes', load: 'total', factor: 1 },
  { match: /^smith machine hip thrust$|^hip thrust \(machine\)$|^machine hip thrust$/, group: 'glutes', load: 'total', factor: 0.9 },
  { match: /^(barbell |conventional |sumo )?deadlift$/, group: 'glutes', load: 'total', factor: 0.85 },
  { match: /^(trap|hex) bar deadlift$/, group: 'glutes', load: 'total', factor: 0.8 },
  { match: /^(barbell )?(romanian deadlift|rdl|stiff[- ]leg(ged)? deadlift)$/, group: 'glutes', load: 'total', factor: 1 },
  { match: /^(dumbbell|db) (romanian deadlift|rdl)$/, group: 'glutes', load: 'double', factor: 1 },
  // Hamstrings: Romanian deadlift.
  { match: /^(barbell )?(romanian deadlift|rdl|stiff[- ]leg(ged)? deadlift)$/, group: 'hamstrings', load: 'total', factor: 1 },
  { match: /^(dumbbell|db) (romanian deadlift|rdl)$/, group: 'hamstrings', load: 'double', factor: 1 },
  { match: /^(barbell |conventional |sumo )?deadlift$/, group: 'hamstrings', load: 'total', factor: 0.8 },
  { match: /^(trap|hex) bar deadlift$/, group: 'hamstrings', load: 'total', factor: 0.75 },
  { match: /^(machine )?(seated |lying )?leg curl( \(machine\))?$/, group: 'hamstrings', load: 'total', factor: 1.6 },
];

/** Sets with more reps than this say little about a 1RM. */
export const MAX_REPS = 15;
/** A group's score is its best lift over this many days. */
export const WINDOW_DAYS = 90;
/**
 * A group with nothing in the window keeps its best from up to this many days back, marked
 * lapsed, so a group you skip for a while doesn't drop out of the overall all at once.
 */
export const LAPSE_DAYS = 180;
/** A group this many points off the rest (0.4 of a level) is out of balance. */
export const BALANCE_GAP = 40;

export type Confidence = 'high' | 'medium' | 'low';
/**
 * How far to trust a score, from the lift it comes from: the reference lift itself (or a bar
 * lift scored one to one) is high; a big conversion (a leg curl as a Romanian deadlift, a leg
 * press as a squat, one arm on a cable) is low; the rest is medium.
 */
export function confidenceOf(rule: Pick<LiftRule, 'factor' | 'load'>): Confidence {
  if (rule.factor === 1 && rule.load === 'total') return 'high';
  if (rule.factor >= 1.4 || rule.factor <= 0.7) return 'low';
  return 'medium';
}

const ruleCache = new Map<string, LiftRule[]>();
/** Every group a lift counts toward, with how: one rule per group, in GROUPS order. */
export function liftRules(name: string): LiftRule[] {
  const key = name.trim().toLowerCase();
  let rules = ruleCache.get(key);
  if (rules === undefined) {
    const matched = LIFTS.filter((r) => r.match.test(key));
    rules = GROUPS.map((g) => matched.find((r) => r.group === g.id)).filter((r): r is LiftRule => r !== undefined);
    ruleCache.set(key, rules);
  }
  return rules;
}
/** The lift's first group's rule; null when it counts toward none. */
export function liftRule(name: string): LiftRule | null {
  return liftRules(name)[0] ?? null;
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
  return weighInOn(weighIns, day)?.weight ?? null;
}
/** The weigh-in bodyweightOn uses, with its day. */
export function weighInOn(weighIns: readonly WeighIn[], day: string): WeighIn | null {
  const sorted = [...weighIns].sort((a, b) => a.day.localeCompare(b.day));
  return sorted.filter((w) => w.day <= day).at(-1) ?? sorted[0] ?? null;
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

/** The 1RM ÷ bodyweight that scores `score`: scoreOf turned round. */
export function ratioFor(score: number, standards: readonly number[]): number {
  const t = standards;
  if (score <= 100) return ((t[0] as number) * Math.max(0, score)) / 100;
  if (score >= 500) {
    const last = t.at(-1) as number;
    return last + ((last - (t.at(-2) as number)) * (Math.min(600, score) - 500)) / 100;
  }
  const i = Math.floor(score / 100) - 1;
  const lo = t[i] as number;
  const hi = t[i + 1] as number;
  return lo + ((hi - lo) * (score - 100 * (i + 1))) / 100;
}

/** How far a nearer target sits above a score, when the next level is further off. */
export const MILESTONE = 25;

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
  /** A nearer target, MILESTONE points up, when the next level is further than that. */
  milestone: { score: number; weight: number; reps: number } | null;
  /** True when nothing in the window trains it and the score is an older best (LAPSE_DAYS). */
  lapsed: boolean;
  /** The last day a lift that counts toward it was logged; null with none. */
  lastDay: string | null;
  /** The last day this score holds: after it, the set it comes from leaves the window. */
  keptUntil: string | null;
  /** How far to trust the score, from its best lift (confidenceOf); null without a score. */
  confidence: Confidence | null;
}

export interface Scores {
  day: string;
  bodyweight: number | null;
  /** The day of the weigh-in it uses; null when the weight came from elsewhere. */
  bodyweightDay: string | null;
  overall: number | null;
  overallLevel: string | null;
  upper: number | null;
  lower: number | null;
  groups: GroupScore[];
  /** Lifts logged in the window that count toward no group, by name. */
  uncounted: string[];
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
  const weighIn = weighInOn(weighIns, day);
  const bw = weighIn?.weight ?? bodyweightFallback;
  const from = shiftDay(day, -WINDOW_DAYS);
  const lapseFrom = shiftDay(day, -LAPSE_DAYS);
  // Each lift's best per group in the window, and (for groups the window misses) before it.
  const best = new Map<string, LiftBest & { rule: LiftRule }>();
  const older = new Map<string, LiftBest & { rule: LiftRule }>();
  // Every counted set per group, to tell when the best one leaves the window.
  const seen = new Map<GroupId, { day: string; equivalent: number; recent: boolean }[]>();
  const uncounted = new Map<string, string>();
  if (bw !== null) {
    for (const s of sets) {
      if (s.day > day || s.day < lapseFrom || s.flag === 'outlier' || s.reps === null || s.reps < 1 || s.reps > MAX_REPS) continue;
      const recent = s.day >= from;
      const rules = liftRules(s.exercise);
      if (!rules.length && recent && !uncounted.has(s.exercise.trim().toLowerCase())) uncounted.set(s.exercise.trim().toLowerCase(), s.exercise.trim());
      for (const rule of rules) {
        const load = loadOf(rule, s.weight, bw);
        if (load === null || load <= 0) continue;
        const e1rm = estimated1RM(load, [s.reps]);
        const equivalent = e1rm * rule.factor;
        const key = `${rule.group}|${s.exercise.trim().toLowerCase()}`;
        const into = recent ? best : older;
        const had = into.get(key);
        // A tie goes to the later set, so the day shown is the last time you lifted that well.
        if (!had || equivalent > had.equivalent + 1e-9 || (Math.abs(equivalent - had.equivalent) <= 1e-9 && s.day > had.day)) into.set(key, { exercise: s.exercise, day: s.day, weight: s.weight, reps: s.reps, e1rm: r1(e1rm), equivalent, score: 0, rule });
        const list = seen.get(rule.group) ?? [];
        list.push({ day: s.day, equivalent, recent });
        seen.set(rule.group, list);
      }
    }
  }
  const groups: GroupScore[] = GROUPS.map((g) => {
    const standardsOf = g[standards];
    const of = (m: Map<string, LiftBest & { rule: LiftRule }>) =>
      [...m.values()]
        .filter((b) => b.rule.group === g.id)
        .map((b) => ({ ...b, score: scoreOf(b.equivalent / (bw as number), standardsOf) }))
        .sort((a, b) => b.equivalent - a.equivalent);
    const recentLifts = of(best);
    const lapsed = recentLifts.length === 0;
    const lifts = lapsed ? of(older) : recentLifts;
    const top = lifts[0];
    const counted = seen.get(g.id) ?? [];
    const lastDay = counted.reduce<string | null>((a, c) => (a === null || c.day > a ? c.day : a), null);
    if (!top || bw === null) return { id: g.id, name: g.name, region: g.region, reference: g.reference, score: null, level: null, ratio: null, best: null, lifts: [], next: null, milestone: null, lapsed: false, lastDay, keptUntil: null, confidence: null };
    // The last set as strong as the best keeps the score; it holds until that set ages out.
    const lastAtTop = counted.filter((c) => c.recent === !lapsed && c.equivalent >= top.equivalent * 0.999).reduce((a, c) => (c.day > a ? c.day : a), top.day);
    const keptUntil = shiftDay(lastAtTop, lapsed ? LAPSE_DAYS : WINDOW_DAYS);
    const score = top.score;
    const reached = Math.floor(score / 100);
    const nextIndex = reached; // LEVELS[reached] is the one above the score
    // What the best lift needs, at the same reps, to score `target`.
    const weightFor = (target: number) => {
      const needLoad = (ratioFor(target, standardsOf) * bw) / top.rule.factor / (1 + top.reps / 30);
      const step = 2.5;
      return r1(Math.ceil(loggedOf(top.rule, needLoad, bw) / step) * step);
    };
    const next = nextIndex < LEVELS.length ? { level: LEVELS[nextIndex] as string, score: (nextIndex + 1) * 100, weight: weightFor((nextIndex + 1) * 100), reps: top.reps } : null;
    // A nearer step, MILESTONE points up, when the next level is further off than that.
    const milestone = next && next.score - score > MILESTONE ? { score: score + MILESTONE, weight: weightFor(score + MILESTONE), reps: top.reps } : null;
    const clean = ({ rule: _rule, ...b }: LiftBest & { rule: LiftRule }): LiftBest => ({ ...b, equivalent: r1(b.equivalent) });
    return { id: g.id, name: g.name, region: g.region, reference: g.reference, score, level: levelOf(score), ratio: Math.round((top.equivalent / bw) * 100) / 100, best: clean(top), lifts: lifts.map(clean), next, milestone, lapsed, lastDay, keptUntil, confidence: confidenceOf(top.rule) };
  });
  const byId = new Map(groups.map((g) => [g.id, g.score]));
  const arms = mean([byId.get('biceps') ?? null, byId.get('triceps') ?? null]);
  const upper = mean([byId.get('chest') ?? null, byId.get('back') ?? null, byId.get('shoulders') ?? null, arms]);
  const posterior = mean([byId.get('glutes') ?? null, byId.get('hamstrings') ?? null]);
  const lower = mean([byId.get('quads') ?? null, posterior]);
  const overall = mean([upper, lower]);
  return { day, bodyweight: bw, bodyweightDay: weighIn?.weight === bw ? (weighIn?.day ?? null) : null, overall, overallLevel: overall === null ? null : levelOf(overall), upper, lower, groups, uncounted: [...uncounted.values()].sort((a, b) => a.localeCompare(b)) };
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
  /** True when either side is a low-confidence score, so the gap may be the conversion's. */
  lowConfidence: boolean;
}

export interface Balance {
  pairs: BalancePair[];
  /** Groups well under the rest, weakest first. */
  lagging: { id: GroupId; name: string; score: number; behind: number; confidence: Confidence | null }[];
  /** Groups well over the rest. */
  leading: { id: GroupId; name: string; score: number; ahead: number }[];
}

function pair(id: string, aName: string, a: number | null, bName: string, b: number | null, lowConfidence = false): BalancePair {
  if (a === null || b === null) {
    const missing = a === null ? aName : bName;
    return { id, a: { name: aName, score: a }, b: { name: bName, score: b }, diff: null, status: 'unknown', message: `No recent ${missing.toLowerCase()} lifts to compare`, lowConfidence };
  }
  const diff = a - b;
  if (Math.abs(diff) < BALANCE_GAP) return { id, a: { name: aName, score: a }, b: { name: bName, score: b }, diff, status: 'balanced', message: 'Balanced', lowConfidence };
  const [hi, lo] = diff > 0 ? [aName, bName] : [bName, aName];
  const message = `${lo} lags ${hi.toLowerCase()} by ${Math.abs(diff)} points${lowConfidence ? ' (low confidence)' : ''}`;
  return { id, a: { name: aName, score: a }, b: { name: bName, score: b }, diff, status: diff > 0 ? 'a ahead' : 'b ahead', message, lowConfidence };
}

export function strengthBalance(scores: Scores): Balance {
  const s = new Map(scores.groups.map((g) => [g.id, g.score]));
  const get = (id: GroupId) => s.get(id) ?? null;
  const low = new Set(scores.groups.filter((g) => g.confidence === 'low').map((g) => g.id));
  const lowOf = (...ids: GroupId[]) => ids.some((id) => low.has(id));
  const push = mean([get('chest'), get('shoulders'), get('triceps')]);
  const pull = mean([get('back'), get('biceps')]);
  const pairs = [
    pair('push-pull', 'Push', push, 'Pull', pull),
    pair('upper-lower', 'Upper body', scores.upper, 'Lower body', scores.lower),
    pair('chest-back', 'Chest', get('chest'), 'Back', get('back'), lowOf('chest', 'back')),
    pair('quads-hamstrings', 'Quads', get('quads'), 'Hamstrings', get('hamstrings'), lowOf('quads', 'hamstrings')),
    pair('glutes-hamstrings', 'Glutes', get('glutes'), 'Hamstrings', get('hamstrings'), lowOf('glutes', 'hamstrings')),
    pair('biceps-triceps', 'Biceps', get('biceps'), 'Triceps', get('triceps'), lowOf('biceps', 'triceps')),
  ];
  // Against the mean of the other groups, so one strong group doesn't hide in its own average.
  const scored = scores.groups.filter((g): g is GroupScore & { score: number } => g.score !== null);
  const lagging: Balance['lagging'] = [];
  const leading: Balance['leading'] = [];
  if (scored.length >= 3) {
    for (const g of scored) {
      const rest = mean(scored.filter((o) => o.id !== g.id).map((o) => o.score)) as number;
      if (g.score <= rest - BALANCE_GAP) lagging.push({ id: g.id, name: g.name, score: g.score, behind: rest - g.score, confidence: g.confidence });
      else if (g.score >= rest + BALANCE_GAP) leading.push({ id: g.id, name: g.name, score: g.score, ahead: g.score - rest });
    }
  }
  lagging.sort((a, b) => b.behind - a.behind);
  leading.sort((a, b) => b.ahead - a.ahead);
  return { pairs, lagging, leading };
}

// ------------------------------------------------------------------ focus

export interface FocusItem {
  kind: 'expiring' | 'lapsed' | 'confidence' | 'lagging';
  group: GroupId;
  title: string;
  detail: string;
}

/** A best set this close to leaving the window gets a warning. */
export const FOCUS_SOON_DAYS = 21;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "17 Dec", the same on the PC and on the phone. */
export const shortDate = (day: string): string => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/**
 * What to do next, at most `max` things, each group named once: a group not trained in the
 * window, a best set about to leave it (soonest first), a score that's only a rough
 * conversion, then a group that lags the rest.
 */
export function strengthFocus(scores: Scores, balance: Balance, max = 3): FocusItem[] {
  const items: FocusItem[] = [];
  for (const g of scores.groups) {
    if (g.score === null || !g.best || !g.lapsed) continue;
    items.push({ kind: 'lapsed', group: g.id, title: `${g.name}: not trained in ${WINDOW_DAYS} days`, detail: `${g.score} is from ${g.best.exercise} on ${shortDate(g.best.day)}. Log it again to bring the score up to date.` });
  }
  const expiring = scores.groups
    .filter((g) => g.score !== null && g.best && !g.lapsed && g.keptUntil !== null && daysFrom(scores.day, g.keptUntil) <= FOCUS_SOON_DAYS)
    .sort((a, b) => (a.keptUntil as string).localeCompare(b.keptUntil as string));
  for (const g of expiring) {
    items.push({ kind: 'expiring', group: g.id, title: `${g.name}: best set ages out after ${shortDate(g.keptUntil as string)}`, detail: `Log ${g.best?.exercise} again by then to keep ${g.score} current.` });
  }
  for (const g of scores.groups) {
    if (g.score === null || !g.best || g.confidence !== 'low') continue;
    items.push({ kind: 'confidence', group: g.id, title: `${g.name} ${g.score} is a rough guess`, detail: `It comes from ${g.best.exercise}, converted to a ${g.reference}. Log a ${g.reference} to score it on its own lift.` });
  }
  for (const l of balance.lagging) {
    items.push({ kind: 'lagging', group: l.id, title: `${l.name} lags the rest by ${l.behind} points`, detail: 'Put it early in the session, while you’re fresh.' });
  }
  const named = new Set<GroupId>();
  return items.filter((i) => !named.has(i.group) && (named.add(i.group), true)).slice(0, max);
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

/** Each group's change over the trend, first score to last, biggest gain first; groups with under two scores are left out. */
export function strengthGains(trend: readonly { groups: Partial<Record<GroupId, number | null>> }[]): { id: GroupId; name: string; from: number; to: number; change: number }[] {
  const out = [];
  for (const g of GROUPS) {
    const scores = trend.map((p) => p.groups[g.id]).filter((v): v is number => typeof v === 'number');
    if (scores.length < 2) continue;
    const from = scores[0] as number;
    const to = scores.at(-1) as number;
    out.push({ id: g.id, name: g.name, from, to, change: to - from });
  }
  return out.sort((a, b) => b.change - a.change);
}
