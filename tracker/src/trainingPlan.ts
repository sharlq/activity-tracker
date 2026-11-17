// The training plan put together: each planned exercise with its history as sessions, the
// engine's verdict and suggestion, goal progress, and flags; plus the dashboard. Reads
// from the journal (or the gym app's own data) and hands plain data to progression.ts, which decides everything.
import type { PlanDay, PlanExercise, TrainingSet, TrainingSource } from './trainingTypes.ts';
import type { BodyFlag, Checkpoint, ExerciseRule, Flag, GoalProgress, Session, Suggestion, Verdict } from './progression.ts';
import { bodyFlags, copiedRuns, estimated1RM, expectedOn, ffmi, flags, goalProgress, median, medianChange, quantile, rollingAverage, shiftDay, suggest, verdict, weightAsOf, weightLabel } from './progression.ts';

export interface PlanSession extends Session {
  workoutId: number;
  source: string;
  planDayId: number | null;
  note: string | null;
  e1rm: number;
  /** The engine's verdict on this session. */
  verdict: Verdict;
}

export interface ExerciseState {
  exercise: PlanExercise;
  day: string;
  rule: ExerciseRule;
  /** Every session of it, oldest first (sets flagged as typos left out). */
  sessions: PlanSession[];
  /** The ones the engine compares with: logged on its own plan day, else imported history. */
  comparedWith: 'plan day' | 'history' | 'none';
  suggestion: Suggestion;
  /** The working weight now, as a label too. */
  current: number | null;
  currentLabel: string | null;
  suggestedLabel: string;
  progress: GoalProgress | null;
  /** The goal at the last checkpoint. */
  finalGoal: Checkpoint | null;
  flags: Flag[];
}

export const ruleOf = (e: PlanExercise): ExerciseRule => ({ sets: e.sets, repMin: e.repMin, repMax: e.repMax, step: e.step, laterSlot: e.laterSlot, bodyweight: e.bodyweight, perHand: e.perHand, perSide: e.perSide });

const namesOf = (e: PlanExercise) => [e.name, ...e.aliases];

/** Sets into sessions: one per workout, at its heaviest weight, with the reps of the sets at that weight. */
export function sessionsOf(exercise: PlanExercise, sets: readonly TrainingSet[]): PlanSession[] {
  const names = new Set(namesOf(exercise).map((n) => n.toLowerCase()));
  const rule = ruleOf(exercise);
  const byWorkout = new Map<number, TrainingSet[]>();
  for (const s of sets) {
    if (!names.has(s.exercise.toLowerCase()) || s.flag === 'outlier' || s.reps === null) continue;
    const weight = s.weight ?? (exercise.bodyweight ? 0 : null);
    if (weight === null) continue;
    const list = byWorkout.get(s.workoutId) ?? [];
    list.push({ ...s, weight });
    byWorkout.set(s.workoutId, list);
  }
  const sessions: PlanSession[] = [...byWorkout.values()].map((list) => {
    const first = list[0] as TrainingSet;
    const weight = Math.max(...list.map((s) => s.weight as number));
    const reps = list.filter((s) => s.weight === weight).map((s) => s.reps as number);
    return {
      day: first.day, weight, reps, formReset: list.some((s) => s.formReset), copied: false,
      workoutId: first.workoutId, source: first.source, planDayId: first.planDayId, note: list.find((s) => s.note)?.note ?? null,
      e1rm: estimated1RM(weight, list.map((s) => s.reps)), verdict: verdict(rule, weight, reps),
    };
  });
  // Copies only come from the old app's history.
  const imported = sessions.filter((s) => s.source !== 'manual');
  for (const i of copiedRuns(imported)) (imported[i] as PlanSession).copied = true;
  return sessions;
}

const checkpointsOf = (e: PlanExercise): Checkpoint[] => e.goals.map((g) => ({ day: g.day, weight: g.weight }));

/** An exercise's state on a day, from its history before `before` (to leave today's sets out). */
export function exerciseState(exercise: PlanExercise, dayName: string, sets: readonly TrainingSet[], today: string, { before }: { before?: number } = {}): ExerciseState {
  const rule = ruleOf(exercise);
  const all = sessionsOf(exercise, sets);
  const sessions = before === undefined ? all : all.filter((s) => s.workoutId !== before);
  const own = sessions.filter((s) => s.planDayId === exercise.dayId);
  // Never compared with a session done as another plan day (where it may have come fresh).
  const history = sessions.filter((s) => s.planDayId === null);
  const compared = own.length ? own : history;
  const comparedWith = own.length ? 'plan day' : history.length ? 'history' : 'none';
  const checkpoints = checkpointsOf(exercise);
  const start = checkpoints.length ? [...checkpoints].sort((a, b) => a.day.localeCompare(b.day))[0]!.weight : null;
  const suggestion = suggest(rule, compared, start);
  const current = compared.at(-1)?.weight ?? null;
  return {
    exercise,
    day: dayName,
    rule,
    sessions: all,
    comparedWith,
    suggestion,
    current,
    currentLabel: current === null ? null : weightLabel(current, rule),
    suggestedLabel: weightLabel(suggestion.weight, rule),
    progress: current === null ? null : goalProgress(checkpoints, today, current, exercise.step),
    finalGoal: checkpoints.length ? (checkpoints.reduce((a, b) => (b.day > a.day ? b : a)) as Checkpoint) : null,
    flags: flags(rule, compared),
  };
}

function load(journal: TrainingSource, exercises: readonly PlanExercise[]): TrainingSet[] {
  return journal.trainingSets([...new Set(exercises.flatMap(namesOf).map((n) => n.toLowerCase()))]);
}

export function planStates(journal: TrainingSource, today: string): { days: PlanDay[]; states: ExerciseState[] } {
  const days = journal.planDays();
  const exercises = journal.planExercises();
  const sets = load(journal, exercises);
  const dayName = new Map(days.map((d) => [d.id, d.name]));
  return { days, states: exercises.map((e) => exerciseState(e, dayName.get(e.dayId) ?? '?', sets, today)) };
}

// ------------------------------------------------------------------ today's workout

export interface TodayExercise {
  state: ExerciseState;
  /** What's logged today for it, set by set. */
  logged: { id: number; weight: number | null; reps: number | null; at: number | null }[];
  /** The verdict on today's sets so far, once there's at least one. */
  now: Verdict | null;
  formReset: boolean;
  note: string | null;
}

export interface TodayView {
  date: string;
  day: PlanDay;
  days: PlanDay[];
  workoutId: number | null;
  exercises: TodayExercise[];
}

export function todayView(journal: TrainingSource, date: string, dayId: number): TodayView | null {
  const days = journal.planDays();
  const day = days.find((d) => d.id === dayId);
  if (!day) return null;
  const workout = journal.planWorkout(date, dayId);
  const exercises = journal.planExercises().filter((e) => e.dayId === dayId);
  const sets = load(journal, exercises);
  return {
    date,
    day,
    days,
    workoutId: workout?.id ?? null,
    exercises: exercises.map((e) => {
      const state = exerciseState(e, day.name, sets, date, workout ? { before: workout.id } : {});
      const names = new Set(namesOf(e).map((n) => n.toLowerCase()));
      const mine = sets.filter((s) => s.workoutId === workout?.id && names.has(s.exercise.toLowerCase()));
      const logged = mine.map((s) => ({ id: s.setId, weight: s.weight, reps: s.reps, at: s.at ?? null }));
      const weight = logged.at(-1)?.weight ?? (e.bodyweight ? 0 : null);
      const reps = logged.filter((s) => s.reps !== null && (s.weight ?? (e.bodyweight ? 0 : null)) === weight).map((s) => s.reps);
      return {
        state,
        logged,
        now: logged.length && weight !== null ? verdict(state.rule, weight, reps) : null,
        formReset: mine.some((s) => s.formReset),
        note: mine.find((s) => s.note)?.note ?? null,
      };
    }),
  };
}

/** The plan day to do next: the one after the last one logged, else the first. */
export function nextPlanDay(journal: TrainingSource): number | null {
  const days = journal.planDays();
  if (!days.length) return null;
  const { states } = planStates(journal, '9999-12-31');
  const last = states
    .flatMap((s) => s.sessions.filter((x) => x.planDayId !== null))
    .sort((a, b) => a.day.localeCompare(b.day) || a.workoutId - b.workoutId)
    .at(-1);
  if (!last) return (days[0] as PlanDay).id;
  const i = days.findIndex((d) => d.id === last.planDayId);
  return (days[(i + 1) % days.length] as PlanDay).id;
}

// ------------------------------------------------------------------ the dashboard

export interface Dashboard {
  today: string;
  weeks: { monday: string; sessions: number; recent: boolean; low: boolean }[];
  onTrack: { share: number | null; counted: number; behind: string[] };
  quarters: { label: string; from: string; to: string; change: number | null; vsPrevious: number | null; partial: boolean }[];
  /** All lifts against the aim, as % of each one's final goal (bodyweight lifts left out). */
  aim: { day: string; aim: number | null; actual: number | null; low: number | null; high: number | null }[];
  body: BodyView;
  flags: BodyFlag[];
  stalled: string[];
  heightCm: number;
}

export interface BodyView {
  points: { day: string; weight: number; waist: number | null; note: string | null }[];
  average: { day: string; weight: number }[];
  targets: { day: string; weight: number; lean: number | null; ffmi: number | null; label: string }[];
  /** Where the target line is today, and the last 7-day average against it. */
  targetToday: number | null;
  difference: number | null;
}

const mondayOf = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return shiftDay(day, -((d.getUTCDay() + 6) % 7));
};

export function bodyView(journal: TrainingSource, today: string): BodyView {
  const height = Number(journal.get('training.heightCm') ?? 172) || 172;
  const labels = new Map(journal.checkpoints().map((c) => [c.day, c.label]));
  const goals = journal.bodyGoals();
  const points = journal.weighIns(shiftDay(today, -365), today).map((w) => ({ day: w.day, weight: w.weight, waist: w.waist, note: w.note ?? null }));
  const average = rollingAverage(points);
  const targetToday = expectedOn(goals.map((g) => ({ day: g.day, weight: g.weight })), today);
  const last = average.at(-1);
  return {
    points,
    average,
    targets: goals.map((g) => ({ ...g, ffmi: g.lean === null ? null : ffmi(g.lean, height), label: labels.get(g.day) ?? g.day })),
    targetToday,
    difference: last && targetToday !== null ? Math.round((last.weight - targetToday) * 10) / 10 : null,
  };
}

export function dashboard(journal: TrainingSource, today: string): Dashboard {
  const { states } = planStates(journal, today);
  const checkpoints = journal.checkpoints();

  // Sessions a week, back a year at most.
  const first = journal.firstWorkoutDay();
  const from = mondayOf(first && first > shiftDay(today, -364) ? first : shiftDay(today, -364));
  const perDay = journal.strengthDays(from, today);
  const weeks: Dashboard['weeks'] = [];
  const thisMonday = mondayOf(today);
  for (let m = from; m <= thisMonday; m = shiftDay(m, 7)) {
    const end = shiftDay(m, 6);
    const sessions = perDay.filter((d) => d.day >= m && d.day <= end).reduce((n, d) => n + d.sessions, 0);
    weeks.push({ monday: m, sessions, recent: m > shiftDay(thisMonday, -84), low: sessions < 3 && m !== thisMonday });
  }

  const counted = states.filter((s) => s.progress);
  const good = counted.filter((s) => s.progress?.status !== 'behind');

  // Quarters: between checkpoints from the first on, and 3-month steps back before it.
  const start = checkpoints[0]?.day ?? today;
  const monthsBack = (d: string, n: number) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCMonth(t.getUTCMonth() - n);
    return t.toISOString().slice(0, 10);
  };
  const edges = [monthsBack(start, 12), monthsBack(start, 9), monthsBack(start, 6), monthsBack(start, 3), ...checkpoints.map((c) => c.day)].filter((d, i, a) => a.indexOf(d) === i).sort();
  const quarters: Dashboard['quarters'] = [];
  for (let i = 1; i < edges.length; i++) {
    const a = edges[i - 1] as string;
    const b = edges[i] as string;
    if (a >= today) break;
    const to = b > today ? today : b;
    const change = medianChange(states, a, to);
    const previous = quarters.at(-1)?.change ?? null;
    quarters.push({
      label: checkpoints.find((c) => c.day === b)?.label ?? `To ${b}`,
      from: a, to, change, vsPrevious: change !== null && previous !== null ? Math.round((change - previous) * 10) / 10 : null, partial: b > today,
    });
  }

  // Aim against actual, week by week, from 12 weeks before the first checkpoint to the last.
  const weighted = states.filter((s) => !s.exercise.bodyweight && s.finalGoal && s.finalGoal.weight > 0);
  const end = checkpoints.at(-1)?.day ?? today;
  const aim: Dashboard['aim'] = [];
  const aimDays: string[] = [];
  for (let d = shiftDay(start, -84); d < end; d = shiftDay(d, 7)) aimDays.push(d);
  // Today and every checkpoint too, so the lines meet the goals and end on today exactly.
  const extra = [today, ...checkpoints.map((c) => c.day)].filter((d) => d >= shiftDay(start, -84) && d <= end);
  for (const d of [...new Set([...aimDays, ...extra])].sort()) {
    const aims = d >= start ? weighted.map((s) => (expectedOn(checkpointsOf(s.exercise), d) as number) / (s.finalGoal as Checkpoint).weight * 100) : [];
    const actuals = d <= today ? weighted.flatMap((s) => {
      const w = weightAsOf(s.sessions.filter((x) => !x.copied), d);
      return w === null ? [] : [(w / (s.finalGoal as Checkpoint).weight) * 100];
    }) : [];
    const r = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
    aim.push({ day: d, aim: r(median(aims)), actual: r(median(actuals)), low: r(quantile(actuals, 0.25)), high: r(quantile(actuals, 0.75)) });
  }

  const stalled = states.filter((s) => s.flags.some((f) => f.kind === 'stalled')).map((s) => s.exercise.name);
  const body = bodyView(journal, today);
  return {
    today,
    weeks,
    onTrack: { share: counted.length ? good.length / counted.length : null, counted: counted.length, behind: counted.filter((s) => s.progress?.status === 'behind').map((s) => s.exercise.name) },
    quarters,
    aim,
    body,
    flags: bodyFlags(body.points, today, states.length ? stalled.length / states.length : 0),
    stalled,
    heightCm: Number(journal.get('training.heightCm') ?? 172) || 172,
  };
}
