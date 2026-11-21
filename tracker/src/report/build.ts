// Assembles every figure for a day or week report.
import type { ClaudeSession } from '../claudeSessions.ts';
import type { AudioEvent, Entry, ScreenEvent } from '../journal.ts';
import type { StoredEvent } from '../store.ts';
import { sessionStats } from '../claudeSessions.ts';
import type { CategoryConfig } from './categories.ts';
import type { Block, CategoryTotal, GamingSession, Ranked, Segment, Stretch } from './report.ts';
import { gamingSessions, longestFocus, switches, timeline, toSegments, top, totals } from './report.ts';
import type { Multitasking } from './multitask.ts';
import { isPhoneEntry, multitasking } from './multitask.ts';
import type { OtherScreens } from './screens.ts';
import { otherScreens } from './screens.ts';

/** Time spent writing a message counts toward the chat it's sent to, if sent this soon after. */
const WRITING_TIME_MS = 5 * 60_000;

function chatsBetween(sessions: readonly ClaudeSession[], from: number, to: number) {
  return sessions
    .map((session) => ({ session, messages: session.timestamps.filter((t) => t >= from && t <= to).length }))
    .filter((s) => s.messages > 0)
    .sort((a, b) => b.messages - a.messages);
}

/**
 * The Claude app's window is always titled just "Claude". Name each Claude block
 * after the chat with the most messages during it, from Claude Code's logs. If
 * no message was sent during the block, you were probably writing one: use the
 * chat that gets the next message within a few minutes.
 * Chats in the app's Chat tab aren't stored on this PC, so those blocks stay "claude".
 */
export function nameClaudeBlocks(blocks: readonly Block[], sessions: readonly ClaudeSession[]): Block[] {
  return blocks.map((block) => {
    if (block.detail.toLowerCase() !== 'claude') return block;
    let chats = chatsBetween(sessions, block.start, block.end);
    if (chats.length === 0) {
      const next = chatsBetween(sessions, block.end, block.end + WRITING_TIME_MS)
        .map((c) => ({ ...c, first: c.session.timestamps.find((t) => t >= block.end) ?? Infinity }))
        .sort((a, b) => a.first - b.first);
      chats = next.slice(0, 1);
    }
    const [main, ...others] = chats;
    if (!main) return block;
    const more = others.length > 0 ? ` (+${others.length} more)` : '';
    return { ...block, detail: `claude: ${main.session.title ?? main.session.project}${more}` };
  });
}

/** How idle time splits by what was on screen, so reading can be told apart from being away. */
export function idleBy(blocks: readonly Block[]): Ranked[] {
  const byDetail = new Map<string, number>();
  for (const block of blocks) {
    if (block.category !== 'idle') continue;
    byDetail.set(block.detail, (byDetail.get(block.detail) ?? 0) + (block.end - block.start));
  }
  return [...byDetail].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms);
}

export interface ClaudeRow {
  project: string;
  /** The chat's name, for a day report. */
  title: string | null;
  /** Set for a day report (one row per session); null for a week (one row per project). */
  start: number | null;
  end: number | null;
  sessions: number;
  spanMs: number;
  activeMs: number;
  messages: number;
}

export interface DaySummary {
  day: number;
  trackedMs: number;
  focusMs: number;
  distractionMs: number;
  idleMs: number;
  switches: number;
}

export interface Report {
  kind: 'day' | 'week';
  from: number;
  to: number;
  trackedMs: number;
  idleMs: number;
  /** Idle time by what was on screen; "idle" means nothing known. Largest first. */
  idleBy: Ranked[];
  totals: CategoryTotal[];
  /** Day reports only. */
  timeline: Block[];
  /** Week reports only. */
  days: DaySummary[];
  topApps: Ranked[];
  topDomains: Ranked[];
  gaming: GamingSession[];
  claude: ClaudeRow[];
  switches: number;
  longestFocus: Stretch | null;
  /** Sound playing in the background while you did other things. */
  multitasking: Multitasking;
  /** What was up on the screens without the focus. */
  otherScreens: OtherScreens;
  /** What you logged yourself for the gaps, oldest first. `phone` marks phone use, which runs alongside the rest. */
  entries: (Entry & { phone: boolean })[];
}

export interface ReportInput {
  kind: 'day' | 'week';
  from: number;
  to: number;
  events: readonly StoredEvent[];
  claudeSessions: readonly ClaudeSession[];
  categories: CategoryConfig;
  games: string[];
  /** Background audio, clipped to the period. */
  audio?: readonly AudioEvent[];
  /** What was on the other screens, clipped to the period. */
  screens?: readonly ScreenEvent[];
  entries?: readonly Entry[];
}

const sum = (segments: readonly Segment[], keep: (s: Segment) => boolean) =>
  segments.filter(keep).reduce((total, s) => total + (s.end - s.start), 0);

function clip(segments: readonly Segment[], from: number, to: number): Segment[] {
  return segments
    .filter((s) => s.start < to && s.end > from)
    .map((s) => ({ ...s, start: Math.max(s.start, from), end: Math.min(s.end, to) }));
}

/** Midnights from `from` up to `to`, done with calendar days so DST changes don't drift. */
function midnights(from: number, to: number): number[] {
  const days: number[] = [];
  for (const d = new Date(from); d.getTime() < to; d.setDate(d.getDate() + 1)) days.push(d.getTime());
  return days;
}

function claudeRows(sessions: readonly ClaudeSession[], from: number, to: number, kind: 'day' | 'week'): ClaudeRow[] {
  if (kind === 'day') {
    return sessions
      .flatMap((session) => {
        const stats = sessionStats(session.timestamps, from, to);
        return stats ? [{ project: session.project, title: session.title, sessions: 1, ...stats }] : [];
      })
      .sort((a, b) => a.start - b.start);
  }

  // Per project, adding up each day separately: a session left open overnight
  // would otherwise show a span of 20+ hours that nobody spent working.
  const rows = new Map<string, ClaudeRow>();
  for (const session of sessions) {
    let seen = false;
    for (const day of midnights(from, to)) {
      const stats = sessionStats(session.timestamps, day, new Date(day).setDate(new Date(day).getDate() + 1));
      if (!stats) continue;
      const row = rows.get(session.project) ?? { project: session.project, title: null, start: null, end: null, sessions: 0, spanMs: 0, activeMs: 0, messages: 0 };
      if (!seen) row.sessions++;
      seen = true;
      row.spanMs += stats.spanMs;
      row.activeMs += stats.activeMs;
      row.messages += stats.messages;
      rows.set(session.project, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.activeMs - a.activeMs);
}

export function buildReport({ kind, from, to, events, claudeSessions, categories, games, audio = [], screens = [], entries = [] }: ReportInput): Report {
  const segments = clip(toSegments(events, categories, games), from, to);
  const clippedEntries = entries.filter((e) => e.start < to && e.end > from).map((e) => ({ ...e, start: Math.max(e.start, from), end: Math.min(e.end, to) }));
  const blocks = timeline(segments);
  const named = nameClaudeBlocks(blocks, claudeSessions);
  const days =
    kind === 'week'
      ? midnights(from, to).map((day) => {
          const next = new Date(day).setDate(new Date(day).getDate() + 1);
          const daySegments = clip(segments, day, next);
          return {
            day,
            trackedMs: sum(daySegments, () => true),
            focusMs: sum(daySegments, (s) => categories.focus.includes(s.category)),
            distractionMs: sum(daySegments, (s) => categories.distraction.includes(s.category)),
            idleMs: sum(daySegments, (s) => s.category === 'idle'),
            switches: switches(daySegments, categories),
          };
        })
      : [];

  return {
    kind,
    from,
    to,
    trackedMs: sum(segments, () => true),
    idleMs: sum(segments, (s) => s.category === 'idle'),
    totals: totals(segments),
    timeline: kind === 'day' ? named : [],
    idleBy: idleBy(named),
    days,
    topApps: top(segments, 'app'),
    topDomains: top(segments, 'domain'),
    gaming: gamingSessions(segments),
    claude: claudeRows(claudeSessions, from, to, kind),
    switches: switches(segments, categories),
    longestFocus: longestFocus(blocks, categories),
    multitasking: multitasking(segments, audio.map((e) => ({ ...e, start: Math.max(e.start, from), end: Math.min(e.end, to) })), clippedEntries),
    otherScreens: otherScreens(segments, screens.filter((e) => e.start < to && e.end > from).map((e) => ({ ...e, start: Math.max(e.start, from), end: Math.min(e.end, to) })), categories, games, kind),
    entries: entries.filter((e) => e.start < to && e.end > from).toSorted((a, b) => a.start - b.start).map((e) => ({ ...e, phone: isPhoneEntry(e) })),
  };
}
