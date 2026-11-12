// The gaps in a day: stretches with no active PC use that you haven't logged yet.
// Pure functions: no files, no clock.
import type { Segment } from './report.ts';

export interface Interval {
  start: number;
  end: number;
}

export interface Gap extends Interval {
  ms: number;
  /** 'idle': the PC was on but untouched for most of it. 'away': off, asleep, or locked. */
  kind: 'idle' | 'away';
  /** What was on screen while idle, if anything was. */
  onScreen: string | null;
}

/** Sorted, non-overlapping union of the intervals. */
export function union(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).toSorted((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const { start, end } of sorted) {
    const last = merged.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else merged.push({ start, end });
  }
  return merged;
}

/** [from, to) minus the intervals. */
export function complement(intervals: readonly Interval[], from: number, to: number): Interval[] {
  const free: Interval[] = [];
  let cursor = from;
  for (const { start, end } of union(intervals)) {
    if (end <= cursor) continue;
    if (start >= to) break;
    if (start > cursor) free.push({ start: cursor, end: Math.min(start, to) });
    cursor = Math.max(cursor, end);
  }
  if (cursor < to) free.push({ start: cursor, end: to });
  return free;
}

const overlap = (a: Interval, b: Interval) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * Stretches of at least `minGapMs` inside [from, to) with no active PC use,
 * minus anything you've already logged. Idle time counts as a gap: the PC
 * can't tell reading from being away, so it asks.
 */
export function findGaps(
  segments: readonly Segment[],
  logged: readonly Interval[],
  from: number,
  to: number,
  minGapMs: number,
): Gap[] {
  const active = segments.filter((s) => s.category !== 'idle');
  const idle = segments.filter((s) => s.category === 'idle');
  const open = complement([...active, ...logged], from, to);

  return open
    .filter((gap) => gap.end - gap.start >= minGapMs)
    .map((gap) => {
      const ms = gap.end - gap.start;
      const idleMs = idle.reduce((sum, s) => sum + overlap(s, gap), 0);
      const onScreen = new Map<string, number>();
      for (const s of idle) {
        const o = overlap(s, gap);
        if (o > 0 && s.detail !== 'idle') onScreen.set(s.detail, (onScreen.get(s.detail) ?? 0) + o);
      }
      const top = [...onScreen].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const kind = idleMs * 2 >= ms ? ('idle' as const) : ('away' as const);
      return { ...gap, ms, kind, onScreen: kind === 'idle' ? top : null } satisfies Gap;
    });
}
