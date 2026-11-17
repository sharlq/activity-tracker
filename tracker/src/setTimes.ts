// Time between logging sets: when you tapped "Log set" for one, then the next, in the same
// workout (whatever the exercise). It's the rest plus the set itself, measured from the
// taps, so it's right even when the rest timer was skipped or missed.

/** Seconds since the set logged before it in the workout, by set; null for the first, or without a time. */
export function gapsBetweenSets<T extends { num: number; at: number | null }>(sets: readonly T[]): Map<number, number | null> {
  const timed = sets.filter((s): s is T & { at: number } => typeof s.at === 'number').sort((a, b) => a.at - b.at || a.num - b.num);
  const out = new Map<number, number | null>(sets.map((s) => [s.num, null]));
  for (let i = 1; i < timed.length; i++) out.set((timed[i] as T).num, Math.round(((timed[i] as T & { at: number }).at - (timed[i - 1] as T & { at: number }).at) / 1000));
  return out;
}

/** The average of the gaps there are, in whole seconds; null with none. */
export function averageGap(gaps: readonly (number | null)[]): number | null {
  const list = gaps.filter((g): g is number => g !== null);
  return list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;
}
