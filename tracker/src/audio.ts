// Background audio: what's making sound, alongside whatever is in front.
//
// The meter is read every second, because speech has pauses and a single reading
// can easily land in one. An app counts as playing while it has been audible
// within the last few seconds. Each main tick then turns the playing processes
// into sources (an app, or a browser tab the extension reported as audible) and
// extends or starts a row per source, the same way window events are merged.
//
// The same privacy rules as windows apply: nothing while locked or paused,
// excluded apps, titles, and sites leave no trace, and browser windows' titles
// are never used (they show the tab in front, not the one playing).
import type { BrowserTab } from './browser.ts';
import { domainMatches } from './browser.ts';
import type { AudioSource } from './journal.ts';
import { isExcluded } from './sampler.ts';

/** Peak level that counts as sound rather than silence. */
export const AUDIBLE_PEAK = 0.001;
/** An app keeps counting as playing this long after it was last heard. */
export const AUDIBLE_HOLD_MS = 8_000;
/** The extension reports audible tabs every 15s; allow for two misses. */
export const AUDIBLE_TAB_FRESH_MS = 45_000;

const BROWSERS = new Set(['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe']);
/** Only Chrome has the extension that says which tab is playing. */
const REPORTING_BROWSERS = new Set(['chrome.exe']);

export interface ProcessInfo {
  processName: string;
  exePath: string | null;
  /** The title of the process's main window, if it has one. */
  windowTitle: string;
}

export interface AudibleTab {
  url: string;
  title: string;
  domain: string | null;
  receivedAt: number;
}

/** Remembers when each process was last audible. */
export class LoudnessMemory {
  private readonly lastHeard = new Map<number, number>();

  hear(readings: readonly { pid: number; peak: number }[], at: number): void {
    for (const { pid, peak } of readings) if (peak >= AUDIBLE_PEAK) this.lastHeard.set(pid, at);
    for (const [pid, heard] of this.lastHeard) if (at - heard > AUDIBLE_HOLD_MS) this.lastHeard.delete(pid);
  }

  playing(at: number): number[] {
    return [...this.lastHeard].filter(([, heard]) => at - heard <= AUDIBLE_HOLD_MS).map(([pid]) => pid);
  }
}

export interface SourceRules {
  exclude: { apps: string[]; titleContains: string[]; domains: string[] };
}

/** What to record as playing, given the processes making sound right now. */
export function audioSources(
  processes: readonly ProcessInfo[],
  tabs: readonly AudibleTab[],
  now: number,
  rules: SourceRules,
): AudioSource[] {
  const sources = new Map<string, AudioSource>();
  const add = (source: AudioSource) => sources.set(JSON.stringify(source), source);
  const titleExcluded = (title: string) => rules.exclude.titleContains.some((t) => title.toLowerCase().includes(t.toLowerCase()));

  for (const p of processes) {
    if (isExcluded({ processName: p.processName, exePath: p.exePath, title: p.windowTitle }, rules.exclude)) continue;
    const name = p.processName.toLowerCase();
    if (!BROWSERS.has(name)) {
      add({ processName: p.processName, exePath: p.exePath, title: p.windowTitle || null, domain: null });
      continue;
    }
    const fresh = REPORTING_BROWSERS.has(name) ? tabs.filter((t) => now - t.receivedAt <= AUDIBLE_TAB_FRESH_MS) : [];
    if (fresh.length === 0) {
      add({ processName: p.processName, exePath: p.exePath, title: null, domain: null });
      continue;
    }
    for (const tab of fresh) {
      const { domain } = tab;
      if (domain && rules.exclude.domains.some((entry) => domainMatches(domain, entry))) continue;
      if (titleExcluded(tab.title)) continue;
      add({ processName: p.processName, exePath: p.exePath, title: tab.title || null, domain });
    }
  }
  return [...sources.values()];
}

export interface AudioWriter {
  startAudio(source: AudioSource, start: number, end: number): number;
  extendAudio(id: number, end: number): void;
}

/**
 * Turns each tick's sources into rows: extend a source still there, start one
 * that's new. Used for background sound and for what's on the other screens.
 */
export class SpanRecorder<S> {
  private open = new Map<string, { id: number; end: number }>();
  private readonly start: (source: S, start: number, end: number) => number;
  private readonly extend: (id: number, end: number) => void;
  private readonly maxGapMs: number;

  constructor(start: (source: S, start: number, end: number) => number, extend: (id: number, end: number) => void, maxGapMs: number) {
    this.start = start;
    this.extend = extend;
    this.maxGapMs = maxGapMs;
  }

  tick(at: number, sources: readonly S[]): void {
    const next = new Map<string, { id: number; end: number }>();
    for (const source of sources) {
      const key = JSON.stringify(source);
      if (next.has(key)) continue;
      const open = this.open.get(key);
      if (open && at - open.end <= this.maxGapMs && at >= open.end) {
        this.extend(open.id, at);
        next.set(key, { id: open.id, end: at });
      } else {
        next.set(key, { id: this.start(source, at, at), end: at });
      }
    }
    this.open = next;
  }

  /** After a failed write, start fresh rather than extend rows that may not exist. */
  reset(): void {
    this.open.clear();
  }
}

export class AudioRecorder extends SpanRecorder<AudioSource> {
  constructor(writer: AudioWriter, maxGapMs: number) {
    super((source, start, end) => writer.startAudio(source, start, end), (id, end) => writer.extendAudio(id, end), maxGapMs);
  }
}
