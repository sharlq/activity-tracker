import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AudioWriter, ProcessInfo } from './audio.ts';
import { AUDIBLE_HOLD_MS, AudioRecorder, audioSources, LoudnessMemory } from './audio.ts';
import type { AudioSource } from './journal.ts';

const NO_RULES = { exclude: { apps: [], titleContains: [], domains: [] } };
const spotify: ProcessInfo = { processName: 'Spotify.exe', exePath: 'C:\\Spotify\\Spotify.exe', windowTitle: 'Some Artist - Some Song' };
const chrome: ProcessInfo = { processName: 'chrome.exe', exePath: 'C:\\Chrome\\chrome.exe', windowTitle: 'Google Docs - Google Chrome' };
const tab = (url: string, title: string, receivedAt = 1000) => ({ url, title, domain: new URL(url).hostname.replace(/^www\./, ''), receivedAt });

describe('LoudnessMemory', () => {
  it('keeps an app playing through short silences, then lets it go', () => {
    const memory = new LoudnessMemory();
    memory.hear([{ pid: 1, peak: 0.2 }, { pid: 2, peak: 0 }], 0);
    assert.deepEqual(memory.playing(0), [1]);
    memory.hear([{ pid: 1, peak: 0 }], 3000); // A pause between words.
    assert.deepEqual(memory.playing(3000), [1]);
    memory.hear([], AUDIBLE_HOLD_MS + 1);
    assert.deepEqual(memory.playing(AUDIBLE_HOLD_MS + 1), []);
  });
});

describe('audioSources', () => {
  it('names an app by its window title, which for music players is the track', () => {
    assert.deepEqual(audioSources([spotify], [], 1000, NO_RULES), [
      { processName: 'Spotify.exe', exePath: 'C:\\Spotify\\Spotify.exe', title: 'Some Artist - Some Song', domain: null },
    ]);
  });

  it('uses the extension for Chrome, and never the window title (that is the tab in front)', () => {
    const sources = audioSources([chrome], [tab('https://www.youtube.com/watch?v=1', 'A podcast - YouTube')], 1000, NO_RULES);
    assert.deepEqual(sources, [{ processName: 'chrome.exe', exePath: 'C:\\Chrome\\chrome.exe', title: 'A podcast - YouTube', domain: 'youtube.com' }]);
    const stale = audioSources([chrome], [tab('https://youtube.com/', 'x', 0)], 60_000, NO_RULES);
    assert.deepEqual(stale, [{ processName: 'chrome.exe', exePath: 'C:\\Chrome\\chrome.exe', title: null, domain: null }]);
  });

  it('leaves out excluded apps, titles, and sites', () => {
    assert.deepEqual(audioSources([spotify], [], 0, { exclude: { apps: ['spotify'], titleContains: [], domains: [] } }), []);
    assert.deepEqual(audioSources([spotify], [], 0, { exclude: { apps: [], titleContains: ['some song'], domains: [] } }), []);
    const rules = { exclude: { apps: [], titleContains: [], domains: ['youtube.com'] } };
    assert.deepEqual(audioSources([chrome], [tab('https://m.youtube.com/', 'x')], 1000, rules), []);
  });
});

describe('AudioRecorder', () => {
  function fakeWriter() {
    const rows: { id: number; source: AudioSource; start: number; end: number }[] = [];
    const writer: AudioWriter = {
      startAudio: (source, start, end) => rows.push({ id: rows.length + 1, source, start, end }),
      extendAudio: (id, end) => {
        const row = rows.find((r) => r.id === id);
        if (row) row.end = end;
      },
    };
    return { rows, writer };
  }
  const music: AudioSource = { processName: 'Spotify.exe', exePath: null, title: 'Song', domain: null };

  it('extends a source that keeps playing and starts a row for a new one', () => {
    const { rows, writer } = fakeWriter();
    const recorder = new AudioRecorder(writer, 15_000);
    recorder.tick(0, [music]);
    recorder.tick(5000, [music]);
    recorder.tick(10_000, [music, { ...music, title: 'Next song' }]);
    assert.deepEqual(rows.map((r) => [r.source.title, r.start, r.end]), [['Song', 0, 10_000], ['Next song', 10_000, 10_000]]);
  });

  it('never bridges a gap: a source back after a long silence gets a new row', () => {
    const { rows, writer } = fakeWriter();
    const recorder = new AudioRecorder(writer, 15_000);
    recorder.tick(0, [music]);
    recorder.tick(5000, []);
    recorder.tick(10_000, [music]);
    recorder.tick(100_000, [music]);
    assert.deepEqual(rows.map((r) => [r.start, r.end]), [[0, 0], [10_000, 10_000], [100_000, 100_000]]);
  });
});
