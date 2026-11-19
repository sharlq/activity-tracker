// The window's training-plan routes under /v1/ui/training: today's workout from the plan,
// logging it a set at a time, an exercise's detail, the plan, every plan with its weekly sets
// per muscle (the phone's plans, read from the gym app), and the progress dashboard.
// ui.ts has already checked the cookie and header before these run.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, send } from './api.ts';
import { parseLocalDate } from './dates.ts';
import type { Journal, PlanExercise, PlanExerciseChange } from './journal.ts';
import { expectedOn, shiftDay } from './progression.ts';
import type { ExerciseState } from './trainingPlan.ts';
import { bodyFigureSvg } from './bodyFigure.ts';
import { dataDir } from './config.ts';
import type { GymTarget } from './gymSync.ts';
import { convexQuery, loadGymTarget } from './gymSync.ts';
import type { MuscleLoad, PlanLoad, Verdict } from './muscles.ts';
import { planLoad, verdict } from './muscles.ts';
import { strengthBalance, strengthFocus, strengthGains, strengthScores, strengthTrend } from './strength.ts';
import { dashboard, exerciseState, nextPlanDay, planStates, todayView } from './trainingPlan.ts';

type Body = Record<string, unknown>;

function day(value: unknown): string {
  if (typeof value !== 'string' || parseLocalDate(value) === null) throw new HttpError(400, 'day must look like 2026-11-05');
  return value;
}

function num(value: unknown, name: string, { min = 0, max = 1000, whole = false } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (whole && !Number.isInteger(value))) {
    throw new HttpError(400, `${name} must be ${whole ? 'a whole number' : 'a number'} from ${min} to ${max}`);
  }
  return whole ? value : Math.round(value * 100) / 100;
}

const bool = (value: unknown, name: string) => {
  if (typeof value !== 'boolean') throw new HttpError(400, `${name} must be true or false`);
  return value;
};

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > max) throw new HttpError(400, `${name} must be text of up to ${max} characters`);
  return value.trim();
}

const noteOf = (value: unknown) => (value === null || value === '' ? null : text(value, 'Note', 2000));

/** An exercise's state without its full history: for lists. */
export function brief(s: ExerciseState) {
  const { sessions, ...rest } = s;
  const last = sessions.filter((x) => x.planDayId === s.exercise.dayId || x.planDayId === null).at(-1) ?? null;
  const since = shiftDay(rest.exercise.goals[0]?.day ?? last?.day ?? '2000-01-01', -182);
  const recent = sessions.filter((x) => x.day >= since && !x.copied).map((x) => ({ day: x.day, weight: x.weight }));
  return { ...rest, last: last && { day: last.day, weight: last.weight, reps: last.reps }, times: sessions.length, recent };
}

/** The exercise's own page: every session, and the aim line to draw against it. */
export function exerciseDetail(journal: Journal, id: number, today: string) {
  const exercise = journal.planExercise(id);
  if (!exercise) return null;
  const days = journal.planDays();
  const { states } = planStates(journal, today);
  const state =
    states.find((s) => s.exercise.id === id) ??
    exerciseState(exercise, days.find((d) => d.id === exercise.dayId)?.name ?? '?', journal.trainingSets([exercise.name, ...exercise.aliases]), today);
  const labels = new Map(journal.checkpoints().map((c) => [c.day, c.label]));
  const checkpoints = exercise.goals.map((g) => ({ ...g, label: labels.get(g.day) ?? g.day }));
  return {
    ...state,
    checkpoints,
    expectedToday: expectedOn(exercise.goals, today),
    days,
  };
}

/** The strength score and balance on a day (strength.ts), with the body figure to show them. */
export function strengthView(journal: Journal, date: string, standards: 'men' | 'women') {
  const sets = journal.strengthSets();
  const weighIns = journal.weighIns('0000-01-01', '9999-12-31').map((w) => ({ day: w.day, weight: w.weight }));
  const scores = strengthScores(sets, weighIns, date, standards);
  const balance = strengthBalance(scores);
  const trend = strengthTrend(sets, weighIns, date, standards);
  return {
    standards,
    scores,
    balance,
    focus: strengthFocus(scores, balance),
    trend,
    gains: strengthGains(trend),
    figure: bodyFigureSvg(scores.groups, 'level'),
    figureRelative: bodyFigureSvg(scores.groups, 'relative'),
  };
}

function exerciseChange(raw: Body, days: number[]): PlanExerciseChange & { goals?: { day: string; weight: number | null }[] } {
  const change: PlanExerciseChange & { goals?: { day: string; weight: number | null }[] } = {};
  if (raw['name'] !== undefined) change.name = text(raw['name'], 'Name', 200);
  if (raw['dayId'] !== undefined) {
    const id = num(raw['dayId'], 'Day', { min: 1, max: 1e9, whole: true });
    if (!days.includes(id)) throw new HttpError(400, 'no such plan day');
    change.dayId = id;
  }
  if (raw['position'] !== undefined) change.position = num(raw['position'], 'Position', { min: 1, max: 100, whole: true });
  if (raw['sets'] !== undefined) change.sets = num(raw['sets'], 'Sets', { min: 1, max: 10, whole: true });
  if (raw['repMin'] !== undefined) change.repMin = num(raw['repMin'], 'Lowest reps', { min: 1, max: 100, whole: true });
  if (raw['repMax'] !== undefined) change.repMax = num(raw['repMax'], 'Highest reps', { min: 1, max: 100, whole: true });
  if (raw['step'] !== undefined) change.step = num(raw['step'], 'Weight step', { min: 0.25, max: 50 });
  if (raw['laterSlot'] !== undefined) change.laterSlot = bool(raw['laterSlot'], 'Later slot');
  if (raw['perHand'] !== undefined) change.perHand = bool(raw['perHand'], 'Per hand');
  if (raw['perSide'] !== undefined) change.perSide = bool(raw['perSide'], 'Per side');
  if (raw['bodyweight'] !== undefined) change.bodyweight = bool(raw['bodyweight'], 'Bodyweight');
  if (raw['active'] !== undefined) change.active = bool(raw['active'], 'Active');
  if (raw['note'] !== undefined) change.note = noteOf(raw['note']);
  if (raw['aliases'] !== undefined) {
    if (!Array.isArray(raw['aliases'])) throw new HttpError(400, 'aliases must be a list of names');
    change.aliases = raw['aliases'].map((a) => text(a, 'Alias', 200));
  }
  if (raw['goals'] !== undefined) {
    if (!Array.isArray(raw['goals'])) throw new HttpError(400, 'goals must be a list of { day, weight }');
    change.goals = (raw['goals'] as Body[]).map((g) => ({ day: day(g['day']), weight: g['weight'] === null ? null : num(g['weight'], 'Goal weight', { min: 0, max: 1000 }) }));
  }
  return change;
}

interface ViewExercise { name: string; sets: number; repMin: number; repMax: number; note: string | null }
interface ViewPlan { name: string; note: string | null; active: boolean; days: { name: string; note: string | null; exercises: ViewExercise[] }[] }

/** Where the phone's plans are; replaced in tests. */
export const plansSource = {
  target: (): GymTarget | null => loadGymTarget(dataDir()),
  fetch: undefined as Parameters<typeof convexQuery>[3],
};

/**
 * Every plan to look at: the phone's (where plans are made and edited) when this PC syncs with
 * the gym app, else this PC's own one plan. Each comes with its weekly sets per muscle.
 */
export async function plansView(journal: Journal): Promise<{ source: 'phone' | 'pc'; error: string | null; plans: (ViewPlan & { load: Omit<PlanLoad, 'muscles'> & { muscles: (MuscleLoad & { verdict: Verdict })[] } })[] }> {
  const withLoad = (p: ViewPlan) => {
    const load = planLoad(p.days);
    return { ...p, load: { ...load, muscles: load.muscles.map((m) => ({ ...m, verdict: verdict(m) })) } };
  };
  const pcPlan = (): ViewPlan => {
    const exercises = journal.planExercises();
    return {
      name: "This PC's plan", note: null, active: true,
      days: journal.planDays().map((d) => ({ name: d.name, note: d.note, exercises: exercises.filter((e) => e.dayId === d.id).map((e) => ({ name: e.name, sets: e.sets, repMin: e.repMin, repMax: e.repMax, note: e.note })) })),
    };
  };
  let error: string | null = null;
  try {
    const target = plansSource.target();
    if (target) {
      const plans = (await convexQuery(target, 'sync:plans', {}, plansSource.fetch)) as ViewPlan[];
      return { source: 'phone', error: null, plans: plans.map(withLoad) };
    }
  } catch (e) {
    const text = (e as Error).message;
    error = /Could not find public function/.test(text) ? 'The gym app is not updated yet: deploy it to see the phone\'s plans here.' : `Couldn't reach the gym app: ${text}`;
  }
  return { source: 'pc', error, plans: [withLoad(pcPlan())] };
}

/** Handles a training route; false when the route isn't one of these. */
export async function trainingRoutes(journal: Journal, method: string, route: string, url: URL, request: IncomingMessage, response: ServerResponse, today: string, now: number): Promise<boolean> {
  if (!route.startsWith('/training')) return false;
  let m: RegExpExecArray | null;
  const done = (status: number, body?: object) => (send(response, status, body), true);

  if (method === 'GET' && route === '/training/today') {
    const date = day(url.searchParams.get('date') ?? today);
    const asked = url.searchParams.get('day');
    // A plan day already started that day stays up; else the next in the rotation.
    const started = journal.workouts(date).filter((w) => w.planDayId).at(-1)?.planDayId ?? null;
    const dayId = asked ? Number(asked) : (started ?? nextPlanDay(journal));
    if (dayId === null) throw new HttpError(404, 'the plan has no days');
    const view = todayView(journal, date, dayId);
    if (!view) throw new HttpError(404, 'no such plan day');
    return done(200, { ...view, exercises: view.exercises.map((e) => ({ ...e, state: brief(e.state) })), next: nextPlanDay(journal) });
  }

  // One set of a planned exercise, logged into that day's workout for the plan day.
  if (method === 'POST' && route === '/training/sets') {
    const raw = ((await readJson(request)) ?? {}) as Body;
    const date = day(raw['date'] ?? today);
    const exercise = journal.planExercise(num(raw['exerciseId'], 'Exercise', { min: 1, max: 1e9, whole: true }));
    if (!exercise) throw new HttpError(404, 'no such plan exercise');
    const weight = num(raw['weight'], 'Weight', { min: 0, max: 1000 });
    const reps = num(raw['reps'], 'Reps', { min: 0, max: 1000, whole: true });
    const planDay = journal.planDays().find((d) => d.id === exercise.dayId);
    let workout = journal.planWorkout(date, exercise.dayId);
    workout ??= journal.addWorkout({ day: date, start: null, name: planDay?.name ?? 'Workout', kind: 'strength', minutes: null, calories: null, note: null, source: 'manual', externalId: null, planDayId: exercise.dayId }, now);
    const existing = workout.sets.find((s) => [exercise.name, ...exercise.aliases].some((n) => n.toLowerCase() === s.exercise.toLowerCase()));
    journal.addSets(workout.id, existing?.exercise ?? exercise.name, [{ reps, weight: weight === 0 && exercise.bodyweight ? null : weight, rpe: null, seconds: null, distance: null }]);
    if (raw['formReset'] !== undefined || raw['note'] !== undefined) {
      journal.setExerciseLog(workout.id, existing?.exercise ?? exercise.name, {
        ...(raw['formReset'] !== undefined ? { formReset: bool(raw['formReset'], 'Form reset') } : {}),
        ...(raw['note'] !== undefined ? { note: noteOf(raw['note']) } : {}),
      });
    }
    const view = todayView(journal, date, exercise.dayId);
    const entry = view?.exercises.find((e) => e.state.exercise.id === exercise.id);
    return done(201, entry ? { ...entry, state: brief(entry.state), workoutId: workout.id } : { workoutId: workout.id });
  }

  if ((m = /^\/training\/sets\/(\d+)$/.exec(route)) && method === 'DELETE') {
    return done(journal.deleteSet(Number(m[1])) ? 204 : 404);
  }

  // A form reset or note on a planned exercise in that day's workout.
  if (method === 'PUT' && route === '/training/logs') {
    const raw = ((await readJson(request)) ?? {}) as Body;
    const date = day(raw['date'] ?? today);
    const exercise = journal.planExercise(num(raw['exerciseId'], 'Exercise', { min: 1, max: 1e9, whole: true }));
    if (!exercise) throw new HttpError(404, 'no such plan exercise');
    const workout = journal.planWorkout(date, exercise.dayId);
    if (!workout) throw new HttpError(409, 'Log a set first');
    const name = workout.sets.find((s) => [exercise.name, ...exercise.aliases].some((n) => n.toLowerCase() === s.exercise.toLowerCase()))?.exercise ?? exercise.name;
    journal.setExerciseLog(workout.id, name, {
      ...(raw['formReset'] !== undefined ? { formReset: bool(raw['formReset'], 'Form reset') } : {}),
      ...(raw['note'] !== undefined ? { note: noteOf(raw['note']) } : {}),
    });
    return done(204);
  }

  if (method === 'GET' && route === '/training/plan') {
    const { days, states } = planStates(journal, today);
    return done(200, { today, days, checkpoints: journal.checkpoints(), bodyGoals: journal.bodyGoals(), exercises: states.map(brief) });
  }

  if (method === 'GET' && route === '/training/plans') return done(200, await plansView(journal));

  if (method === 'POST' && route === '/training/exercises') {
    const raw = ((await readJson(request)) ?? {}) as Body;
    const days = journal.planDays().map((d) => d.id);
    const c = exerciseChange(raw, days);
    if (c.dayId === undefined || c.name === undefined || c.sets === undefined || c.repMin === undefined || c.repMax === undefined || c.step === undefined) {
      throw new HttpError(400, 'A new exercise needs dayId, name, sets, repMin, repMax, and step');
    }
    if (c.repMax < c.repMin) throw new HttpError(400, 'Highest reps must be at least the lowest');
    const added: PlanExercise = journal.addPlanExercise(
      { dayId: c.dayId, name: c.name, aliases: c.aliases ?? [], sets: c.sets, repMin: c.repMin, repMax: c.repMax, step: c.step, laterSlot: c.laterSlot ?? false, perHand: c.perHand ?? false, perSide: c.perSide ?? false, bodyweight: c.bodyweight ?? false, note: c.note ?? null, goals: (c.goals ?? []).filter((g): g is { day: string; weight: number } => g.weight !== null) },
      now,
    );
    return done(201, added);
  }

  if ((m = /^\/training\/exercises\/(\d+)$/.exec(route))) {
    const id = Number(m[1]);
    if (method === 'GET') {
      const detail = exerciseDetail(journal, id, today);
      if (!detail) throw new HttpError(404, 'no such plan exercise');
      return done(200, detail);
    }
    if (method === 'PATCH') {
      const current = journal.planExercise(id);
      if (!current) throw new HttpError(404, 'no such plan exercise');
      const { goals, ...change } = exerciseChange(((await readJson(request)) ?? {}) as Body, journal.planDays().map((d) => d.id));
      if ((change.repMax ?? current.repMax) < (change.repMin ?? current.repMin)) throw new HttpError(400, 'Highest reps must be at least the lowest');
      journal.updatePlanExercise(id, change);
      for (const g of goals ?? []) journal.setExerciseGoal(id, g.day, g.weight);
      return done(200, journal.planExercise(id) ?? undefined);
    }
  }

  if ((m = /^\/training\/body-goals\/(\d{4}-\d{2}-\d{2})$/.exec(route)) && method === 'PUT') {
    const raw = ((await readJson(request)) ?? {}) as Body;
    journal.setBodyGoal({ day: day(m[1]), weight: num(raw['weight'], 'Target weight', { min: 20, max: 300 }), lean: raw['lean'] === null || raw['lean'] === undefined ? null : num(raw['lean'], 'Lean mass', { min: 10, max: 300 }) });
    return done(200, journal.bodyGoals());
  }

  if (method === 'GET' && route === '/training/progress') return done(200, dashboard(journal, day(url.searchParams.get('date') ?? today)));

  if (method === 'GET' && route === '/training/strength') return done(200, strengthView(journal, day(url.searchParams.get('date') ?? today), url.searchParams.get('standards') === 'women' ? 'women' : 'men'));

  if (method === 'GET' && route === '/training/flagged') return done(200, journal.flaggedSets());
  if ((m = /^\/training\/flagged\/(\d+)$/.exec(route)) && method === 'POST') {
    return done(journal.setSetFlag(Number(m[1]), 'kept') ? 204 : 404);
  }
  return false;
}
