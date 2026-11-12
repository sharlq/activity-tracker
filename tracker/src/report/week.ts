// The weekly review: a week's days side by side, averages, and a few plain
// observations. Pure functions over per-day figures.
import type { Sleep } from './sleep.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A night shorter than this counts as short sleep. */
export const SHORT_NIGHT_MS = 6.5 * HOUR;

export interface DayFigures {
  date: string;
  /** False for days still to come. */
  past: boolean;
  activeMs: number;
  focusMs: number;
  /** PC distraction plus distraction you logged off the PC (the phone). */
  distractionMs: number;
  /** Phone time you logged. 0 on days you didn't log any. */
  phoneMs: number;
  sleep: Sleep;
  /** The day's check-ins averaged, 1 to 5, or null. */
  mood: number | null;
  energy: number | null;
  tasksDone: number;
  tasksTotal: number;
  goalsMet: number;
  goalsPartly: number;
  goalsTotal: number;
  /** Time still unlogged. */
  gapMs: number;
  focusByHour: number[];
}

export interface Average {
  value: number;
  /** How many days it's over. */
  days: number;
}

export interface WeekTotals {
  activeMs: Average | null;
  focusMs: Average | null;
  distractionMs: Average | null;
  /** Over the days you logged phone time. */
  phoneMs: Average | null;
  sleepMs: Average | null;
  mood: Average | null;
  energy: Average | null;
  /** Bedtime as minutes after midnight (can be negative: -60 is 23:00), and the spread. */
  bedtime: { minutes: number; spread: number } | null;
  wake: { minutes: number; spread: number } | null;
  tasksDone: number;
  tasksTotal: number;
  goalsMet: number;
  goalsPartly: number;
  goalsTotal: number;
  gapMs: number;
}

const average = (values: number[]): Average | null =>
  values.length === 0 ? null : { value: values.reduce((a, b) => a + b, 0) / values.length, days: values.length };

function spreadOf(values: number[]): { minutes: number; spread: number } | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { minutes: Math.round(mean), spread: Math.round(Math.sqrt(variance)) };
}

/** Minutes after the local midnight of `dayStart`. */
function minutesAfter(ms: number, dayStart: number): number {
  return Math.round((ms - dayStart) / MINUTE);
}

/** `dayStarts[i]` is the local midnight of `days[i]`. */
export function weekTotals(days: readonly DayFigures[], dayStarts: readonly number[]): WeekTotals {
  const past = days.filter((d) => d.past);
  const used = past.filter((d) => d.activeMs > 0);
  const nights = days.map((d, i) => ({ night: d.sleep.night, start: dayStarts[i] as number })).filter((n) => n.night !== null);
  const sum = (pick: (d: DayFigures) => number) => past.reduce((s, d) => s + pick(d), 0);
  return {
    activeMs: average(used.map((d) => d.activeMs)),
    focusMs: average(used.map((d) => d.focusMs)),
    distractionMs: average(used.map((d) => d.distractionMs)),
    // Only days you logged the phone: a day without an answer isn't a day without the phone.
    phoneMs: average(past.filter((d) => d.phoneMs > 0).map((d) => d.phoneMs)),
    sleepMs: average(days.filter((d) => d.sleep.night !== null).map((d) => d.sleep.totalMs)),
    mood: average(past.flatMap((d) => (d.mood === null ? [] : [d.mood]))),
    energy: average(past.flatMap((d) => (d.energy === null ? [] : [d.energy]))),
    bedtime: spreadOf(nights.map((n) => minutesAfter(n.night!.start, n.start))),
    wake: spreadOf(nights.map((n) => minutesAfter(n.night!.end, n.start))),
    tasksDone: sum((d) => d.tasksDone),
    tasksTotal: sum((d) => d.tasksTotal),
    goalsMet: sum((d) => d.goalsMet),
    goalsPartly: sum((d) => d.goalsPartly),
    goalsTotal: sum((d) => d.goalsTotal),
    // Days the PC wasn't used at all (before رقيب, or away) would count whole.
    gapMs: used.reduce((s, d) => s + d.gapMs, 0),
  };
}

function duration(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  const h = Math.floor(minutes / 60);
  return h === 0 ? `${minutes}m` : `${h}h${String(minutes % 60).padStart(2, '0')}m`;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Minutes after midnight as a clock time; negative is the evening before. */
export function clockOf(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

const weekday = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long' });
};

/** Compares two groups of days only when each has at least this many. */
const MIN_GROUP = 2;

/** A few plain sentences about the week. Only says what the figures clearly support. */
export function observations(days: readonly DayFigures[], totals: WeekTotals): string[] {
  const out: string[] = [];
  const used = days.filter((d) => d.past && d.activeMs > 0);

  const best = used.toSorted((a, b) => b.focusMs - a.focusMs)[0];
  if (best && best.focusMs >= 30 * MINUTE) out.push(`Your most focused day was ${weekday(best.date)}, with ${duration(best.focusMs)}.`);

  // The best two-hour stretch of the day for focus, across the week.
  const byHour = Array.from({ length: 24 }, (_, h) => used.reduce((s, d) => s + (d.focusByHour[h] ?? 0), 0));
  let peak = -1;
  let peakMs = 0;
  for (let h = 0; h < 23; h++) {
    const ms = (byHour[h] ?? 0) + (byHour[h + 1] ?? 0);
    if (ms > peakMs) [peak, peakMs] = [h, ms];
  }
  if (peak >= 0 && peakMs >= HOUR) out.push(`You focused most between ${pad(peak)}:00 and ${pad(peak + 2)}:00 (${duration(peakMs)} over the week).`);

  // The phone, set against focus: the PC alone can't see it.
  if (totals.phoneMs && totals.phoneMs.value >= 30 * MINUTE) {
    const days = totals.phoneMs.days;
    const versus = totals.focusMs ? `, against ${duration(totals.focusMs.value)} focused at the PC` : '';
    out.push(`You logged ${duration(totals.phoneMs.value)} a day on your phone (${days} day${days === 1 ? '' : 's'} logged)${versus}.`);
  }

  // Sleep and the next day's focus.
  const slept = used.filter((d) => d.sleep.night !== null);
  const short = slept.filter((d) => d.sleep.totalMs < SHORT_NIGHT_MS);
  const long = slept.filter((d) => d.sleep.totalMs >= SHORT_NIGHT_MS);
  if (short.length >= MIN_GROUP && long.length >= MIN_GROUP) {
    const avg = (list: DayFigures[]) => list.reduce((s, d) => s + d.focusMs, 0) / list.length;
    out.push(`After nights under ${duration(SHORT_NIGHT_MS)} you focused ${duration(avg(short))} a day on average, against ${duration(avg(long))} after longer nights.`);
  }

  // Mood and distractions.
  const low = used.filter((d) => d.mood !== null && d.mood <= 2);
  const high = used.filter((d) => d.mood !== null && d.mood >= 4);
  if (low.length >= MIN_GROUP && high.length >= MIN_GROUP) {
    const avg = (list: DayFigures[]) => list.reduce((s, d) => s + d.distractionMs, 0) / list.length;
    out.push(`On low-mood days you spent ${duration(avg(low))} on distractions, against ${duration(avg(high))} on good days.`);
  }

  const late = days.filter((d) => {
    const hour = d.sleep.night ? new Date(d.sleep.night.start).getHours() : -1;
    return hour >= 1 && hour < 12;
  }).length;
  if (late >= 2) out.push(`You went to bed after 01:00 on ${late} nights.`);
  if (totals.bedtime && totals.bedtime.spread >= 60) out.push(`Your bedtime moved around a lot (±${duration(totals.bedtime.spread * MINUTE)}); a steadier bedtime usually helps sleep.`);

  if (totals.goalsTotal > 0) {
    out.push(`You met ${totals.goalsMet} of ${totals.goalsTotal} goals${totals.goalsPartly ? `, and partly met ${totals.goalsPartly}` : ''}.`);
  }
  if (totals.gapMs >= HOUR) out.push(`${duration(totals.gapMs)} of the week is still unlogged.`);
  return out;
}

/** The Monday of the week holding this local date (YYYY-MM-DD in, YYYY-MM-DD out). */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(y, m - 1, d);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.toLocaleDateString('en-CA');
}
