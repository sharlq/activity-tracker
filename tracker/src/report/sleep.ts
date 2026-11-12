// How long you slept: from what you logged as sleep, or failing that, estimated
// from the longest night-time stretch without PC use. Pure functions.
import type { Interval } from './gaps.ts';
import { complement, union } from './gaps.ts';

const HOUR = 3600_000;
/** Logged sleep entries this close together are one night (the evening log splits at midnight). */
const SAME_SLEEP_MS = 30 * 60_000;
/** Shorter than this, it's not a night's sleep. */
const MIN_NIGHT_MS = 2 * HOUR;
/** An estimate needs a longer stretch, since a quiet evening isn't sleep. */
const MIN_ESTIMATE_MS = 3 * HOUR;
/** Longer than this, the stretch probably holds a morning out too, so it's no estimate of sleep. */
const MAX_ESTIMATE_MS = 11 * HOUR;

export interface Night {
  /** Bedtime and waking time. */
  start: number;
  end: number;
  /** Time asleep. For logged sleep, entries in the night added up; for an estimate, end minus start. */
  ms: number;
  /** 'logged': from your sleep entries. 'estimated': from when the PC was last and first used. */
  source: 'logged' | 'estimated';
}

export interface Sleep {
  /** The sleep you woke from on this day, if known. */
  night: Night | null;
  /** Other sleep logged during the day, before 20:00. */
  naps: Interval[];
  napMs: number;
  totalMs: number;
}

/** The hours the night ending on this day may fall in: 18:00 the evening before to 14:00. */
export function nightWindow(dayStart: number): Interval {
  const d = new Date(dayStart);
  return {
    start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 18).getTime(),
    end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 14).getTime(),
  };
}

interface Logged extends Interval {
  category: string | null;
}

const length = (i: Interval) => i.end - i.start;

/** Groups intervals that touch or nearly touch. */
function clusters(intervals: readonly Interval[]): Interval[][] {
  const groups: Interval[][] = [];
  for (const interval of intervals.toSorted((a, b) => a.start - b.start)) {
    const group = groups.at(-1);
    const end = group ? Math.max(...group.map((i) => i.end)) : -Infinity;
    if (group && interval.start - end <= SAME_SLEEP_MS) group.push(interval);
    else groups.push([interval]);
  }
  return groups;
}

/**
 * Sleep for the day starting at `dayStart`.
 * `entries`: what you logged around it (any categories). `active`: stretches of active PC use.
 * Nothing after `now` is assumed: a stretch still going on isn't a finished night.
 */
export function sleepFor(dayStart: number, entries: readonly Logged[], active: readonly Interval[], now: number): Sleep {
  const window = nightWindow(dayStart);
  const d = new Date(dayStart);
  const napsUntil = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 20).getTime();
  const sleeps = entries.filter((e) => e.category === 'sleep' && e.end > e.start);

  let night: Night | null = null;
  const nightGroup = clusters(sleeps.filter((e) => e.end > window.start && e.start < window.end))
    .filter((group) => Math.max(...group.map((i) => i.end)) > dayStart)
    .map((group) => ({ group, ms: union(group).reduce((s, i) => s + length(i), 0) }))
    .filter((g) => g.ms >= MIN_NIGHT_MS)
    .sort((a, b) => b.ms - a.ms)[0];
  if (nightGroup) {
    night = {
      start: Math.min(...nightGroup.group.map((i) => i.start)),
      end: Math.max(...nightGroup.group.map((i) => i.end)),
      ms: nightGroup.ms,
      source: 'logged',
    };
  } else {
    // Busy time: PC use, and anything you logged that wasn't sleep.
    const until = Math.min(window.end, now);
    const busy = [...active, ...entries.filter((e) => e.category !== 'sleep')];
    const best = complement(busy, window.start, until)
      // Touching an edge means the real bedtime or waking time is outside what we can see.
      .filter((free) => free.start > window.start && free.end < until && free.end > dayStart && length(free) >= MIN_ESTIMATE_MS)
      .sort((a, b) => length(b) - length(a))[0];
    if (best && length(best) <= MAX_ESTIMATE_MS) night = { ...best, ms: length(best), source: 'estimated' };
  }

  const inNight = (e: Interval) => night !== null && night.source === 'logged' && e.start >= night.start && e.end <= night.end;
  const naps = union(sleeps.filter((e) => e.start >= dayStart && e.start < napsUntil && !inNight(e)));
  const napMs = naps.reduce((s, n) => s + length(n), 0);
  return { night, naps, napMs, totalMs: (night?.ms ?? 0) + napMs };
}
