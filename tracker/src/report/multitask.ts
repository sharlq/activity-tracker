// Multitasking: sound playing while you did something else, such as a podcast
// in the background while you worked. Pure functions: no files, no clock.
//
// Audio from the app that's in front isn't multitasking (a YouTube video you're
// watching), so that overlap is left out. For a browser it's the same app only
// if it's the same site: Docs in front with YouTube playing in another tab is.
//
// Phone use you logged ("Phone: Instagram", "On my phone") is multitasking too
// when it overlaps active PC use: scrolling while Claude works, say.
import type { AudioEvent, Entry } from '../journal.ts';
import type { Ranked, Segment } from './report.ts';

/** Snippets shorter than this (notification sounds, a short clip) aren't listening. */
export const MIN_LISTENING_MS = 30_000;
/** The same source again within this long continues the same block. */
const SAME_SOURCE_MS = 60_000;

export interface AudioBlock {
  start: number;
  end: number;
  /** Site for a browser tab, otherwise the app. */
  source: string;
  app: string;
  domain: string | null;
  /** The title that played longest in the block (track, episode, tab), if known. */
  title: string | null;
}

export interface Pairing {
  doing: string;
  category: string;
  listening: string;
  /** What was playing (the song, video, or call) for most of that time, if known. */
  listeningTitle?: string | null;
  ms: number;
}

/** A source of sound and what it played. */
export interface PlayedSource extends Ranked {
  /** The title that played longest (song, video, episode, call), if known. */
  title: string | null;
  /** What it played, longest first, up to five. */
  titles: Ranked[];
}

export interface Multitasking {
  blocks: AudioBlock[];
  /** Time with any sound playing. */
  listeningMs: number;
  /** Of that, time while you were actively doing something else at the PC. */
  whileActiveMs: number;
  /** While the PC was idle: listening and nothing else, as far as the PC knows. */
  whileIdleMs: number;
  bySource: PlayedSource[];
  /** Background listening by what you were doing, by category. */
  byActivity: Ranked[];
  /** The most common combinations. */
  pairs: Pairing[];
  /** Phone use you logged that overlapped the PC. */
  phone: PhoneMultitasking;
}

/** Logged phone time (entries whose label says "phone"), against the PC timeline. */
export interface PhoneMultitasking {
  /** Logged phone time, overlaps between entries counted once. */
  ms: number;
  /** Of that, time while you were actively using the PC: on the phone and working at once. */
  whileActiveMs: number;
  /** Of that, time while the PC was on but untouched. */
  whilePcIdleMs: number;
  /** Phone use while active at the PC, by what you were doing, by category. */
  byActivity: Ranked[];
  /** The most common combinations: what was on the PC + what was on the phone. */
  pairs: Pairing[];
}

/** An entry is phone use if its label says so ("On my phone", "Phone: Instagram"). */
export const isPhoneEntry = (e: Pick<Entry, 'label'>) => /\bphone\b|\bmobile\b|جوال|هاتف|موبايل/i.test(e.label);

/** "Phone: Instagram/TikTok" → "Instagram/TikTok"; "On my phone" → "Phone". */
function phoneName(label: string): string {
  const m = /^\s*(?:phone|mobile)\s*[:\-–]\s*(.+)$/i.exec(label);
  return m?.[1]?.trim() || 'Phone';
}

interface PhoneSpan { start: number; end: number; name: string }

/** Phone entries flattened so no moment counts twice; a named entry ("Phone: X") wins over a generic one. */
function phoneSpans(entries: readonly Entry[]): PhoneSpan[] {
  const spans = entries.filter(isPhoneEntry).filter((e) => e.end > e.start).map((e) => ({ start: e.start, end: e.end, name: phoneName(e.label) }));
  const cuts = [...new Set(spans.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
  const out: PhoneSpan[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [start, end] = [cuts[i]!, cuts[i + 1]!];
    const covering = spans.filter((s) => s.start <= start && s.end >= end);
    if (!covering.length) continue;
    const name = covering.find((s) => s.name !== 'Phone')?.name ?? 'Phone';
    const last = out.at(-1);
    if (last && last.end === start && last.name === name) last.end = end;
    else out.push({ start, end, name });
  }
  return out;
}

export function phoneMultitasking(segments: readonly Segment[], entries: readonly Entry[]): PhoneMultitasking {
  const spans = phoneSpans(entries);
  const byActivity = new Map<string, number>();
  const pairs = new Map<string, Pairing>();
  let whileActiveMs = 0;
  let whilePcIdleMs = 0;
  for (const span of spans) {
    for (const s of segments) {
      const ms = Math.min(span.end, s.end) - Math.max(span.start, s.start);
      if (ms <= 0) continue;
      if (s.category === 'idle') {
        whilePcIdleMs += ms;
        continue;
      }
      whileActiveMs += ms;
      byActivity.set(s.category, (byActivity.get(s.category) ?? 0) + ms);
      const key = `${s.detail}\u0000${span.name}`;
      const pair = pairs.get(key) ?? { doing: s.detail, category: s.category, listening: span.name, ms: 0 };
      pair.ms += ms;
      pairs.set(key, pair);
    }
  }
  return {
    ms: spans.reduce((sum, s) => sum + s.end - s.start, 0),
    whileActiveMs,
    whilePcIdleMs,
    byActivity: rank(byActivity),
    pairs: [...pairs.values()].sort((a, b) => b.ms - a.ms).slice(0, 10),
  };
}

/** Time you logged yourself that counts against your day: the phone above all. */
export interface LoggedDistraction {
  /** Logged time in a distraction category, minus moments the PC already counts as distraction. */
  ms: number;
  /** All logged phone time (any category), overlaps counted once. */
  phoneMs: number;
  /** Of the phone time, how much was in a distraction category. */
  phoneDistractionMs: number;
  /** What it was, by label ("Phone: Instagram/TikTok"), most time first. */
  byLabel: Ranked[];
}

type Span = { start: number; end: number };
const merged = (spans: readonly Span[]): Span[] => {
  const sorted = spans.filter((s) => s.end > s.start).toSorted((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
};
const total = (spans: readonly Span[]) => spans.reduce((s, x) => s + x.end - x.start, 0);
const overlapOf = (a: readonly Span[], b: readonly Span[]) => {
  let ms = 0;
  for (const x of a) for (const y of b) ms += Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start));
  return ms;
};

/**
 * The PC can't see the phone, so distraction time you log ("Phone: Instagram",
 * social media) is added to what it saw, inside [from, to). A moment counts once:
 * scrolling the phone while YouTube plays on the PC isn't two distractions.
 */
export function loggedDistraction(
  entries: readonly Entry[],
  segments: readonly Segment[],
  distraction: readonly string[],
  from: number,
  to: number,
): LoggedDistraction {
  const clip = (e: Span) => ({ start: Math.max(e.start, from), end: Math.min(e.end, to) });
  const distracting = entries.filter((e) => e.category !== null && distraction.includes(e.category));
  const logged = merged(distracting.map(clip));
  const pc = merged(segments.filter((s) => distraction.includes(s.category)));
  const phone = entries.filter(isPhoneEntry);
  const byLabel = new Map<string, number>();
  for (const e of distracting) {
    const c = clip(e);
    if (c.end > c.start) byLabel.set(e.label, (byLabel.get(e.label) ?? 0) + c.end - c.start);
  }
  return {
    ms: total(logged) - overlapOf(logged, pc),
    phoneMs: total(merged(phone.map(clip))),
    phoneDistractionMs: total(merged(phone.filter((e) => distracting.includes(e)).map(clip))),
    byLabel: rank(byLabel),
  };
}

const appName = (processName: string) => processName.replace(/\.exe$/i, '');

export function audioBlocks(events: readonly AudioEvent[], minMs = MIN_LISTENING_MS): AudioBlock[] {
  type Building = AudioBlock & { titles: Map<string, number> };
  const open = new Map<string, Building>();
  const done: Building[] = [];
  for (const event of events.toSorted((a, b) => a.start - b.start)) {
    if (event.end <= event.start) continue;
    const app = appName(event.source.processName);
    const source = event.source.domain ?? app;
    const key = `${app}\u0000${source}`;
    let block = open.get(key);
    if (!block || event.start - block.end > SAME_SOURCE_MS) {
      if (block) done.push(block);
      block = { start: event.start, end: event.end, source, app, domain: event.source.domain, title: null, titles: new Map() };
      open.set(key, block);
    }
    block.end = Math.max(block.end, event.end);
    const title = event.source.title;
    if (title) block.titles.set(title, (block.titles.get(title) ?? 0) + (event.end - event.start));
  }
  done.push(...open.values());
  return done
    .filter((b) => b.end - b.start >= minMs)
    .map(({ titles, ...block }) => ({ ...block, title: [...titles].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }))
    .sort((a, b) => a.start - b.start);
}

/** True if the sound is most likely coming from what's on screen. */
function sameThing(block: AudioBlock, segment: Segment): boolean {
  if (segment.app === null || segment.app.toLowerCase() !== block.app.toLowerCase()) return false;
  // A browser without tab details could be playing any tab: count it as the same.
  return block.domain === null || segment.domain === null || block.domain === segment.domain;
}

const rank = (map: Map<string, number>): Ranked[] =>
  [...map].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms);

function unionMs(blocks: readonly AudioBlock[]): number {
  let total = 0;
  let cursor = -Infinity;
  for (const b of blocks.toSorted((x, y) => x.start - y.start)) {
    const start = Math.max(b.start, cursor);
    if (b.end > start) total += b.end - start;
    cursor = Math.max(cursor, b.end);
  }
  return total;
}

/** Words a window title adds that say which app it is, not what's playing. */
const APP_SUFFIX = /\s+[-–|·]\s+(YouTube( Music)?|SoundCloud|Spotify|Netflix|Twitch|Google Chrome|Microsoft Teams|Discord|Anghami|Deezer)\s*$/i;
/** Titles that are just the app's name: nothing about what's playing. */
const JUST_THE_APP = /^(spotify( premium| free)?|youtube( music)?|discord|claude|whatsapp|microsoft teams|netflix|twitch)$/i;

/**
 * What a title says is playing, or null if it says nothing: "(3) Lofi beats - YouTube"
 * becomes "Lofi beats"; Spotify paused shows just "Spotify Premium", which is dropped.
 */
export function playingTitle(title: string | null, source: string): string | null {
  if (!title) return null;
  const cleaned = title.replace(/^\(\d+\+?\)\s*/, '').replace(APP_SUFFIX, '').trim();
  if (!cleaned || JUST_THE_APP.test(cleaned) || cleaned.toLowerCase() === source.toLowerCase()) return null;
  return cleaned;
}

/** Adds up, per title, how long this source's events overlapped [start, end). */
function titlesIn(byTitle: Map<string, number>, events: readonly AudioEvent[], block: AudioBlock, start: number, end: number): void {
  for (const e of events) {
    if (appName(e.source.processName) !== block.app || (e.source.domain ?? block.app) !== block.source) continue;
    const ms = Math.min(end, e.end) - Math.max(start, e.start);
    const title = playingTitle(e.source.title, block.source);
    if (ms > 0 && title) byTitle.set(title, (byTitle.get(title) ?? 0) + ms);
  }
}

export function multitasking(segments: readonly Segment[], events: readonly AudioEvent[], entries: readonly Entry[] = []): Multitasking {
  const blocks = audioBlocks(events);
  const bySource = new Map<string, number>();
  const sourceTitles = new Map<string, Map<string, number>>();
  const byActivity = new Map<string, number>();
  const pairs = new Map<string, Pairing>();
  const pairTitles = new Map<string, Map<string, number>>();
  let whileActiveMs = 0;
  let whileIdleMs = 0;

  for (const block of blocks) {
    bySource.set(block.source, (bySource.get(block.source) ?? 0) + (block.end - block.start));
    const titles = sourceTitles.get(block.source) ?? new Map<string, number>();
    titlesIn(titles, events, block, block.start, block.end);
    sourceTitles.set(block.source, titles);
    for (const s of segments) {
      const ms = Math.min(block.end, s.end) - Math.max(block.start, s.start);
      if (ms <= 0) continue;
      if (s.category === 'idle') {
        whileIdleMs += ms;
        continue;
      }
      if (sameThing(block, s)) continue;
      whileActiveMs += ms;
      byActivity.set(s.category, (byActivity.get(s.category) ?? 0) + ms);
      const key = `${s.detail}\u0000${block.source}`;
      const pair = pairs.get(key) ?? { doing: s.detail, category: s.category, listening: block.source, ms: 0 };
      pair.ms += ms;
      pairs.set(key, pair);
      const played = pairTitles.get(key) ?? new Map<string, number>();
      titlesIn(played, events, block, Math.max(block.start, s.start), Math.min(block.end, s.end));
      pairTitles.set(key, played);
    }
  }

  return {
    blocks: blocks.map((b) => ({ ...b, title: playingTitle(b.title, b.source) })),
    listeningMs: unionMs(blocks),
    whileActiveMs,
    whileIdleMs,
    bySource: rank(bySource).map((r) => {
      const titles = rank(sourceTitles.get(r.name) ?? new Map()).slice(0, 5);
      return { ...r, title: titles[0]?.name ?? null, titles };
    }),
    byActivity: rank(byActivity),
    pairs: [...pairs]
      .map(([key, p]) => ({ ...p, listeningTitle: rank(pairTitles.get(key) ?? new Map())[0]?.name ?? null }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 10),
    phone: phoneMultitasking(segments, entries),
  };
}
