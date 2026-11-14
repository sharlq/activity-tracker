// raqib health | food | weigh
//
// What you ate and your weight, from the command line, so Claude can log a meal or a
// weigh-in from a chat. Checked by the same rules as the window's Health page.
import { HttpError } from './api.ts';
import { id, openJournal, options, parseDay, UsageError } from './cliShared.ts';
import type { FoodEntry, Meal } from './journal.ts';
import { MEALS } from './journal.ts';
import type { HealthView } from './uiHealth.ts';
import { buildHealth, foodBody, readTargets, weighInBody } from './uiHealth.ts';

export const HEALTH_USAGE = `  raqib health [date] [--json]         Food and totals against targets, weight trend, last 7 days
  raqib health target [--kcal 2200|none] [--protein 140|none]
                                      Daily targets
  raqib food add "what" [--meal lunch] [--kcal 650] [--protein 40] [--carbs 70] [--fat 18] [--date D]
                                      Log something eaten (meal defaults by the clock; also: food rm <id>)
  raqib weigh 81.2 [--bodyfat 21.5|none] [--waist 90|none] [--date D]
                                      Weight in kg, one a day (again updates it; also: weigh rm [--date D])`;

/** The window's rules speak HTTP; here a broken rule is a usage mistake. */
function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof HttpError) throw new UsageError(error.message[0]?.toUpperCase() + error.message.slice(1));
    throw error;
  }
}

function number(text: string | undefined, name: string): number | null | undefined {
  if (text === undefined) return undefined;
  if (text === 'none') return null;
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n)) throw new UsageError(`--${name} takes a number, like 40`);
  return n;
}

export function mealForHour(hour: number): Meal {
  return hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 22 ? 'dinner' : 'snack';
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const kcal = (n: number) => `${Math.round(n).toLocaleString('en-GB')} kcal`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : '±'}${Math.abs(r1(n)).toFixed(1)} kg`;
export const foodLine = (f: FoodEntry) => {
  const amounts = [f.calories !== null ? kcal(f.calories) : null, f.protein !== null ? `${r1(f.protein)} g protein` : null, f.carbs !== null ? `${r1(f.carbs)} g carbs` : null, f.fat !== null ? `${r1(f.fat)} g fat` : null].filter(Boolean);
  return `  #${f.id}  ${f.meal.padEnd(9)}  ${f.name}${amounts.length ? `  (${amounts.join(' · ')})` : '  (no amounts)'}`;
};

function ofTarget(value: number, target: number | null, format: (n: number) => string): string {
  if (!target) return format(value);
  const left = target - value;
  return `${format(value)} of ${format(target)} (${left >= 0 ? `${format(left)} left` : `${format(-left)} over`})`;
}

export function healthText(v: HealthView): string {
  const g = (n: number) => `${r1(n)} g`;
  const out = [`Health for ${v.day}`, '', `Eaten: ${ofTarget(v.totals.calories, v.targets.calories, kcal)} · protein ${ofTarget(v.totals.protein, v.targets.protein, g)} · carbs ${g(v.totals.carbs)} · fat ${g(v.totals.fat)}`];
  const byMeal = [...v.foods].sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
  out.push(byMeal.length ? byMeal.map(foodLine).join('\n') : '  Nothing logged.');

  const latest = v.weights.at(-1);
  out.push('');
  if (latest) {
    const monthAgo = v.weights.find((w) => w.day !== latest.day && Date.parse(latest.day) - Date.parse(w.day) <= 30 * 86_400_000);
    const extra = [latest.bodyFat !== null ? `body fat ${r1(latest.bodyFat)}%` : null, latest.waist !== null ? `waist ${r1(latest.waist)} cm` : null].filter(Boolean);
    out.push(`Weight: ${latest.weight.toFixed(1)} kg on ${latest.day}${extra.length ? ` · ${extra.join(' · ')}` : ''}${monthAgo ? ` (${signed(latest.weight - monthAgo.weight)} since ${monthAgo.day})` : ''}`);
    const recent = v.weights.slice(-6).reverse();
    out.push(recent.map((w, i) => `  ${w.day}  ${w.weight.toFixed(1)} kg${recent[i + 1] ? `  ${signed(w.weight - recent[i + 1]!.weight)}` : ''}`).join('\n'));
  } else out.push('Weight: no weigh-ins in the last 90 days.');

  const logged = v.week.filter((d) => d.items > 0);
  out.push('', `Last 7 days${logged.length ? `: ${kcal(logged.reduce((s, d) => s + d.calories, 0) / logged.length)} a day on average over ${logged.length} day(s) logged` : ': nothing logged'}`);
  out.push(v.week.map((d) => `  ${d.day}  ${d.items ? `${kcal(d.calories).padStart(11)}  ${g(d.protein)} protein` : '          -'}`).join('\n'));
  return out.join('\n');
}

function health(args: string[]): number {
  if (args[0] === 'target' || args[0] === 'targets') return target(args.slice(1));
  const { flags, rest } = options(args, [], ['json']);
  const journal = openJournal();
  try {
    const view = buildHealth(journal, parseDay(rest[0]));
    console.log(flags.has('json') ? JSON.stringify(view, null, 2) : healthText(view));
    return 0;
  } finally {
    journal.close();
  }
}

function target(args: string[]): number {
  const { values } = options(args, ['kcal', 'protein']);
  const journal = openJournal();
  try {
    const current = readTargets(journal);
    const kcalValue = number(values['kcal'], 'kcal');
    const proteinValue = number(values['protein'], 'protein');
    for (const [name, v] of [['kcal', kcalValue], ['protein', proteinValue]] as const) {
      if (typeof v === 'number' && v <= 0) throw new UsageError(`--${name} must be above 0, or none`);
    }
    const next = { calories: kcalValue === undefined ? current.calories : kcalValue, protein: proteinValue === undefined ? current.protein : proteinValue };
    if (kcalValue !== undefined || proteinValue !== undefined) journal.set('health.targets', next);
    console.log(`Daily targets: ${next.calories ? kcal(next.calories) : 'no calorie target'} · ${next.protein ? `${next.protein} g protein` : 'no protein target'}`);
    return 0;
  } finally {
    journal.close();
  }
}

function food(args: string[]): number {
  const [action, ...rest] = args;
  const journal = openJournal();
  try {
    if (action === 'add') {
      const { values, rest: words } = options(rest, ['meal', 'kcal', 'protein', 'carbs', 'fat', 'date']);
      const name = words.join(' ').trim();
      if (!name) throw new UsageError('Usage: raqib food add "what you ate" [--meal lunch] [--kcal 650] [--protein 40] [--carbs 70] [--fat 18] [--date D]');
      const meal = values['meal']?.toLowerCase().replace(/s$/, '') ?? mealForHour(new Date().getHours());
      if (!MEALS.includes(meal as Meal)) throw new UsageError(`--meal is one of ${MEALS.join(', ')}`);
      const entry = checked(() =>
        foodBody({ day: parseDay(values['date']), meal, name, calories: number(values['kcal'], 'kcal'), protein: number(values['protein'], 'protein'), carbs: number(values['carbs'], 'carbs'), fat: number(values['fat'], 'fat') }),
      );
      const added = journal.addFood(entry);
      const day = journal.foods(entry.day).reduce((s, f) => s + (f.calories ?? 0), 0);
      console.log(`Logged for ${entry.day}:\n${foodLine(added)}\nThat day so far: ${ofTarget(day, readTargets(journal).calories, kcal)}`);
      return 0;
    }
    if (action === 'rm') {
      const ok = journal.deleteFood(id(rest[0]));
      console.log(ok ? `Removed food #${rest[0]}.` : `There is no food #${rest[0]}.`);
      return ok ? 0 : 1;
    }
    throw new UsageError('Usage: raqib food add "what you ate" [...] | food rm <id>');
  } finally {
    journal.close();
  }
}

function weigh(args: string[]): number {
  const { values, rest } = options(args, ['bodyfat', 'waist', 'date']);
  const key = parseDay(values['date']);
  const journal = openJournal();
  try {
    if (rest[0] === 'rm') {
      const ok = journal.deleteWeighIn(key);
      console.log(ok ? `Removed the weigh-in for ${key}.` : `There is no weigh-in for ${key}.`);
      return ok ? 0 : 1;
    }
    if (rest[0] === undefined) throw new UsageError('Usage: raqib weigh 81.2 [--bodyfat 21.5] [--waist 90] [--date D]');
    // Weighing again keeps that day's other measurements unless they're given (none clears one).
    const existing = journal.weighIns(key, key)[0];
    const bodyFat = number(values['bodyfat'], 'bodyfat');
    const waist = number(values['waist'], 'waist');
    const w = checked(() =>
      weighInBody(key, { weight: number(rest[0], 'weight'), bodyFat: bodyFat === undefined ? existing?.bodyFat : bodyFat, waist: waist === undefined ? existing?.waist : waist }),
    );
    const replaced = existing !== undefined;
    journal.setWeighIn(w);
    const before = journal.weighIns('0000-01-01', key).filter((x) => x.day < key).at(-1);
    console.log(`${replaced ? 'Updated' : 'Saved'} the weigh-in for ${key}: ${w.weight.toFixed(1)} kg${w.bodyFat !== null ? ` · body fat ${w.bodyFat}%` : ''}${w.waist !== null ? ` · waist ${w.waist} cm` : ''}${before ? ` (${signed(w.weight - before.weight)} since ${before.day})` : ''}`);
    return 0;
  } finally {
    journal.close();
  }
}

export const HEALTH_COMMANDS: Record<string, (args: string[]) => number> = { health, food, weigh };
