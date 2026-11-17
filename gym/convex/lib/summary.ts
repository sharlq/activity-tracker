// The summary after "Finish workout": time, sets against the plan, volume, records, what
// the engine says for next time, how the goals stand, and the last time this plan day was
// done. Pure: it reads a TrainingSource and the workout, and asks the shared engine.
import type { GoalProgress, Verdict } from '../../../tracker/src/progression.ts';
import { estimated1RM, goalProgress, verdict, weightLabel } from '../../../tracker/src/progression.ts';
import { exerciseState, ruleOf } from '../../../tracker/src/trainingPlan.ts';
import type { TrainingSource } from '../../../tracker/src/trainingTypes.ts';

export interface SummaryWorkout {
  num: number;
  day: string;
  name: string;
  start: number | null;
  end: number | null;
  planDayNum: number | null;
  sets: { exercise: string; position: number; reps: number | null; weight: number | null; at: number | null }[];
}

export interface SummaryExercise {
  name: string;
  inPlan: boolean;
  plannedSets: number | null;
  repRange: string | null;
  /** What the engine said to lift before today. */
  aimLabel: string | null;
  logged: { weight: number | null; reps: number | null }[];
  topLabel: string | null;
  volume: number;
  /** The engine's call on today's sets: the weight for next time. */
  next: Pick<Verdict, 'kind' | 'message' | 'nextWeight'> & { nextLabel: string; nextSets: number; setsReason: string | null } | null;
  record: { kind: 'weight' | 'e1rm'; label: string; before: string } | null;
  progress: GoalProgress | null;
}

export interface Summary {
  workout: { num: number; day: string; name: string; start: number | null; end: number | null; minutes: number | null };
  totals: { sets: number; plannedSets: number; reps: number; volume: number; exercises: number; plannedExercises: number; records: number };
  /** The last time: the same plan day, else the latest workout with 2+ of today's exercises. Volume only over exercises both had. */
  previous: { name: string; day: string; samePlanDay: boolean; volume: number; currentVolume: number; shared: number; minutes: number | null } | null;
  exercises: SummaryExercise[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const volumeOf = (sets: readonly { reps: number | null; weight: number | null }[]) => r1(sets.reduce((v, s) => v + (s.reps ?? 0) * (s.weight ?? 0), 0));

/** Minutes from the start (or first set) to the end (or last set). */
export function minutesOf(w: Pick<SummaryWorkout, 'start' | 'end' | 'sets'>): number | null {
  const times = w.sets.map((s) => s.at).filter((t): t is number => t !== null);
  const from = w.start ?? (times.length ? Math.min(...times) : null);
  const to = w.end ?? (times.length ? Math.max(...times) : null);
  return from !== null && to !== null && to >= from ? Math.round((to - from) / 60_000) : null;
}

/** Lowercased names to the plan exercise they belong to (its name or an alias), so "DB Bench" and "Dumbbell Bench Press" match. */
function canonical(source: TrainingSource): (name: string) => string {
  const map = new Map<string, string>();
  for (const e of source.planExercises()) for (const n of [e.name, ...e.aliases]) map.set(n.toLowerCase(), e.name.toLowerCase());
  return (name) => map.get(name.toLowerCase()) ?? name.toLowerCase();
}

/** The workout to compare with: the same plan day before this one, else the latest earlier one sharing 2+ exercises. */
export function pickPrevious<T extends SummaryWorkout>(source: TrainingSource, w: SummaryWorkout, others: readonly T[]): T | null {
  const key = canonical(source);
  const mine = new Set(w.sets.map((s) => key(s.exercise)));
  const earlier = others
    .filter((x) => x.num !== w.num && x.sets.length && (x.day < w.day || (x.day === w.day && x.num < w.num)))
    .sort((a, b) => b.day.localeCompare(a.day) || b.num - a.num);
  const same = w.planDayNum === null ? undefined : earlier.find((x) => x.planDayNum === w.planDayNum);
  if (same) return same;
  return earlier.find((x) => new Set(x.sets.map((s) => key(s.exercise)).filter((n) => mine.has(n))).size >= 2) ?? null;
}

export function summarize(source: TrainingSource, w: SummaryWorkout, previous: SummaryWorkout | null, previousMinutes: number | null): Summary {
  const days = source.planDays();
  const dayName = days.find((d) => d.id === w.planDayNum)?.name ?? w.name;
  const planned = source.planExercises().filter((e) => e.dayId === w.planDayNum);
  const checkpoints = source.checkpoints();
  const names = [...new Set([...planned.flatMap((e) => [e.name, ...e.aliases]), ...w.sets.map((s) => s.exercise)].map((n) => n.toLowerCase()))];
  const history = source.trainingSets(names);
  const used = new Set<string>();

  const exercises: SummaryExercise[] = planned.map((e) => {
    const rule = ruleOf(e);
    const own = new Set([e.name, ...e.aliases].map((n) => n.toLowerCase()));
    const mine = w.sets.filter((s) => own.has(s.exercise.toLowerCase())).sort((a, b) => a.position - b.position);
    for (const s of mine) used.add(s.exercise.toLowerCase());
    const state = exerciseState(e, dayName, history, w.day, { before: w.num });
    const withWeight = mine.map((s) => ({ ...s, weight: s.weight ?? (e.bodyweight ? 0 : null) })).filter((s) => s.reps !== null && s.weight !== null);
    const top = withWeight.length ? Math.max(...withWeight.map((s) => s.weight as number)) : null;
    const reps = top === null ? [] : withWeight.filter((s) => s.weight === top).map((s) => s.reps as number);
    const v = top === null ? null : verdict(rule, top, reps);
    // The suggestion with this workout counted: how many sets next time.
    const after = top === null ? null : exerciseState(e, dayName, history, w.day).suggestion;

    // A record: heavier than ever, else a higher estimated one-rep max, against earlier sessions.
    const before = state.sessions.filter((s) => s.workoutId !== w.num && s.day <= w.day && !s.copied);
    let record: SummaryExercise['record'] = null;
    if (top !== null && before.length) {
      const heaviest = Math.max(...before.map((s) => s.weight));
      const bestE1rm = Math.max(...before.map((s) => s.e1rm));
      const e1rm = estimated1RM(top, reps);
      if (top > heaviest && !e.bodyweight) record = { kind: 'weight', label: weightLabel(top, rule), before: weightLabel(heaviest, rule) };
      else if (e1rm > bestE1rm && top > 0) record = { kind: 'e1rm', label: `${r1(e1rm)} kg e1RM`, before: `${r1(bestE1rm)} kg` };
    }
    return {
      name: e.name,
      inPlan: true,
      plannedSets: state.suggestion.sets,
      repRange: `${e.repMin}–${e.repMax}`,
      aimLabel: state.suggestedLabel,
      logged: mine.map((s) => ({ weight: s.weight, reps: s.reps })),
      topLabel: top === null ? null : weightLabel(top, rule),
      volume: volumeOf(mine),
      next: v ? { kind: v.kind, message: v.message, nextWeight: v.nextWeight, nextLabel: weightLabel(v.nextWeight, rule), nextSets: after?.sets ?? e.sets, setsReason: after?.setsReason ?? null } : null,
      record,
      progress: top === null ? state.progress : goalProgress(e.goals, w.day, top, e.step),
    };
  });

  // Anything done that isn't in the plan day.
  const extras = new Map<string, SummaryWorkout['sets']>();
  for (const s of w.sets) {
    if (used.has(s.exercise.toLowerCase())) continue;
    const list = extras.get(s.exercise) ?? [];
    list.push(s);
    extras.set(s.exercise, list);
  }
  for (const [name, list] of extras) {
    const top = list.some((s) => s.weight !== null) ? Math.max(...list.map((s) => s.weight ?? 0)) : null;
    exercises.push({
      name, inPlan: false, plannedSets: null, repRange: null, aimLabel: null,
      logged: list.map((s) => ({ weight: s.weight, reps: s.reps })), topLabel: top === null ? null : `${r1(top)} kg`,
      volume: volumeOf(list), next: null, record: null, progress: null,
    });
  }

  return {
    workout: { num: w.num, day: w.day, name: dayName, start: w.start, end: w.end, minutes: minutesOf(w) },
    totals: {
      sets: w.sets.length,
      plannedSets: planned.reduce((n, e) => n + e.sets, 0),
      reps: w.sets.reduce((n, s) => n + (s.reps ?? 0), 0),
      volume: volumeOf(w.sets),
      exercises: exercises.filter((e) => e.logged.length).length,
      plannedExercises: planned.length,
      records: exercises.filter((e) => e.record).length,
    },
    previous: previous ? comparison(source, w, previous, previousMinutes) : null,
    exercises,
  };
}

function comparison(source: TrainingSource, w: SummaryWorkout, p: SummaryWorkout, minutes: number | null): NonNullable<Summary['previous']> {
  const key = canonical(source);
  const mine = new Set(w.sets.map((s) => key(s.exercise)));
  const theirs = new Set(p.sets.map((s) => key(s.exercise)));
  const both = (s: { exercise: string }) => mine.has(key(s.exercise)) && theirs.has(key(s.exercise));
  return {
    name: p.name,
    day: p.day,
    samePlanDay: p.planDayNum !== null && p.planDayNum === w.planDayNum,
    volume: volumeOf(p.sets.filter(both)),
    currentVolume: volumeOf(w.sets.filter(both)),
    shared: [...mine].filter((n) => theirs.has(n)).length,
    minutes,
  };
}
