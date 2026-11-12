// Turns stored events into report figures. Pure functions: no files, no clock.
import type { StoredEvent } from '../store.ts';
import { classifyGaming } from '../gaming.ts';
import type { Category, CategoryConfig } from './categories.ts';
import { categorize, detailOf } from './categories.ts';

const MINUTE = 60_000;
/** Timeline blocks shorter than this are folded into their neighbours. */
export const SHORT_INTERRUPTION_MS = MINUTE;
/** Blocks closer together than this count as touching. */
const TOUCHING_MS = MINUTE;
/** Playing the same game again within this long continues the same session. */
const SAME_GAME_SESSION_MS = 5 * MINUTE;

export interface Segment {
  start: number;
  end: number;
  category: Category;
  /** Project, game, site, or app: the most specific name available. */
  detail: string;
  app: string | null;
  domain: string | null;
  game: string | null;
}

export interface Block {
  start: number;
  end: number;
  category: Category;
  /** The detail that took the most time in this block. */
  detail: string;
}

export interface Ranked {
  name: string;
  ms: number;
}

export interface CategoryTotal {
  category: Category;
  ms: number;
  share: number;
}

export interface GamingSession {
  game: string;
  start: number;
  end: number;
  ms: number;
}

export interface Stretch {
  start: number;
  end: number;
  ms: number;
}

export function toSegments(events: readonly StoredEvent[], config: CategoryConfig, games: string[]): Segment[] {
  return events
    .filter((event) => event.end > event.start)
    .map(({ start, end, activity }) => {
      const game = activity.kind === 'window' ? classifyGaming(activity, games) : null;
      return {
        start,
        end,
        category: categorize(activity, config, games),
        detail: detailOf(activity, games),
        app: activity.kind === 'window' ? activity.processName.replace(/\.exe$/i, '') : null,
        domain: activity.kind === 'window' ? (activity.domain ?? null) : null,
        game: game?.category === 'gaming' ? game.gameName : null,
      };
    });
}

const length = (x: { start: number; end: number }) => x.end - x.start;

export function totals(segments: readonly Segment[]): CategoryTotal[] {
  const byCategory = new Map<Category, number>();
  for (const s of segments) byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + length(s));
  const all = [...byCategory.values()].reduce((a, b) => a + b, 0);
  return [...byCategory]
    .map(([category, ms]) => ({ category, ms, share: all === 0 ? 0 : ms / all }))
    .sort((a, b) => b.ms - a.ms);
}

export function top(segments: readonly Segment[], key: 'app' | 'domain', count = 10): Ranked[] {
  const byName = new Map<string, number>();
  for (const s of segments) {
    const name = s[key];
    if (name && s.category !== 'idle') byName.set(name, (byName.get(name) ?? 0) + length(s));
  }
  return [...byName].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms).slice(0, count);
}

export function gamingSessions(segments: readonly Segment[]): GamingSession[] {
  const sessions: GamingSession[] = [];
  for (const s of segments) {
    if (s.category !== 'gaming') continue;
    const game = s.game ?? s.detail;
    const last = sessions.findLast((g) => g.game === game);
    if (last && s.start - last.end <= SAME_GAME_SESSION_MS) {
      last.end = s.end;
      last.ms += length(s);
    } else {
      sessions.push({ game, start: s.start, end: s.end, ms: length(s) });
    }
  }
  return sessions;
}

/** Working copy of a block while merging, with time per detail. */
interface Building {
  start: number;
  end: number;
  category: Category;
  details: Map<string, number>;
}

const touching = (a: { end: number }, b: { start: number }) => b.start - a.end < TOUCHING_MS;

const mainDetail = (block: Building) => [...block.details].sort((a, b) => b[1] - a[1])[0]?.[0];

/**
 * Idle blocks join only when the same thing was on screen: for idle time, what
 * you were looking at is the whole point of the label.
 */
function joinable(a: Building, b: Building): boolean {
  if (a.category !== b.category) return false;
  return a.category !== 'idle' || mainDetail(a) === mainDetail(b);
}

function joinSameCategory(blocks: Building[]): Building[] {
  const joined: Building[] = [];
  for (const block of blocks) {
    const last = joined.at(-1);
    if (last && joinable(last, block) && touching(last, block)) {
      last.end = Math.max(last.end, block.end);
      for (const [detail, ms] of block.details) last.details.set(detail, (last.details.get(detail) ?? 0) + ms);
    } else {
      joined.push({ ...block, details: new Map(block.details) });
    }
  }
  return joined;
}

/**
 * The day as blocks of one category each. Interruptions under a minute are
 * folded in: a 30-second YouTube glance in the middle of work stays one work
 * block. Gaps of a minute or more (locked, asleep, excluded) split blocks.
 */
export function timeline(segments: readonly Segment[]): Block[] {
  let blocks = joinSameCategory(
    segments.map((s) => ({ start: s.start, end: s.end, category: s.category, details: new Map([[s.detail, length(s)]]) })),
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i] as Building;
      if (length(block) >= SHORT_INTERRUPTION_MS) continue;
      const prev = i > 0 && touching(blocks[i - 1] as Building, block) ? (blocks[i - 1] as Building) : null;
      const next = i < blocks.length - 1 && touching(block, blocks[i + 1] as Building) ? (blocks[i + 1] as Building) : null;
      if (!prev && !next) continue; // Isolated: nothing to fold it into.

      if (prev && next && prev.category === next.category) {
        prev.end = block.end;
      } else if (prev && (!next || length(prev) >= length(next))) {
        prev.end = block.end;
      } else if (next) {
        next.start = block.start;
      }
      blocks.splice(i, 1);
      blocks = joinSameCategory(blocks);
      changed = true;
      break;
    }
  }

  return blocks.map(({ start, end, category, details }) => ({
    start,
    end,
    category,
    detail: [...details].sort((a, b) => b[1] - a[1])[0]?.[0] ?? category,
  }));
}

type Kind = 'focus' | 'distraction' | null;

function kindOf(category: Category, config: CategoryConfig): Kind {
  if (config.focus.includes(category)) return 'focus';
  if (config.distraction.includes(category)) return 'distraction';
  return null;
}

/**
 * Jumps between focus and distraction, counted on the raw data so even brief
 * glances count. Neutral time (messaging, other, idle) doesn't break a run:
 * work, then messages, then work again is not a switch.
 */
export function switches(segments: readonly Segment[], config: CategoryConfig): number {
  let count = 0;
  let current: Kind = null;
  for (const s of segments) {
    const kind = kindOf(s.category, config);
    if (kind === null) continue;
    if (current !== null && kind !== current) count++;
    current = kind;
  }
  return count;
}

/** The longest run of touching focus blocks in the timeline. */
export function longestFocus(blocks: readonly Block[], config: CategoryConfig): Stretch | null {
  let best: Stretch | null = null;
  let run: Stretch | null = null;
  for (const block of blocks) {
    if (kindOf(block.category, config) !== 'focus') {
      run = null;
      continue;
    }
    run = run && touching(run, block) ? { start: run.start, end: block.end, ms: block.end - run.start } : { start: block.start, end: block.end, ms: length(block) };
    if (!best || run.ms > best.ms) best = run;
  }
  return best;
}
