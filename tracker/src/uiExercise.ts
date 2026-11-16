// The window's exercise routes under /v1/ui/exercise: workouts and their sets.
// ui.ts has already checked the cookie and header before these run.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, send } from './api.ts';
import { parseLocalDate } from './dates.ts';
import { parseSets, SetSpecError } from './exercise.ts';
import type { ExerciseHistory, Journal, NewSet, NewWorkout, Workout, WorkoutChange, WorkoutKind } from './journal.ts';
import { WORKOUT_KINDS } from './journal.ts';
import { dayKey } from './planner.ts';

type Body = Record<string, unknown>;

export interface ExerciseView {
  day: string;
  workouts: Workout[];
  /** Each of the 7 days up to that day, oldest first. */
  week: { day: string; sessions: number; minutes: number; volume: number }[];
  /** Exercises done lately, to log again with a click. */
  recent: string[];
  /** Best set and last time for that day's exercises and the recent ones. */
  history: ExerciseHistory[];
}

function day(value: unknown): string {
  if (typeof value !== 'string' || parseLocalDate(value) === null) throw new HttpError(400, 'day must look like 2026-11-05');
  return value;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > max) throw new HttpError(400, `${name} must be text of up to ${max} characters`);
  return value.trim();
}

function amount(value: unknown, name: string, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new HttpError(400, `${name} must be a number from 0 to ${max}`);
  return Math.round(value * 10) / 10;
}

function kind(value: unknown): WorkoutKind {
  if (value === undefined || value === null || value === '') return 'strength';
  if (!WORKOUT_KINDS.includes(value as WorkoutKind)) throw new HttpError(400, `kind must be one of ${WORKOUT_KINDS.join(', ')}`);
  return value as WorkoutKind;
}

function start(value: unknown, onDay: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new HttpError(400, 'start must be a time');
  if (dayKey(value) !== onDay) throw new HttpError(400, `A workout on ${onDay} has to start that day`);
  return value;
}

export function workoutBody(body: unknown): NewWorkout {
  const raw = (body ?? {}) as Body;
  const onDay = day(raw['day']);
  return {
    day: onDay,
    start: start(raw['start'], onDay),
    name: text(raw['name'], 'Workout', 200),
    kind: kind(raw['kind']),
    minutes: amount(raw['minutes'], 'Minutes', 24 * 60),
    calories: amount(raw['calories'], 'Calories', 10_000),
    note: raw['note'] === undefined || raw['note'] === null || raw['note'] === '' ? null : text(raw['note'], 'Note', 2000),
    source: 'manual',
    externalId: null,
  };
}

/** Sets from the window: a list, or the short way ("3x8@60"). */
export function setsBody(body: unknown): { exercise: string; sets: NewSet[] } {
  const raw = (body ?? {}) as Body;
  const exercise = text(raw['exercise'], 'Exercise', 200);
  if (typeof raw['spec'] === 'string') {
    try {
      return { exercise, sets: parseSets(raw['spec'], { lb: raw['unit'] === 'lb' }) };
    } catch (error) {
      if (error instanceof SetSpecError) throw new HttpError(400, error.message);
      throw error;
    }
  }
  if (!Array.isArray(raw['sets']) || raw['sets'].length === 0 || raw['sets'].length > 50) throw new HttpError(400, 'sets must be 1 to 50 sets, or a spec like 3x8@60');
  return {
    exercise,
    sets: (raw['sets'] as Body[]).map((s) => {
      const reps = amount(s['reps'], 'Reps', 1000);
      const set = { reps: reps === null ? null : Math.round(reps), weight: amount(s['weight'], 'Weight', 1000), rpe: amount(s['rpe'], 'RPE', 10), seconds: amount(s['seconds'], 'Seconds', 86_400), distance: amount(s['distance'], 'Distance', 1_000_000) };
      if (set.reps === null && set.seconds === null && set.distance === null) throw new HttpError(400, 'A set needs reps, seconds, or a distance');
      return set;
    }),
  };
}

const addDays = (date: string, days: number) => {
  const d = new Date(parseLocalDate(date) as number);
  d.setDate(d.getDate() + days);
  return dayKey(d.getTime());
};

export function buildExercise(journal: Journal, date: string): ExerciseView {
  const workouts = journal.workouts(date);
  const from = addDays(date, -6);
  const totals = new Map(journal.workoutTotalsBetween(from, date).map((d) => [d.day, d]));
  const recent = journal.recentExercises();
  const names = [...new Map([...workouts.flatMap((w) => w.sets.map((s) => s.exercise)), ...recent].map((n) => [n.toLowerCase(), n])).values()];
  return {
    day: date,
    workouts,
    week: Array.from({ length: 7 }, (_, i) => {
      const key = addDays(from, i);
      return totals.get(key) ?? { day: key, sessions: 0, minutes: 0, volume: 0 };
    }),
    recent,
    history: journal.exerciseHistory(names),
  };
}

/** Handles an exercise route; false when the route isn't one of these. */
export async function exerciseRoutes(journal: Journal, method: string, route: string, url: URL, request: IncomingMessage, response: ServerResponse, today: string, now: number): Promise<boolean> {
  if (!route.startsWith('/exercise')) return false;
  let m: RegExpExecArray | null;
  const done = (status: number, body?: object) => (send(response, status, body), true);

  if (method === 'GET' && route === '/exercise') return done(200, buildExercise(journal, day(url.searchParams.get('date') ?? today)));
  if (method === 'POST' && route === '/exercise/workouts') return done(201, journal.addWorkout(workoutBody(await readJson(request)), now));
  if ((m = /^\/exercise\/workouts\/(\d+)$/.exec(route))) {
    const id = Number(m[1]);
    if (method === 'PATCH') {
      const existing = journal.workout(id);
      if (!existing) throw new HttpError(404, 'no such workout');
      const raw = ((await readJson(request)) ?? {}) as Body;
      const change: WorkoutChange = {};
      if (raw['name'] !== undefined) change.name = text(raw['name'], 'Workout', 200);
      if (raw['kind'] !== undefined) change.kind = kind(raw['kind']);
      if (raw['minutes'] !== undefined) change.minutes = amount(raw['minutes'], 'Minutes', 24 * 60);
      if (raw['calories'] !== undefined) change.calories = amount(raw['calories'], 'Calories', 10_000);
      if (raw['note'] !== undefined) change.note = raw['note'] === null || raw['note'] === '' ? null : text(raw['note'], 'Note', 2000);
      if (raw['start'] !== undefined) change.start = start(raw['start'], existing.day);
      return done(200, journal.updateWorkout(id, change) ?? undefined);
    }
    if (method === 'DELETE') return done(journal.deleteWorkout(id) ? 204 : 404);
  }
  if ((m = /^\/exercise\/workouts\/(\d+)\/sets$/.exec(route)) && method === 'POST') {
    const { exercise, sets } = setsBody(await readJson(request));
    const workout = journal.addSets(Number(m[1]), exercise, sets);
    if (!workout) throw new HttpError(404, 'no such workout');
    return done(201, workout);
  }
  if ((m = /^\/exercise\/sets\/(\d+)$/.exec(route)) && method === 'DELETE') {
    const workout = journal.deleteSet(Number(m[1]));
    if (!workout) throw new HttpError(404, 'no such set');
    return done(200, workout);
  }
  return false;
}
