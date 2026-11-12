// Attaches what the Chrome extension reported to the Chrome window being recorded.
//
// The window tracker stays the source of truth for *when* Chrome is in front. The
// extension only says *which tab* that was. A report is used only if the window's
// title starts with the tab's title. That stops a stale report, or one from
// another Chrome window, from being pinned on the wrong page.
//
// A Chrome window with no matching report is not recorded at all. Chrome doesn't
// put "Incognito" in private windows' titles and hides them from extensions, so
// "the extension can't vouch for this window" is the only reliable sign of one.

import { rememberRecent } from './recent.ts';

/** Processes whose windows can carry tab details. */
const BROWSER_PROCESSES = new Set(['chrome.exe']);

/** The extension reports every 15s while Chrome is in front; allow for two misses. */
export const TAB_FRESH_MS = 45_000;

export interface BrowserTab {
  url: string;
  /** null for pages that aren't http(s), such as chrome://newtab or local files. */
  domain: string | null;
  title: string;
  receivedAt: number;
}

export interface BrowserRules {
  excludeDomains: string[];
  fullUrlDomains: string[];
}

/**
 * null: not a browser window. 'hidden': a browser window that must not be
 * recorded (excluded site, private window, or no report to vouch for it).
 */
export type TabContext = { domain: string | null; url: string | null } | 'hidden' | null;

/** Lowercase host without a leading "www.", or null for anything but http(s). */
export function domainOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.hostname.toLowerCase().replace(/^www\./, '') || null;
}

/** Config entries may be written as "example.com", "www.example.com", or "*.example.com". */
export function normalizeDomainEntry(entry: string): string {
  return entry.trim().toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
}

/** An entry covers the domain itself and all its subdomains. */
export function domainMatches(domain: string, entry: string): boolean {
  const wanted = normalizeDomainEntry(entry);
  return domain === wanted || domain.endsWith(`.${wanted}`);
}

/** The URL as stored: without login details or #fragment. */
function cleanUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  return parsed.href;
}

/**
 * Keeps the reports still fresh enough to use, newest last. Several are kept
 * because two quick reports (address, then title) can arrive out of order, and
 * the window's title can lag the tab's by a moment.
 */
export function rememberTab(tabs: readonly BrowserTab[], tab: BrowserTab): BrowserTab[] {
  return rememberRecent(tabs, tab, TAB_FRESH_MS);
}

export function tabContext(
  window: { processName: string; title: string },
  tabs: readonly BrowserTab[],
  now: number,
  rules: BrowserRules,
): TabContext {
  if (!BROWSER_PROCESSES.has(window.processName.toLowerCase())) return null;
  const tab = tabs.findLast(
    (t) => t.title !== '' && window.title.startsWith(t.title) && now - t.receivedAt <= TAB_FRESH_MS,
  );
  if (!tab) return 'hidden';

  const { domain } = tab;
  if (domain && rules.excludeDomains.some((entry) => domainMatches(domain, entry))) return 'hidden';

  const fullUrl = domain !== null && rules.fullUrlDomains.some((entry) => domainMatches(domain, entry));
  return { domain, url: fullUrl ? cleanUrl(tab.url) : null };
}
