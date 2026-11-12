// The other screens: what was on top of the screens without the focus, against
// what you were doing on the focused one. Pure functions: no files, no clock.
//
// Names and categories come from the same rules as the main timeline, so notes
// in Word on screen 2 read the same as notes in Word in front.
import type { ScreenEvent } from '../journal.ts';
import type { Category, CategoryConfig } from './categories.ts';
import { categorize, detailOf } from './categories.ts';
import type { Segment } from './report.ts';

/** Windows that were up for less than this (passing through while rearranging) don't count. */
export const MIN_VISIBLE_MS = 30_000;
/** The same window again within this long continues the same stretch. */
const SAME_WINDOW_MS = 60_000;

export interface VisibleItem {
  name: string;
  category: Category;
  ms: number;
  /** The window title shown longest, if any. */
  title: string | null;
}

export interface ScreenSummary {
  screen: number;
  /** Time with something recorded on this screen. */
  ms: number;
  top: VisibleItem[];
}

export interface Alongside {
  /** What had the focus. */
  doing: string;
  category: Category;
  /** What was on another screen at the same time. */
  visible: string;
  visibleCategory: Category;
  ms: number;
}

export interface VisibleStretch {
  start: number;
  end: number;
  screen: number;
  name: string;
  category: Category;
  title: string | null;
}

export interface OtherScreens {
  /** How many screens had anything recorded. */
  screens: number;
  /** Stretches of one window on one screen, oldest first. Day reports only. */
  stretches: VisibleStretch[];
  /** What was on the other screens, overall, largest first. */
  top: VisibleItem[];
  byScreen: ScreenSummary[];
  /** What was on the other screens while the PC sat idle: maybe reading, maybe away. */
  whileIdle: VisibleItem[];
  /** What you were doing + what was up beside it, most common first. */
  pairs: Alongside[];
}

function named(event: ScreenEvent, categories: CategoryConfig, games: string[]): { name: string; category: Category } {
  const { processName, exePath, title, domain } = event.source;
  const activity = { kind: 'window' as const, processName, exePath, title: title ?? '', ...(domain ? { domain } : {}) };
  return { name: detailOf(activity, games), category: categorize(activity, categories, games) };
}

export function visibleStretches(events: readonly ScreenEvent[], categories: CategoryConfig, games: string[], minMs = MIN_VISIBLE_MS): VisibleStretch[] {
  type Building = VisibleStretch & { titles: Map<string, number> };
  const open = new Map<string, Building>();
  const done: Building[] = [];
  for (const event of events.toSorted((a, b) => a.start - b.start)) {
    if (event.end <= event.start) continue;
    const { name, category } = named(event, categories, games);
    const key = `${event.source.screen}\u0000${name}`;
    let stretch = open.get(key);
    if (!stretch || event.start - stretch.end > SAME_WINDOW_MS) {
      if (stretch) done.push(stretch);
      stretch = { start: event.start, end: event.end, screen: event.source.screen, name, category, title: null, titles: new Map() };
      open.set(key, stretch);
    }
    stretch.end = Math.max(stretch.end, event.end);
    const title = event.source.title;
    if (title) stretch.titles.set(title, (stretch.titles.get(title) ?? 0) + (event.end - event.start));
  }
  done.push(...open.values());
  return done
    .filter((s) => s.end - s.start >= minMs)
    .map(({ titles, ...s }) => ({ ...s, title: [...titles].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }))
    .sort((a, b) => a.start - b.start || a.screen - b.screen);
}

class Tally {
  private readonly items = new Map<string, { category: Category; ms: number; titles: Map<string, number> }>();

  add(name: string, category: Category, title: string | null, ms: number): void {
    const item = this.items.get(name) ?? { category, ms: 0, titles: new Map() };
    item.ms += ms;
    if (title) item.titles.set(title, (item.titles.get(title) ?? 0) + ms);
    this.items.set(name, item);
  }

  ranked(count = 10): VisibleItem[] {
    return [...this.items]
      .map(([name, i]) => ({ name, category: i.category, ms: i.ms, title: [...i.titles].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, count);
  }
}

export function otherScreens(
  segments: readonly Segment[],
  events: readonly ScreenEvent[],
  categories: CategoryConfig,
  games: string[],
  kind: 'day' | 'week',
): OtherScreens {
  const stretches = visibleStretches(events, categories, games);
  const top = new Tally();
  const whileIdle = new Tally();
  const perScreen = new Map<number, { ms: number; tally: Tally }>();
  const pairs = new Map<string, Alongside>();

  for (const s of stretches) {
    const ms = s.end - s.start;
    top.add(s.name, s.category, s.title, ms);
    const screen = perScreen.get(s.screen) ?? { ms: 0, tally: new Tally() };
    screen.ms += ms;
    screen.tally.add(s.name, s.category, s.title, ms);
    perScreen.set(s.screen, screen);

    for (const seg of segments) {
      const overlap = Math.min(s.end, seg.end) - Math.max(s.start, seg.start);
      if (overlap <= 0) continue;
      if (seg.category === 'idle') {
        whileIdle.add(s.name, s.category, s.title, overlap);
        continue;
      }
      // The same thing in front and beside it (two Word documents) isn't "alongside".
      if (seg.detail === s.name) continue;
      const key = `${seg.detail}\u0000${s.name}`;
      const pair = pairs.get(key) ?? { doing: seg.detail, category: seg.category, visible: s.name, visibleCategory: s.category, ms: 0 };
      pair.ms += overlap;
      pairs.set(key, pair);
    }
  }

  return {
    screens: perScreen.size,
    stretches: kind === 'day' ? stretches : [],
    top: top.ranked(),
    byScreen: [...perScreen].sort((a, b) => a[0] - b[0]).map(([screen, { ms, tally }]) => ({ screen, ms, top: tally.ranked(5) })),
    whileIdle: whileIdle.ranked(),
    pairs: [...pairs.values()].sort((a, b) => b.ms - a.ms).slice(0, 10),
  };
}
