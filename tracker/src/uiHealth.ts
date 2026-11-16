// The window's health routes under /v1/ui/health: what you ate, your weight and
// measurements, and daily targets. ui.ts has already checked the cookie and header.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, send } from './api.ts';
import { parseLocalDate } from './dates.ts';
import type { FoodEntry, Journal, Meal, NewFood, WeighIn } from './journal.ts';
import { MEALS } from './journal.ts';
import { dayKey } from './planner.ts';

type Body = Record<string, unknown>;

export interface HealthTargets {
  calories: number | null;
  protein: number | null;
}

export interface HealthView {
  day: string;
  foods: FoodEntry[];
  totals: { calories: number; protein: number; carbs: number; fat: number };
  targets: HealthTargets;
  /** That day's weigh-in, if any. */
  weighIn: WeighIn | null;
  /** The 90 days up to that day, oldest first. */
  weights: WeighIn[];
  /** Calories and protein for each of the 7 days up to that day, oldest first. */
  week: { day: string; calories: number; protein: number; items: number }[];
  recent: Omit<FoodEntry, 'id' | 'day' | 'at'>[];
}

function day(value: unknown): string {
  if (typeof value !== 'string' || parseLocalDate(value) === null) throw new HttpError(400, 'day must look like 2026-11-05');
  return value;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > max) throw new HttpError(400, `${name} must be text of up to ${max} characters`);
  return value.trim();
}

/** A number in range, or null when left empty. */
function amount(value: unknown, name: string, max: number, { required = false, min = 0 } = {}): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${name} is needed`);
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new HttpError(400, `${name} must be a number from ${min} to ${max}`);
  return Math.round(value * 10) / 10;
}

function meal(value: unknown): Meal {
  if (!MEALS.includes(value as Meal)) throw new HttpError(400, `meal must be one of ${MEALS.join(', ')}`);
  return value as Meal;
}

export function foodBody(body: unknown): NewFood {
  const raw = (body ?? {}) as Body;
  return {
    day: day(raw['day']),
    meal: meal(raw['meal']),
    name: text(raw['name'], 'What you ate', 200),
    calories: amount(raw['calories'], 'Calories', 10_000),
    protein: amount(raw['protein'], 'Protein', 1000),
    carbs: amount(raw['carbs'], 'Carbs', 2000),
    fat: amount(raw['fat'], 'Fat', 1000),
  };
}

export function weighInBody(dayValue: string, body: unknown): Omit<WeighIn, 'at'> {
  const raw = (body ?? {}) as Body;
  return {
    day: day(dayValue),
    weight: amount(raw['weight'], 'Weight', 500, { required: true, min: 1 }) as number,
    bodyFat: amount(raw['bodyFat'], 'Body fat', 80),
    waist: amount(raw['waist'], 'Waist', 300),
    ...(raw['note'] === undefined ? {} : { note: raw['note'] === null || raw['note'] === '' ? null : String(raw['note']).trim().slice(0, 2000) }),
  };
}

export function readTargets(journal: Journal): HealthTargets {
  const stored = journal.get('health.targets') as Partial<HealthTargets> | undefined;
  const pick = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return { calories: pick(stored?.calories), protein: pick(stored?.protein) };
}

const addDays = (date: string, days: number) => {
  const d = new Date(parseLocalDate(date) as number);
  d.setDate(d.getDate() + days);
  return dayKey(d.getTime());
};

export function buildHealth(journal: Journal, date: string): HealthView {
  const foods = journal.foods(date);
  const sum = (pick: (f: FoodEntry) => number | null) => Math.round(foods.reduce((s, f) => s + (pick(f) ?? 0), 0) * 10) / 10;
  const weekFrom = addDays(date, -6);
  const logged = new Map(journal.foodTotalsBetween(weekFrom, date).map((d) => [d.day, d]));
  const weights = journal.weighIns(addDays(date, -89), date);
  return {
    day: date,
    foods,
    totals: { calories: sum((f) => f.calories), protein: sum((f) => f.protein), carbs: sum((f) => f.carbs), fat: sum((f) => f.fat) },
    targets: readTargets(journal),
    weighIn: weights.at(-1)?.day === date ? (weights.at(-1) as WeighIn) : null,
    weights,
    week: Array.from({ length: 7 }, (_, i) => {
      const key = addDays(weekFrom, i);
      return logged.get(key) ?? { day: key, calories: 0, protein: 0, items: 0 };
    }),
    recent: journal.recentFoods(),
  };
}

/** Handles a health route; false when the route isn't one of these. */
export async function healthRoutes(
  journal: Journal,
  method: string,
  route: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  today: string,
  now: number,
): Promise<boolean> {
  if (!route.startsWith('/health')) return false;
  let m: RegExpExecArray | null;

  if (method === 'GET' && route === '/health') {
    send(response, 200, buildHealth(journal, day(url.searchParams.get('date') ?? today)));
    return true;
  }
  if (method === 'POST' && route === '/health/foods') {
    send(response, 201, journal.addFood(foodBody(await readJson(request)), now));
    return true;
  }
  if ((m = /^\/health\/foods\/(\d+)$/.exec(route)) && method === 'DELETE') {
    send(response, journal.deleteFood(Number(m[1])) ? 204 : 404);
    return true;
  }
  if ((m = /^\/health\/weight\/(\d{4}-\d{2}-\d{2})$/.exec(route))) {
    if (method === 'PUT') {
      send(response, 200, journal.setWeighIn(weighInBody(m[1] as string, await readJson(request)), now));
      return true;
    }
    if (method === 'DELETE') {
      send(response, journal.deleteWeighIn(day(m[1])) ? 204 : 404);
      return true;
    }
  }
  if (method === 'PUT' && route === '/health/targets') {
    const raw = ((await readJson(request)) ?? {}) as Body;
    const current = readTargets(journal);
    const next: HealthTargets = {
      calories: raw['calories'] === undefined ? current.calories : amount(raw['calories'], 'Calorie target', 10_000, { min: 1 }),
      protein: raw['protein'] === undefined ? current.protein : amount(raw['protein'], 'Protein target', 1000, { min: 1 }),
    };
    journal.set('health.targets', next);
    send(response, 200, next);
    return true;
  }
  return false;
}
