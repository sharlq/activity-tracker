// Sets written the short way, as people say them: "3x8@60" is three sets of 8 at 60 kg.
// Shared by the command line and the window, so both read sets the same way.
import type { NewSet } from './journal.ts';

export const LB_TO_KG = 0.45359237;

export class SetSpecError extends Error {}

const TOKEN = /^(?:(\d{1,3})\s*[x×*])?(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)(s|sec|min|m|km)?(?:@(bw|\d+(?:\.\d+)?)(kg|lbs?)?)?$/i;

/**
 * Reads sets: "3x8@60", "8@62.5", "8/8/6@60" (one set each), "3x10" or "3x10@bw"
 * (bodyweight), "135lb" weights, "3x30s" (timed), "5km" or "4x400m" (distance).
 * Several can follow each other: "3x8@60 1x6@65". `lb` makes plain weights pounds.
 */
export function parseSets(spec: string, { lb = false } = {}): NewSet[] {
  const tokens = spec
    .trim()
    .toLowerCase()
    .replace(/\s*([x×*@])\s*/g, '$1')
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (!tokens.length) throw new SetSpecError('Write the sets, like 3x8@60');
  const sets: NewSet[] = [];
  for (const token of tokens) {
    const m = TOKEN.exec(token);
    if (!m) throw new SetSpecError(`"${token}" isn't a set like 3x8@60, 8@62.5, 3x10, 3x30s, or 5km`);
    const [, times, amounts, unit, weightText, weightUnit] = m;
    const count = times ? Number(times) : 1;
    if (count < 1 || count > 50) throw new SetSpecError(`"${token}": between 1 and 50 sets`);
    let weight: number | null = null;
    if (weightText && weightText !== 'bw') {
      weight = Number(weightText);
      if (weightUnit?.startsWith('lb') || (!weightUnit && lb)) weight = Math.round(weight * LB_TO_KG * 10) / 10;
      if (weight > 1000) throw new SetSpecError(`"${token}": that weight looks too heavy`);
    }
    for (const text of (amounts as string).split('/')) {
      const n = Number(text);
      const set: NewSet = { reps: null, weight, rpe: null, seconds: null, distance: null };
      if (!unit) {
        if (!Number.isInteger(n) || n > 1000) throw new SetSpecError(`"${token}": reps are a whole number`);
        set.reps = n;
      } else if (unit === 's' || unit === 'sec') set.seconds = n;
      else if (unit === 'min') set.seconds = n * 60;
      else if (unit === 'm') set.distance = n;
      else set.distance = n * 1000;
      for (let i = 0; i < count; i++) sets.push({ ...set });
    }
  }
  return sets;
}

const num = (n: number) => String(Math.round(n * 10) / 10);

/** What one set was, without its weight: "8", "30 s", "400 m". */
function amountOf(s: NewSet): string {
  return s.reps !== null ? String(s.reps) : s.seconds !== null ? (s.seconds >= 120 && s.seconds % 60 === 0 ? `${s.seconds / 60} min` : `${num(s.seconds)} s`) : s.distance !== null ? (s.distance >= 1000 ? `${num(s.distance / 1000)} km` : `${num(s.distance)} m`) : '?';
}

const same = (a: NewSet, b: NewSet) => a.reps === b.reps && a.weight === b.weight && a.seconds === b.seconds && a.distance === b.distance;

/** Runs of the same set: [[3, set], [1, set]]. */
function runs(sets: readonly NewSet[]): [number, NewSet][] {
  const out: [number, NewSet][] = [];
  for (const s of sets) {
    const last = out.at(-1);
    if (last && same(last[1], s)) last[0]++;
    else out.push([1, s]);
  }
  return out;
}

/** Sets as a gym writes them: "3×8 @ 60 kg, 1×6 @ 62.5 kg", "3×10", "3×45 s". */
export function setsText(sets: readonly NewSet[]): string {
  return runs(sets).map(([n, s]) => `${n}×${amountOf(s)}${s.weight !== null ? ` @ ${num(s.weight)} kg` : ''}`).join(', ');
}

/** The same sets written back the short way, to log them again: "3x8@60 6@62.5". */
export function setsSpec(sets: readonly NewSet[]): string {
  return runs(sets)
    .map(([n, s]) => {
      const what = s.reps !== null ? String(s.reps) : s.seconds !== null ? `${num(s.seconds)}s` : s.distance !== null ? `${num(s.distance)}m` : '';
      return `${n > 1 ? `${n}x` : ''}${what}${s.weight !== null ? `@${num(s.weight)}` : ''}`;
    })
    .filter(Boolean)
    .join(' ');
}

/** Reps × kg over the sets that have both. */
export const volumeOf = (sets: readonly NewSet[]) => sets.reduce((v, s) => v + (s.reps ?? 0) * (s.weight ?? 0), 0);
