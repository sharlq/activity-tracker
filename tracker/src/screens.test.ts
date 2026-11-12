import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SpanRecorder } from './audio.ts';
import type { BrowserTab } from './browser.ts';
import type { ScreenRules, ScreenSource, ScreenWindow } from './screens.ts';
import { rememberVisibleTabs, screenSources, VISIBLE_TAB_FRESH_MS } from './screens.ts';

const NOW = 1_000_000;
const RULES: ScreenRules = { exclude: { apps: [], titleContains: [], domains: [] } };
const win = (screen: number, processName: string, title: string, focused = false): ScreenWindow => ({
  screen,
  processName,
  exePath: `C:\Apps\${processName}`,
  title,
  focused,
});
const tab = (title: string, domain: string | null, receivedAt = NOW): BrowserTab => ({ url: `https://${domain}/`, title, domain, receivedAt });

describe('screenSources', () => {
  it('records the other screens and leaves out the focused one', () => {
    const sources = screenSources([win(1, 'WINWORD.EXE', 'Notes.docx - Word'), win(2, 'Code.exe', 'main.ts', true), win(3, 'Spotify.exe', 'Spotify')], [], NOW, RULES);
    assert.deepEqual(sources.map((s) => [s.screen, s.processName, s.title]), [
      [1, 'WINWORD.EXE', 'Notes.docx - Word'],
      [3, 'Spotify.exe', 'Spotify'],
    ]);
  });

  it('applies the same exclusions as for the focused window', () => {
    const rules: ScreenRules = { exclude: { apps: ['KeePass.exe'], titleContains: ['bank'], domains: [] } };
    const sources = screenSources([win(1, 'KeePass.exe', 'Database'), win(2, 'firefox.exe', 'My Bank - Firefox'), win(3, 'notepad.exe', 'todo.txt')], [], NOW, rules);
    assert.deepEqual(sources.map((s) => s.screen), [3]);
  });

  it('records a Chrome window only when the extension vouches for its tab', () => {
    const chrome = win(1, 'chrome.exe', 'Lecture 4 - YouTube - Google Chrome');
    assert.deepEqual(screenSources([chrome], [], NOW, RULES), []);
    const [source] = screenSources([chrome], [tab('Lecture 4 - YouTube', 'youtube.com')], NOW, RULES);
    assert.equal(source?.domain, 'youtube.com');
  });

  it('ignores stale tab reports and excluded sites', () => {
    const chrome = win(1, 'chrome.exe', 'Inbox - Google Chrome');
    assert.deepEqual(screenSources([chrome], [tab('Inbox', 'mail.example.com', NOW - VISIBLE_TAB_FRESH_MS - 1)], NOW, RULES), []);
    const rules: ScreenRules = { exclude: { apps: [], titleContains: [], domains: ['example.com'] } };
    assert.deepEqual(screenSources([chrome], [tab('Inbox', 'mail.example.com')], NOW, rules), []);
  });
});

describe('rememberVisibleTabs', () => {
  it('keeps fresh reports and drops old ones', () => {
    const kept = rememberVisibleTabs([tab('Old', 'a.com', NOW - VISIBLE_TAB_FRESH_MS - 10)], [tab('New', 'b.com')]);
    assert.deepEqual(kept.map((t) => t.title), ['New']);
  });
});

describe('SpanRecorder for screens', () => {
  it('extends a window still on its screen and starts a row when it changes', () => {
    const rows: { id: number; source: ScreenSource; start: number; end: number }[] = [];
    const recorder = new SpanRecorder<ScreenSource>(
      (source, start, end) => rows.push({ id: rows.length + 1, source, start, end }),
      (id, end) => {
        rows[id - 1]!.end = end;
      },
      15_000,
    );
    const notes: ScreenSource = { screen: 1, processName: 'WINWORD.EXE', exePath: null, title: 'Notes', domain: null };
    recorder.tick(0, [notes]);
    recorder.tick(5_000, [notes]);
    recorder.tick(10_000, [{ ...notes, screen: 2 }]);
    assert.deepEqual(rows.map((r) => [r.source.screen, r.start, r.end]), [
      [1, 0, 5_000],
      [2, 10_000, 10_000],
    ]);
  });
});
