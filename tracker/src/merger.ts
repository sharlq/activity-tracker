// Heartbeat merging: a pure state machine with no clock, database, or Win32.
//
// Each tick yields operations for the store. The rules that keep totals honest:
//  - Same activity as last tick: extend the open event to now.
//  - Different activity: the old event ends exactly where the new one starts.
//  - Going idle is backdated to the last input, since the user was already gone.
//  - A gap between ticks (sleep, hibernate, shutdown, clock change) never gets
//    bridged: the old event keeps the end of its last heartbeat.

export interface WindowInfo {
  processName: string;
  exePath: string | null;
  title: string;
  /** Browser windows only, when the extension reported the tab. */
  domain?: string;
  /** Only for domains on the full-URL allowlist. */
  url?: string;
  /** Editor windows only, when the extension reported the workspace. */
  project?: string;
  language?: string;
  branch?: string;
  /** The app holding the microphone (Teams, Zoom...) while you're on a call. */
  call?: string;
}

export type Activity =
  | ({ kind: 'window' } & WindowInfo)
  /**
   * `window` is what was in front when you went idle, so reading can be told apart
   * from being away. Absent when nothing was in front, and in data from before
   * this was recorded.
   */
  | { kind: 'idle'; window?: WindowInfo };

/** Details added by the extensions; absent and undefined mean the same thing. */
const DETAILS = ['domain', 'url', 'project', 'language', 'branch', 'call'] as const;

export interface OpenEvent {
  activity: Activity;
  start: number;
  end: number;
}

export type Op =
  /** Set the end of the most recently started event. */
  | { type: 'setEnd'; end: number }
  | { type: 'start'; activity: Activity; start: number; end: number };

export interface Tick {
  at: number;
  /** null closes the open event; 'unchanged' extends it without starting one. */
  activity: Activity | 'unchanged' | null;
  lastInputAt: number;
  /**
   * The PC's awake clock (time not asleep or hibernating), when known. A long wait
   * between ticks while it kept running is the tracker stalling, not you leaving.
   */
  awakeAt?: number;
}

export interface TickResult {
  ops: Op[];
  /** How long the machine went unobserved before this tick, if it did. */
  gapMs: number | null;
  /** How long the tracker stalled while the PC stayed awake, bridged as continuous time. */
  stallMs?: number;
}

/** A stall longer than this is still treated as a gap: too long to vouch for what was in front. */
export const MAX_STALL_MS = 5 * 60_000;

/**
 * True if the time between ticks was spent awake: the PC's awake clock moved as much
 * as the wall clock, within a little slack for timer jitter.
 */
export function awakeThrough(elapsedMs: number, awakeElapsedMs: number): boolean {
  return elapsedMs <= MAX_STALL_MS && Math.abs(elapsedMs - awakeElapsedMs) <= Math.max(2_000, elapsedMs * 0.1);
}

export function sameActivity(a: Activity, b: Activity): boolean {
  if (a.kind === 'idle' || b.kind === 'idle') {
    if (a.kind !== b.kind) return false;
    // While idle, only a different app in front starts a new event. Titles keep
    // changing on their own (counters, clocks) and editor details go stale, but
    // what you were reading is decided when you went idle.
    const appA = a.kind === 'idle' ? a.window : undefined;
    const appB = b.kind === 'idle' ? b.window : undefined;
    return (appA?.processName ?? null) === (appB?.processName ?? null) && (appA?.exePath ?? null) === (appB?.exePath ?? null);
  }
  return (
    a.processName === b.processName &&
    a.exePath === b.exePath &&
    a.title === b.title &&
    DETAILS.every((key) => (a[key] ?? null) === (b[key] ?? null))
  );
}

export class EventMerger {
  private readonly maxGapMs: number;
  private open: OpenEvent | null;
  private lastTickAt: number | null;
  private lastAwakeAt: number | null = null;

  /**
   * @param maxGapMs longest silence between ticks that still counts as continuous.
   * @param resume the newest stored event, so a quick restart continues it.
   */
  constructor(maxGapMs: number, resume: OpenEvent | null = null) {
    this.maxGapMs = maxGapMs;
    this.open = resume && { activity: resume.activity, start: resume.start, end: resume.end };
    this.lastTickAt = resume?.end ?? null;
  }

  tick({ at, activity, lastInputAt, awakeAt }: Tick): TickResult {
    const elapsed = this.lastTickAt === null ? 0 : at - this.lastTickAt;
    const late = elapsed > this.maxGapMs || elapsed < 0;
    // Only a stall we can prove was spent awake is bridged; the first tick after a
    // restart, a clock change, or a sleep stays a gap.
    const stalled =
      late && elapsed > 0 && awakeAt !== undefined && this.lastAwakeAt !== null && awakeThrough(elapsed, awakeAt - this.lastAwakeAt);
    const gapped = late && !stalled;
    this.lastTickAt = at;
    this.lastAwakeAt = awakeAt ?? null;

    const open = gapped ? null : this.open;
    const gapMs = gapped ? elapsed : null;
    const extra = stalled ? { stallMs: elapsed } : {};

    if (activity === null) {
      this.open = null;
      return { ops: [], gapMs, ...extra };
    }

    if (activity === 'unchanged') {
      this.open = open;
      if (!open) return { ops: [], gapMs, ...extra };
      open.end = at;
      return { ops: [{ type: 'setEnd', end: at }], gapMs, ...extra };
    }

    if (open && sameActivity(open.activity, activity)) {
      open.end = at;
      this.open = open;
      return { ops: [{ type: 'setEnd', end: at }], gapMs, ...extra };
    }

    const ops: Op[] = [];
    let start = at;
    if (open) {
      if (activity.kind === 'idle' && open.activity.kind === 'window') {
        // Never rewrites an event already closed, so at worst the idle period
        // starts late if focus moved on its own while the user was away.
        // From idle to idle (another app came to the front) nothing is backdated.
        start = Math.min(at, Math.max(open.start, lastInputAt));
      }
      ops.push({ type: 'setEnd', end: start });
    }
    ops.push({ type: 'start', activity, start, end: at });
    this.open = { activity, start, end: at };
    return { ops, gapMs, ...extra };
  }
}
