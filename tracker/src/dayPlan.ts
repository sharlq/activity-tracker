// The day's plan held up against what happened. Pure, so every rule can be tested.
//
// For each planned block, what you did in its time comes from what you logged
// (it wins where it overlaps the PC: you know better than the screen) and then
// from what was on screen. Idle time with nothing logged is "unknown", not a miss
// on its own, but it doesn't count as kept either.
import type { Entry, PlanBlock } from './journal.ts';
import type { Segment } from './report/index.ts';

export type BlockStatus = 'kept' | 'partly' | 'missed' | 'now' | 'upcoming';

export interface BlockOutcome {
  block: PlanBlock;
  status: BlockStatus;
  /** Time in the block spent on what was planned. */
  keptMs: number;
  /** How much of the block has gone by. */
  elapsedMs: number;
  /** What filled the block, most time first, kept or not. */
  actual: { name: string; category: string | null; ms: number; kept: boolean }[];
  /** Gone by with nothing logged and nothing active on the PC. */
  unknownMs: number;
}

export interface PlanComparison {
  blocks: BlockOutcome[];
  plannedMs: number;
  /** Planned time that has gone by. */
  elapsedMs: number;
  keptMs: number;
  /** keptMs / elapsedMs, or null before any block has started. */
  share: number | null;
  kept: number;
  partly: number;
  missed: number;
}

/** A block counts as kept at this share of its time, and partly kept at the lower one. */
export const KEPT_SHARE = 0.6;
export const PARTLY_SHARE = 0.2;

/** Plan categories that are satisfied by more than their own name. */
function matches(planned: string, actual: string | null, focus: readonly string[]): boolean {
  if (actual === null) return false;
  if (planned === actual) return true;
  if (planned === 'focus') return focus.includes(actual) || actual === 'study';
  // Studying at the PC shows up as "learning"; logged away from it, as "study".
  const study = new Set(['study', 'learning']);
  return study.has(planned) && study.has(actual);
}

const sameText = (a: string, b: string) => {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
};

interface Piece {
  start: number;
  end: number;
  name: string;
  category: string | null;
}

/** Cuts `cut` out of each interval in `from`. Both lists are short, so this stays simple. */
function subtract(from: Piece[], cut: { start: number; end: number }[]): Piece[] {
  let out = from;
  for (const c of cut) {
    out = out.flatMap((p) => {
      if (c.end <= p.start || c.start >= p.end) return [p];
      const parts: Piece[] = [];
      if (c.start > p.start) parts.push({ ...p, end: c.start });
      if (c.end < p.end) parts.push({ ...p, start: c.end });
      return parts;
    });
  }
  return out;
}

const clip = (p: Piece, start: number, end: number): Piece | null => {
  const s = Math.max(p.start, start);
  const e = Math.min(p.end, end);
  return e > s ? { ...p, start: s, end: e } : null;
};

/** One block against the day's segments and entries, as of `now`. */
export function blockOutcome(block: PlanBlock, segments: readonly Segment[], entries: readonly Entry[], now: number, focus: readonly string[]): BlockOutcome {
  const end = Math.min(block.end, now);
  const elapsedMs = Math.max(0, end - block.start);
  if (elapsedMs === 0) return { block, status: 'upcoming', keptMs: 0, elapsedMs: 0, actual: [], unknownMs: 0 };

  const logged = entries.flatMap((e) => clip({ start: e.start, end: e.end, name: e.label, category: e.category }, block.start, end) ?? []);
  const screen = subtract(
    segments.filter((s) => s.category !== 'idle').flatMap((s) => clip({ start: s.start, end: s.end, name: s.detail, category: s.category }, block.start, end) ?? []),
    logged,
  );

  // Entries can overlap each other; count each moment once, first entry wins.
  const loggedOnce: Piece[] = [];
  for (const p of logged) loggedOnce.push(...subtract([p], loggedOnce));

  const byName = new Map<string, { name: string; category: string | null; ms: number; kept: boolean }>();
  let keptMs = 0;
  let knownMs = 0;
  for (const p of [...loggedOnce, ...screen]) {
    const ms = p.end - p.start;
    const kept = block.category !== null ? matches(block.category, p.category, focus) : sameText(block.label, p.name);
    if (kept) keptMs += ms;
    knownMs += ms;
    const key = `${p.category ?? ''}|${p.name}`;
    const item = byName.get(key) ?? { name: p.name, category: p.category, ms: 0, kept };
    item.ms += ms;
    byName.set(key, item);
  }

  const share = keptMs / elapsedMs;
  const status: BlockStatus = now < block.end ? 'now' : share >= KEPT_SHARE ? 'kept' : share >= PARTLY_SHARE ? 'partly' : 'missed';
  return {
    block,
    status,
    keptMs,
    elapsedMs,
    actual: [...byName.values()].sort((a, b) => b.ms - a.ms),
    unknownMs: Math.max(0, elapsedMs - knownMs),
  };
}

export function comparePlan(blocks: readonly PlanBlock[], segments: readonly Segment[], entries: readonly Entry[], now: number, focus: readonly string[]): PlanComparison {
  const outcomes = blocks.map((b) => blockOutcome(b, segments, entries, now, focus));
  const elapsedMs = outcomes.reduce((s, o) => s + o.elapsedMs, 0);
  const keptMs = outcomes.reduce((s, o) => s + o.keptMs, 0);
  return {
    blocks: outcomes,
    plannedMs: blocks.reduce((s, b) => s + (b.end - b.start), 0),
    elapsedMs,
    keptMs,
    share: elapsedMs > 0 ? keptMs / elapsedMs : null,
    kept: outcomes.filter((o) => o.status === 'kept').length,
    partly: outcomes.filter((o) => o.status === 'partly').length,
    missed: outcomes.filter((o) => o.status === 'missed').length,
  };
}
