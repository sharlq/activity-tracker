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
}

export interface SampleRules {
  idleThresholdMs: number;
  exclude: { apps: string[]; titleContains: string[]; domains: string[] };
  gaming: { games: string[] };
  browser: { fullUrlDomains: string[] };
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

  const info: WindowInfo | null = window && {
    ...window,
    ...(tab?.domain ? { domain: tab.domain } : {}),
    ...(tab?.url ? { url: tab.url } : {}),
    ...editorContext(window, editorReports, now),
  };

  const inGame = window !== null && classifyGaming(window, rules.gaming.games)?.category === 'gaming';
  if (!inGame && now - lastInputAt >= rules.idleThresholdMs) {
    // Keep what was on screen, so reading can be told apart from being away.
    const activity: Activity = info ? { kind: 'idle', window: info } : { kind: 'idle' };
    return { activity, lastInputAt, locked: false, inGame };
  }

  // No foreground window happens briefly mid-switch and during UAC prompts.
  if (!info) return { activity: 'unchanged', lastInputAt, locked: false, inGame };

  return { activity: { kind: 'window', ...info }, lastInputAt, locked: false, inGame };
}
