// The cloud's data as the engine's TrainingSource: everything loaded once per call, then
// read in memory the way journal.ts reads SQLite (same order, same matching), so the
// shared trainingPlan.ts gives the same answers here as on the PC.
//
// Plans: the engine sees one plan at a time (the active one, unless asked for another).
// Sessions done on another plan's days count as history, like the old app's imports, so
// switching plans keeps every lift's weights.
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { PlanDay, PlanExercise, TrainingSet, TrainingSource } from '../../../tracker/src/trainingTypes.ts';

export interface Loaded {
  plans: Doc<'plans'>[];
  days: Doc<'planDays'>[];
  exercises: Doc<'planExercises'>[];
  workouts: Doc<'workouts'>[];
  checkpoints: Doc<'checkpoints'>[];
  bodyGoals: Doc<'bodyGoals'>[];
  weighIns: Doc<'weighIns'>[];
  settings: Doc<'settings'>[];
}

export async function loadAll(ctx: QueryCtx): Promise<Loaded> {
  const [plans, days, exercises, workouts, checkpoints, bodyGoals, weighIns, settings] = await Promise.all([
    ctx.db.query('plans').collect(),
    ctx.db.query('planDays').collect(),
    ctx.db.query('planExercises').collect(),
    ctx.db.query('workouts').filter((q) => q.neq(q.field('deleted'), true)).collect(),
    ctx.db.query('checkpoints').collect(),
    ctx.db.query('bodyGoals').collect(),
    ctx.db.query('weighIns').collect(),
    ctx.db.query('settings').collect(),
  ]);
  return { plans, days, exercises, workouts, checkpoints, bodyGoals, weighIns, settings };
}

/** The plan "today" follows: the one marked active, else the oldest. */
export function activePlan(data: Pick<Loaded, 'plans'>): Doc<'plans'> | null {
  return data.plans.find((p) => p.active) ?? [...data.plans].sort((a, b) => a.num - b.num)[0] ?? null;
}

/** The plan a plan day belongs to. */
export const planOfDay = (data: Pick<Loaded, 'plans' | 'days'>, dayNum: number | null): Doc<'plans'> | null => {
  const day = data.days.find((d) => d.num === dayNum);
  return day ? (data.plans.find((p) => p.num === day.planNum) ?? null) : null;
};

export const planDayOf = (d: Doc<'planDays'>): PlanDay => ({ id: d.num, name: d.name, position: d.position, note: d.note });

export const planExerciseOf = (e: Doc<'planExercises'>): PlanExercise => ({
  id: e.num, dayId: e.dayNum, position: e.position, name: e.name, aliases: e.aliases, sets: e.sets, repMin: e.repMin, repMax: e.repMax,
  step: e.step, laterSlot: e.laterSlot, perHand: e.perHand, bodyweight: e.bodyweight, note: e.note, active: e.active,
  goals: [...e.goals].sort((a, b) => a.day.localeCompare(b.day)),
});

const byOrder = (a: Doc<'workouts'>, b: Doc<'workouts'>) =>
  a.day.localeCompare(b.day) || (a.start ?? a.createdAt) - (b.start ?? b.createdAt) || a.num - b.num;

export function sourceOf(data: Loaded, planNum: number | null = activePlan(data)?.num ?? null): TrainingSource {
  const days = data.days
    .filter((d) => d.planNum === planNum)
    .sort((a, b) => a.position - b.position || a.num - b.num)
    .map(planDayOf);
  const dayIds = new Set(days.map((d) => d.id));
  const exercises = data.exercises
    .filter((e) => e.active && dayIds.has(e.dayNum))
    .sort((a, b) => a.dayNum - b.dayNum || a.position - b.position || a.num - b.num)
    .map(planExerciseOf);
  const workouts = [...data.workouts].sort(byOrder);
  const settings = new Map(data.settings.map((s) => [s.key, s.value as unknown]));
  return {
    planDays: () => days,
    planExercises: () => exercises,
    trainingSets(names) {
      const wanted = new Set(names.map((n) => n.toLowerCase()));
      const out: TrainingSet[] = [];
      for (const w of workouts) {
        const sets = w.sets.filter((s) => wanted.has(s.exercise.toLowerCase())).sort((a, b) => a.position - b.position || a.setNo - b.setNo || a.num - b.num);
        for (const s of sets) {
          const log = w.logs.find((l) => l.exercise.toLowerCase() === s.exercise.toLowerCase());
          out.push({
            setId: s.num, workoutId: w.num, day: w.day, planDayId: w.planDayNum !== null && dayIds.has(w.planDayNum) ? w.planDayNum : null, source: w.source, exercise: s.exercise, setNo: s.setNo,
            reps: s.reps, weight: s.weight, flag: s.flag, formReset: log?.formReset ?? false, note: log?.note ?? null,
          });
        }
      }
      return out;
    },
    planWorkout(day, planDayId) {
      const found = data.workouts.filter((w) => w.day === day && w.planDayNum === planDayId).sort((a, b) => a.num - b.num)[0];
      return found ? { id: found.num } : null;
    },
    checkpoints: () => [...data.checkpoints].sort((a, b) => a.day.localeCompare(b.day)).map(({ day, label }) => ({ day, label })),
    bodyGoals: () => [...data.bodyGoals].sort((a, b) => a.day.localeCompare(b.day)).map(({ day, weight, lean }) => ({ day, weight, lean })),
    weighIns: (from, to) =>
      data.weighIns
        .filter((w) => w.day >= from && w.day <= to)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map(({ day, weight, bodyFat, waist, note, at }) => ({ day, weight, bodyFat, waist, note, at })),
    strengthDays(from, to) {
      const count = new Map<string, number>();
      for (const w of data.workouts) if (w.kind === 'strength' && w.day >= from && w.day <= to && w.sets.length) count.set(w.day, (count.get(w.day) ?? 0) + 1);
      return [...count].sort(([a], [b]) => a.localeCompare(b)).map(([day, sessions]) => ({ day, sessions }));
    },
    firstWorkoutDay: () => data.workouts.filter((w) => w.kind === 'strength').map((w) => w.day).sort()[0] ?? null,
    get: (key) => settings.get(key),
  };
}
