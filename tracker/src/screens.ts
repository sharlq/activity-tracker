// What's on your other screens: the window on top of each screen that doesn't
// have the focus. With several monitors you can read notes on one while typing
// on another, and the focused window alone can't show that.
//
// It is recorded separately from the focused window, the same way background
// sound is, so active time and categories are unchanged. Each main tick turns
// the screens' top windows into sources and extends or starts a row per source.
//
// The same privacy rules as the focused window apply: nothing while locked or
// paused, and excluded apps, titles, and sites leave no trace. A Chrome window
// is recorded only if the extension vouches for its active tab, because Chrome
// hides private windows from extensions and doesn't mark them in the title.
import type { BrowserTab } from './browser.ts';
import { domainMatches } from './browser.ts';
import { rememberRecent } from './recent.ts';
import { isExcluded } from './sampler.ts';

/** The extension reports every window's active tab at least every 30s; allow for a miss. */
export const VISIBLE_TAB_FRESH_MS = 75_000;

/** Processes whose windows need the extension to vouch for them. */
const VOUCHED_BROWSERS = new Set(['chrome.exe']);

/** The window on top of one screen, as the system reports it. */
export interface ScreenWindow {
  /** 1-based, numbered left to right (then top to bottom). */
  screen: number;
  processName: string;
  exePath: string | null;
  title: string;
  /** The window that has the keyboard focus; it's already recorded as the main activity. */
  focused: boolean;
}

/** What to record for one screen. */
export interface ScreenSource {
  screen: number;
  processName: string;
  exePath: string | null;
  title: string | null;
  /** For Chrome windows, the active tab's site. */
  domain: string | null;
}

export interface ScreenRules {
  exclude: { apps: string[]; titleContains: string[]; domains: string[] };
}

/** Keeps the extension's latest report per window title, newest last. */
export function rememberVisibleTabs(tabs: readonly BrowserTab[], report: readonly BrowserTab[]): BrowserTab[] {
  let kept = [...tabs];
  for (const tab of report) kept = rememberRecent(kept, tab, VISIBLE_TAB_FRESH_MS, 40);
  return kept;
}

/** What to record as visible on the other screens right now. */
export function screenSources(
  windows: readonly ScreenWindow[],
  tabs: readonly BrowserTab[],
  now: number,
  rules: ScreenRules,
): ScreenSource[] {
  const sources: ScreenSource[] = [];
  for (const w of windows) {
    if (w.focused) continue;
    if (isExcluded(w, rules.exclude)) continue;
    let domain: string | null = null;
    if (VOUCHED_BROWSERS.has(w.processName.toLowerCase())) {
      const tab = tabs.findLast((t) => t.title !== '' && w.title.startsWith(t.title) && now - t.receivedAt <= VISIBLE_TAB_FRESH_MS);
      if (!tab) continue;
      const found = tab.domain;
      if (found && rules.exclude.domains.some((entry) => domainMatches(found, entry))) continue;
      domain = found;
    }
    sources.push({ screen: w.screen, processName: w.processName, exePath: w.exePath, title: w.title || null, domain });
  }
  return sources;
}
