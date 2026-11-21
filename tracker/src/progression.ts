// The progression engine: what weight to use next, whether you're on track for the
// quarter's goal, and whether a lift has stalled. Pure functions over plain data, with
// no database or clock, so the window, the command line, and later a coach can all ask
// it the same questions and get the same answers.

/**
 * Sets the engine leaves out: 'outlier' (a likely typo, until checked) and 'form' (lifted with
 * form that moved the load off the target muscle: kept in the history, not counted).
 */
export const skipsSet = (flag: string | null | undefined): boolean => flag === 'outlier' || flag === 'form';

/** What the engine needs to know about an exercise in the plan. */
export interface ExerciseRule {
  sets: number;
  repMin: number;
  repMax: number;
  /** The smallest weight change, in kg: 2.5 for plates, the next pin on a cable stack. */
  step: number;
  /** A muscle it trains was already worked earlier in the session, so reps run lower. */
  laterSlot: boolean;
  /** Weight is what's added to your body (pull-ups): 0 is bodyweight. */
  bodyweight?: boolean;
  /** Weight is per dumbbell. */
  perHand?: boolean;
  /** Weight is the plates on one side of a plate-loaded machine. */
  perSide?: boolean;
}

/** One session of an exercise: one working weight and the reps of each set. */
export interface Session {
  day: string;
  weight: number;
  /** Reps per set in order; null for a set left empty. */
  reps: readonly (number | null)[];
  /** Weight lowered on purpose because form broke: not a regression. */
  formReset?: boolean;
  /** The old app copied the previous workout forward: maybe not real. */
  copied?: boolean;
}

export type VerdictKind = 'TOO_HEAVY' | 'ADD_WEIGHT' | 'HOLD';

export interface Verdict {
  kind: VerdictKind;
  message: string;
  /** The weight to use next time. */
  nextWeight: number;
  total: number;
  /** Total reps that earn more weight. */
  threshold: number;
  /** Fewest reps any set may have. */
  lowestOk: number;
  /** For HOLD: the reps per set to beat at the same weight. */
  beat: number[] | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * When to add weight and when it's too heavy. With s sets of up to `hi` reps you may miss
 * s(s−1)/2 reps in total and still go up (3 sets: 3·hi − 3; 2 sets: 2·hi − 1); a later
 * slot may miss s − 1 more (3·hi − 5; 2·hi − 2). Any set under repMin (repMin − 2 in a
 * later slot, at least 1) means too heavy.
 */
export function thresholds(rule: Pick<ExerciseRule, 'sets' | 'repMin' | 'repMax' | 'laterSlot'>): { threshold: number; lowestOk: number } {
  const s = Math.max(1, Math.round(rule.sets));
  const slack = (s * (s - 1)) / 2 + (rule.laterSlot ? s - 1 : 0);
  return {
    threshold: s * rule.repMax - slack,
    lowestOk: rule.laterSlot ? Math.max(rule.repMin - 2, 1) : rule.repMin,
  };
}

/** The sets that count: the plan's number, leaving out empty ones. */
export function countedReps(rule: Pick<ExerciseRule, 'sets'>, reps: readonly (number | null | undefined)[]): number[] {
  return reps.filter((r): r is number => typeof r === 'number' && Number.isFinite(r)).slice(0, Math.max(1, Math.round(rule.sets)));
}

/** What to do after a session: the first of too heavy, add weight, or hold. */
export function verdict(rule: ExerciseRule, weight: number, reps: readonly (number | null | undefined)[]): Verdict {
  const sets = countedReps(rule, reps);
  const { threshold, lowestOk } = thresholds(rule);
  const total = sets.reduce((a, b) => a + b, 0);
  const base = { total, threshold, lowestOk };
  if (sets.some((r) => r < lowestOk)) {
    const lower = round(Math.max(0, weight - rule.step));
    return {
      ...base,
      kind: 'TOO_HEAVY',
      message: weight - rule.step < 0 || weight === 0 ? 'Too heavy: rest longer between sets' : `Too heavy: drop ${round(rule.step)} kg or rest longer`,
      nextWeight: lower,
      beat: null,
    };
  }
  if (total >= threshold) return { ...base, kind: 'ADD_WEIGHT', message: `Add ${round(rule.step)} kg next time`, nextWeight: round(weight + rule.step), beat: null };
  return { ...base, kind: 'HOLD', message: 'Same weight: beat your reps', nextWeight: weight, beat: sets };
}

/** A weight as the gym says it: "85 kg", "BW", "+5 kg"; per-hand weights say so. */
export function weightLabel(weight: number, rule: Pick<ExerciseRule, 'bodyweight' | 'perHand' | 'perSide'> = {}): string {
  const n = String(round(weight));
  if (rule.bodyweight) return weight === 0 ? 'BW' : `${weight > 0 ? '+' : '−'}${String(round(Math.abs(weight)))}`;
  return `${n} kg${rule.perHand ? ' per hand' : rule.perSide ? ' per side' : ''}`;
}

/** Estimated one-rep max from the best set (Epley): weight × (1 + reps/30). For charts only. */
export function estimated1RM(weight: number, reps: readonly (number | null)[]): number {
  const best = Math.max(0, ...reps.filter((r): r is number => typeof r === 'number'));
  return round(weight * (1 + best / 30));
}

// ------------------------------------------------------------------ goals

export interface Checkpoint {
  day: string;
  weight: number;
}

const sorted = (checkpoints: readonly Checkpoint[]) => [...checkpoints].sort((a, b) => a.day.localeCompare(b.day));

/**
 * The goal at the first checkpoint on or after the day; past the last one, the last. The
 * first checkpoint is where the plan starts ("Now"), so it's a goal only when it's the only one.
 */
export function goalFor(checkpoints: readonly Checkpoint[], day: string): Checkpoint | null {
  const list = sorted(checkpoints);
  const goals = list.length > 1 ? list.slice(1) : list;
  return goals.find((c) => c.day >= day) ?? goals.at(-1) ?? null;
}

const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;

/** Where the plan says you should be on a day: a straight line from checkpoint to checkpoint. */
export function expectedOn(checkpoints: readonly Checkpoint[], day: string): number | null {
  const list = sorted(checkpoints);
  const first = list[0];
  const last = list.at(-1);
  if (!first || !last) return null;
  if (day <= first.day) return first.weight;
  if (day >= last.day) return last.weight;
  const i = list.findIndex((c) => c.day >= day);
  const a = list[i - 1] as Checkpoint;
  const b = list[i] as Checkpoint;
  const t = (dayNumber(day) - dayNumber(a.day)) / (dayNumber(b.day) - dayNumber(a.day));
  return round(a.weight + (b.weight - a.weight) * t);
}

export type GoalStatus = 'ahead' | 'on track' | 'behind';

export interface GoalProgress {
  goal: Checkpoint;
  /** current / goal. */
  ratio: number;
  expected: number;
  status: GoalStatus;
}

/**
 * How the current working weight stands against the plan on a day. Weight only moves in
 * steps, so within one step of where the line says counts as on track.
 */
export function goalProgress(checkpoints: readonly Checkpoint[], day: string, current: number, step: number): GoalProgress | null {
  const goal = goalFor(checkpoints, day);
  const expected = expectedOn(checkpoints, day);
  if (!goal || expected === null) return null;
  const tolerance = step > 0 ? step : 0.5;
  const status: GoalStatus = current < expected - tolerance - 1e-9 ? 'behind' : current > expected + tolerance + 1e-9 ? 'ahead' : 'on track';
  return { goal, ratio: goal.weight === 0 ? (current >= 0 ? 1 : 0) : round(current / goal.weight), expected, status };
}

// ------------------------------------------------------------------ stalls and regressions

export type FlagKind = 'stalled' | 'left on the table' | 'regression';

export interface Flag {
  kind: FlagKind;
  message: string;
}

const totalOf = (rule: ExerciseRule, s: Session) => countedReps(rule, s.reps).reduce((a, b) => a + b, 0);

/**
 * Looks at an exercise's sessions, oldest first, for:
 * - stalled: the same weight for 4+ sessions and no total higher than before it;
 * - left on the table: the add-weight total hit twice in a row at the same weight;
 * - regression: lighter than the session before, unless it was a form reset or the
 *   session before was too heavy (dropping then is the plan).
 * Copied sessions (from the old app) don't count; a form reset starts the count again.
 */
export function flags(rule: ExerciseRule, sessions: readonly Session[]): Flag[] {
  const real = sessions.filter((s) => !s.copied);
  const out: Flag[] = [];
  const last = real.at(-1);
  if (!last) return out;

  // The run of sessions at the current weight, back to a weight change or a form reset.
  const run: Session[] = [];
  for (let i = real.length - 1; i >= 0; i--) {
    const s = real[i] as Session;
    if (s.weight !== last.weight) break;
    run.unshift(s);
    if (s.formReset) break;
  }
  if (run.length >= 4) {
    const totals = run.map((s) => totalOf(rule, s));
    const bestBefore = Math.max(...totals.slice(0, -3));
    if (totals.slice(-3).every((t) => t <= bestBefore)) {
      out.push({ kind: 'stalled', message: `Stalled: ${run.length} sessions at ${weightLabel(last.weight, rule)} without more reps` });
    }
  }

  const prev = real.at(-2);
  if (prev && prev.weight === last.weight && !last.formReset) {
    const { threshold } = thresholds(rule);
    const hit = (s: Session) => verdict(rule, s.weight, s.reps).kind === 'ADD_WEIGHT' && totalOf(rule, s) >= threshold;
    if (hit(prev) && hit(last)) out.push({ kind: 'left on the table', message: `Earned more weight twice in a row: go to ${weightLabel(last.weight + rule.step, rule)}` });
  }

  if (prev && last.weight < prev.weight && !last.formReset && verdict(rule, prev.weight, prev.reps).kind !== 'TOO_HEAVY') {
    out.push({ kind: 'regression', message: `Lighter than last time (${weightLabel(prev.weight, rule)} → ${weightLabel(last.weight, rule)})` });
  }
  return out;
}

// ------------------------------------------------------------------ the next session

export interface Suggestion {
  weight: number;
  /** How many working sets to do next time: the plan's, or more while the lift is stalled. */
  sets: number;
  /** Why sets differ from the plan's (or went back to it); null when nothing changed. */
  setsReason: string | null;
  /** The engine's verdict on the last session, or null with no history. */
  verdict: Verdict | null;
  /** That last session. */
  last: Session | null;
  /** Reps per set to beat at that weight, from the last session there. */
  beat: number[] | null;
  /** The add-weight total and lowest set, lowered in a later slot. */
  threshold: number;
  lowestOk: number;
}

/** Most sets the engine adds on top of the plan's. */
export const MAX_EXTRA_SETS = 2;

/** Working sets done in a session (all of them, not only the plan's). */
const setsDone = (s: Session) => s.reps.filter((r): r is number => typeof r === 'number' && Number.isFinite(r)).length;

/**
 * How many sets to do next time. Weight stays the main lever; sets are the second one,
 * for when weight is stuck (more weekly sets grow more muscle, with diminishing returns):
 * - add weight or too heavy: back to the plan's sets (a new weight starts fresh);
 * - same weight, and the last 2 sessions at it beat neither the best total before them:
 *   one set more than last time, up to the plan's + 2;
 * - the extra set cost reps (the plan's sets did worse than the session before): one fewer;
 * - otherwise: as many as last time (never under the plan's).
 * Only the plan's sets count toward add weight / too heavy, so an extra set never makes a
 * session look worse. Copied sessions don't count, and a form reset starts the count again.
 */
export function nextSets(rule: ExerciseRule, sessions: readonly Session[]): { sets: number; reason: string | null } {
  const base = Math.max(1, Math.round(rule.sets));
  const max = base + MAX_EXTRA_SETS;
  const real = sessions.filter((s) => !s.copied);
  const last = real.at(-1);
  if (!last) return { sets: base, reason: null };
  const v = verdict(rule, last.weight, last.reps);
  const done = Math.min(max, Math.max(base, setsDone(last)));
  if (v.kind !== 'HOLD') return { sets: base, reason: done > base ? `Back to ${base} sets at the new weight` : null };

  const run: Session[] = [];
  for (let i = real.length - 1; i >= 0; i--) {
    const s = real[i] as Session;
    if (s.weight !== last.weight) break;
    run.unshift(s);
    if (s.formReset) break;
  }
  const totals = run.map((s) => totalOf(rule, s));
  const prev = run.at(-2);
  if (prev && done > base && setsDone(last) > setsDone(prev) && (totals.at(-1) as number) < (totals.at(-2) as number)) {
    return { sets: done - 1, reason: `The extra set cost reps: back to ${done - 1}` };
  }
  if (run.length >= 3) {
    const bestBefore = Math.max(...totals.slice(0, -2));
    if (totals.slice(-2).every((t) => t <= bestBefore) && done < max) {
      return { sets: done + 1, reason: `Stuck at ${weightLabel(last.weight, rule)} for 2 sessions: add a set` };
    }
  }
  return { sets: done, reason: done > base ? `Keep ${done} sets until the reps move` : null };
}

/**
 * What to lift next: the verdict on the last session decides the weight. With no history,
 * the plan's starting weight (`start`).
 */
export function suggest(rule: ExerciseRule, sessions: readonly Session[], start: number | null): Suggestion {
  const { threshold, lowestOk } = thresholds(rule);
  const last = sessions.at(-1);
  const base = Math.max(1, Math.round(rule.sets));
  if (!last) return { weight: start ?? 0, sets: base, setsReason: null, verdict: null, last: null, beat: null, threshold, lowestOk };
  const next = nextSets(rule, sessions);
  const v = verdict(rule, last.weight, last.reps);
  const sameWeight = [...sessions].reverse().find((s) => s.weight === v.nextWeight);
  return { weight: v.nextWeight, sets: next.sets, setsReason: next.reason, verdict: v, last: { day: last.day, weight: last.weight, reps: countedReps(rule, last.reps) }, beat: sameWeight ? countedReps(rule, sameWeight.reps) : null, threshold, lowestOk };
}

// ------------------------------------------------------------------ body

export interface BodyPoint {
  day: string;
  weight: number;
  waist: number | null;
}

/** Fat-free mass index: lean kg over height in metres squared. */
export const ffmi = (leanKg: number, heightCm: number) => round(leanKg / (heightCm / 100) ** 2);

const addDays = (day: string, n: number) => new Date((dayNumber(day) + n) * 86_400_000).toISOString().slice(0, 10);

/** The 7-day average of weight on each day weighed (that day and the 6 before). */
export function rollingAverage(points: readonly BodyPoint[], days = 7): { day: string; weight: number }[] {
  const list = [...points].sort((a, b) => a.day.localeCompare(b.day));
  return list.map((p) => {
    const from = addDays(p.day, -(days - 1));
    const window = list.filter((q) => q.day >= from && q.day <= p.day);
    return { day: p.day, weight: round(window.reduce((a, q) => a + q.weight, 0) / window.length) };
  });
}

/** Least-squares slope of y per day. */
function slopePerDay(points: readonly { day: string; y: number }[]): number | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => dayNumber(p.day));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = points.reduce((a, p) => a + p.y, 0) / points.length;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += ((xs[i] as number) - mx) * (p.y - my);
    den += ((xs[i] as number) - mx) ** 2;
  });
  return den === 0 ? null : num / den;
}

export interface BodyFlag {
  kind: 'waist' | 'flat';
  message: string;
}

/**
 * - waist: the waist grows more than 1 cm a month (over the last 30 days) while a third or
 *   more of the lifts are stalled;
 * - flat: the 7-day average weight hasn't gone up over the last 3 weeks.
 */
export function bodyFlags(points: readonly BodyPoint[], today: string, stalledShare: number): BodyFlag[] {
  const out: BodyFlag[] = [];
  const monthAgo = addDays(today, -30);
  const waist = points.filter((p) => p.waist !== null && p.day >= monthAgo && p.day <= today).map((p) => ({ day: p.day, y: p.waist as number }));
  const waistSlope = waist.length >= 2 && dayNumber(waist.at(-1)!.day) - dayNumber(waist[0]!.day) >= 14 ? slopePerDay(waist) : null;
  if (waistSlope !== null && waistSlope * 30 > 1 && stalledShare >= 1 / 3) {
    out.push({ kind: 'waist', message: `Waist up ${round(waistSlope * 30)} cm a month while lifts stall: hold calories where they are` });
  }
  const avg = rollingAverage(points.filter((p) => p.day <= today));
  const from = addDays(today, -21);
  const start = [...avg].reverse().find((p) => p.day <= from);
  const end = avg.at(-1);
  if (start && end && end.day >= addDays(today, -7) && end.weight - start.weight < 0.1) {
    out.push({ kind: 'flat', message: 'Bodyweight flat for 3 weeks: eat ~150 kcal more a day' });
  }
  return out;
}

// ------------------------------------------------------------------ across exercises

export const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

export const quantile = (values: readonly number[], q: number): number | null => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (pos - lo);
};

/** The working weight on a day: the last session's on or before it. */
export const weightAsOf = (sessions: readonly Session[], day: string): number | null => [...sessions].reverse().find((s) => s.day <= day)?.weight ?? null;

/** Median % change in working weight across exercises, from one day to another. */
export function medianChange(exercises: readonly { sessions: readonly Session[] }[], from: string, to: string): number | null {
  const changes = exercises.flatMap(({ sessions }) => {
    const a = weightAsOf(sessions, from);
    const b = weightAsOf(sessions, to);
    return a && b !== null && a > 0 && sessions.some((s) => s.day > from && s.day <= to) ? [(b / a - 1) * 100] : [];
  });
  const m = median(changes);
  return m === null ? null : round(m);
}

export { addDays as shiftDay };

/**
 * Sessions the old app copied forward: the same weight and reps on every set as the session
 * before, 3 or more times in a row. Returns the indexes of the copies (not the original).
 */
export function copiedRuns(sessions: readonly Pick<Session, 'weight' | 'reps'>[]): Set<number> {
  const out = new Set<number>();
  const same = (a: Pick<Session, 'weight' | 'reps'>, b: Pick<Session, 'weight' | 'reps'>) => a.weight === b.weight && a.reps.length === b.reps.length && a.reps.every((r, i) => r === b.reps[i]);
  let runStart = -1;
  const close = (end: number) => {
    if (runStart >= 0 && end - runStart >= 3) for (let i = runStart; i < end; i++) out.add(i);
    runStart = -1;
  };
  for (let i = 1; i < sessions.length; i++) {
    if (same(sessions[i] as Session, sessions[i - 1] as Session)) {
      if (runStart < 0) runStart = i;
    } else close(i);
  }
  close(sessions.length);
  return out;
}
