// Turns raw system state into what the merger should record for this tick.
import type { BrowserTab } from './browser.ts';
import { tabContext } from './browser.ts';
import type { EditorReport } from './editor.ts';
import { editorContext } from './editor.ts';
import type { GamepadReader } from './gamepad.ts';
import { classifyGaming, matchesApp } from './gaming.ts';
import type { Activity, WindowInfo } from './merger.ts';

export interface ForegroundWindow {
  processName: string;
  exePath: string | null;
  title: string;
}

export interface SystemProbe {
  isSessionLocked(): boolean;
  foregroundWindow(): ForegroundWindow | null;
  /** Time since the last keyboard or mouse input. */
  idleMs(): number;
  readGamepad: GamepadReader;
  /** The PC's awake clock: ms running, not counting sleep. Tells a tracker stall apart from sleep. */
  awakeMs?(): number;
  /** Apps holding the microphone right now ("MSTeams", "Zoom"). */
  microphoneUsers?(): string[];
}

export interface SampleRules {
  idleThresholdMs: number;
  exclude: { apps: string[]; titleContains: string[]; domains: string[] };
  gaming: { games: string[] };
  browser: { fullUrlDomains: string[] };
  /** Apps you read in without touching the keyboard, which wait longer before counting you idle. */
  reading: { apps: string[]; idleThresholdMs: number };
}

/** Noise filters hold the microphone whenever another app does: they say nothing about a call. */
const MIC_FILTERS = ['denoiseai', 'krisp', 'nvidia broadcast', 'nvbroadcast', 'audiodg'];
/** Dictating to an assistant means you're there, but it isn't a call. */
const DICTATION = ['claude', 'chatgpt', 'openai.codex', 'codex'];

/** What the microphone says: whether you're talking to the PC, and the call app if it's a call. */
export function microphoneState(users: readonly string[]): { talking: boolean; call: string | null } {
  const real = users.filter((u) => !MIC_FILTERS.some((f) => u.toLowerCase().includes(f)));
  const call = real.find((u) => !DICTATION.includes(u.toLowerCase())) ?? null;
  return { talking: real.length > 0, call };
}

export interface Sample {
  /** null: record nothing and close any open event. */
  activity: Activity | 'unchanged' | null;
  /** When the user was last known to be active. */
  lastInputAt: number;
  /** Lets the service log lock changes. Exclusions are deliberately not surfaced. */
  locked: boolean;
  /** A game is being recorded, which counts as activity for later idle backdating. */
  inGame: boolean;
  /** The microphone is in use (a call, dictation): you're there without touching anything. */
  talking?: boolean;
}

export function isExcluded(window: ForegroundWindow, exclude: SampleRules['exclude']): boolean {
  if (exclude.apps.some((entry) => matchesApp(window, entry))) return true;
  const title = window.title.toLowerCase();
  return exclude.titleContains.some((text) => title.includes(text.toLowerCase()));
}

export function sample(
  probe: SystemProbe,
  rules: SampleRules,
  now: number,
  /** Latest activity the keyboard and mouse can't see: controller use, time in a game. */
  lastOtherActivityAt: number = -Infinity,
  /** Recent reports from the browser extension, newest last. */
  browserTabs: readonly BrowserTab[] = [],
  /** Recent heartbeats from the editor extension, newest last. */
  editorReports: readonly EditorReport[] = [],
): Sample {
  const lastInputAt = Math.max(now - probe.idleMs(), lastOtherActivityAt);
  const nothing = { activity: null, lastInputAt, locked: false, inGame: false };

  if (probe.isSessionLocked()) return { ...nothing, locked: true };

  const window = probe.foregroundWindow();
  if (window && isExcluded(window, rules.exclude)) return nothing;

  const tab =
    window &&
    tabContext(window, browserTabs, now, {
      excludeDomains: rules.exclude.domains,
      fullUrlDomains: rules.browser.fullUrlDomains,
    });
  if (tab === 'hidden') return nothing;

  let micUsers: string[] = [];
  try {
    micUsers = probe.microphoneUsers?.() ?? [];
  } catch {
    // The microphone is an extra: if it can't be read, carry on without it.
  }
  const { talking, call } = microphoneState(micUsers);

  const info: WindowInfo | null = window && {
    ...window,
    ...(tab?.domain ? { domain: tab.domain } : {}),
    ...(tab?.url ? { url: tab.url } : {}),
    ...editorContext(window, editorReports, now),
    ...(call ? { call } : {}),
  };

  const inGame = window !== null && classifyGaming(window, rules.gaming.games)?.category === 'gaming';
  const reading = window !== null && rules.reading.apps.some((entry) => matchesApp(window, entry));
  const threshold = reading ? Math.max(rules.idleThresholdMs, rules.reading.idleThresholdMs) : rules.idleThresholdMs;
  // On a call you're there even with your hands off the keyboard, like in a game.
  if (!inGame && !talking && now - lastInputAt >= threshold) {
    // Keep what was on screen, so reading can be told apart from being away.
    const activity: Activity = info ? { kind: 'idle', window: info } : { kind: 'idle' };
    return { activity, lastInputAt, locked: false, inGame };
  }

  // No foreground window happens briefly mid-switch and during UAC prompts.
  if (!info) return { activity: 'unchanged', lastInputAt, locked: false, inGame, talking };

  return { activity: { kind: 'window', ...info }, lastInputAt, locked: false, inGame, talking };
}
