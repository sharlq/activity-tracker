// Reports the active tab when it changes, and every 15 seconds while Chrome is focused.
// Also reports which tabs are playing sound, every 15 seconds while any are, even
// when Chrome is in the background: that's how رقيب knows a podcast or music tab
// was playing while you worked in another app. And it reports every window's
// active tab every 30 seconds, so رقيب can name a Chrome window left open on
// another screen while you work on this one.
//
// MV3 alarms can't fire more often than every 30 seconds, so a plain interval
// does the 15-second beat. Each beat calls Chrome APIs, which keeps the service
// worker alive while Chrome is focused. When focus leaves, the interval stops
// and Chrome is free to unload the worker. The 30-second alarm wakes it again if
// it was unloaded while still focused.
import { audibleReports, changesReport, tabReport, visibleReports } from './tabs.ts';
import { loadSettings, sendAudible, sendTab, sendVisible } from './tracker.ts';

const HEARTBEAT_MS = 15_000;
const WAKE_ALARM = 'wake';

let heartbeat: ReturnType<typeof setInterval> | undefined;
let audioBeat: ReturnType<typeof setInterval> | undefined;
let wasPlaying = false;

async function reportAudio(): Promise<void> {
  const tabs = audibleReports(await chrome.tabs.query({ audible: true }));
  const playing = tabs.length > 0;
  if (playing) audioBeat ??= setInterval(() => void reportAudio(), HEARTBEAT_MS);
  else {
    clearInterval(audioBeat);
    audioBeat = undefined;
  }
  // One empty report when sound stops, then quiet until something plays again.
  if (playing || wasPlaying) await sendAudible(await loadSettings(), tabs);
  wasPlaying = playing;
}

async function reportVisible(): Promise<void> {
  await sendVisible(await loadSettings(), visibleReports(await chrome.tabs.query({ active: true })));
}

function startHeartbeat(): void {
  heartbeat ??= setInterval(() => void report(), HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  clearInterval(heartbeat);
  heartbeat = undefined;
}

async function report(): Promise<void> {
  const window = await chrome.windows.getLastFocused();
  if (!window.focused || window.incognito || window.id === undefined) {
    stopHeartbeat();
    return;
  }
  startHeartbeat();

  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
  const tabInfo = tabReport(tab);
  if (!tabInfo) return;

  const status = await sendTab(await loadSettings(), tabInfo);
  await chrome.storage.local.set({ status });
}

chrome.tabs.onActivated.addListener(() => {
  void report();
  void reportVisible();
});
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (tab.active && changesReport(change)) {
    void report();
    void reportVisible();
  }
void reportAudio();
  if (change.audible !== undefined || change.mutedInfo !== undefined || (tab.audible && changesReport(change))) void reportAudio();
});
chrome.tabs.onRemoved.addListener(() => void reportAudio());
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) stopHeartbeat();
  else void report();
  void reportVisible();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WAKE_ALARM) {
    void report();
    void reportAudio();
    void reportVisible();
  }
});

void chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 0.5 });
void report();
void reportVisible();
