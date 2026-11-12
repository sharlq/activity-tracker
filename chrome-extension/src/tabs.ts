// Decides what, if anything, to report about a tab. No Chrome APIs here, so it can be tested.

export interface TabLike {
  url?: string;
  title?: string;
  incognito: boolean;
}

export interface TabReport {
  url: string;
  title: string;
}

export function tabReport(tab: TabLike | undefined): TabReport | null {
  // Never report anything about a private window, not even that one is open.
  if (!tab || tab.incognito || !tab.url) return null;
  return { url: tab.url, title: tab.title ?? '' };
}

/** True if Chrome's change to a tab affects what we'd report. */
export function changesReport(change: { url?: string; title?: string }): boolean {
  return change.url !== undefined || change.title !== undefined;
}

export interface AudibleTabLike extends TabLike {
  audible?: boolean;
  mutedInfo?: { muted: boolean };
}

/** The tabs actually making sound: audible, not muted, and never from a private window. */
export function audibleReports(tabs: readonly AudibleTabLike[]): TabReport[] {
  return tabs
    .filter((tab) => tab.audible === true && tab.mutedInfo?.muted !== true)
    .map(tabReport)
    .filter((report): report is TabReport => report !== null)
    .slice(0, 20);
}

/** Each window's active tab, for windows left open on other screens. Never a private window. */
export function visibleReports(tabs: readonly TabLike[]): TabReport[] {
  return tabs
    .map(tabReport)
    .filter((report): report is TabReport => report !== null)
    .slice(0, 20);
}
