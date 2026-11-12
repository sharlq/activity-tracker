import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ScreenEvent } from '../journal.ts';
import type { CategoryConfig } from './categories.ts';
import type { Segment } from './report.ts';
import { otherScreens, visibleStretches } from './screens.ts';

const MIN = 60_000;
const CONFIG: CategoryConfig = { focus: ['work'], distraction: ['video'], rules: [] };
const seg = (start: number, end: number, category: Segment['category'], detail: string): Segment => ({
  start: start * MIN,
  end: end * MIN,
  category,
  detail,
  app: detail,
  domain: null,
  game: null,
});
let id = 0;
const shown = (start: number, end: number, screen: number, processName: string, title: string | null = null, domain: string | null = null): ScreenEvent => ({
  id: ++id,
  start: start * MIN,
  end: end * MIN,
  source: { screen, processName, exePath: null, title, domain },
});

describe('visibleStretches', () => {
  it('joins the same window on the same screen across short breaks, and drops a passing glimpse', () => {
    const stretches = visibleStretches([shown(0, 10, 1, 'WINWORD.EXE', 'Notes'), shown(10.5, 20, 1, 'WINWORD.EXE', 'Notes'), shown(30, 30.2, 2, 'notepad.exe')], CONFIG, []);
    assert.equal(stretches.length, 1);
    assert.equal(stretches[0]?.end, 20 * MIN);
    assert.equal(stretches[0]?.title, 'Notes');
  });

  it('keeps each screen apart', () => {
    const stretches = visibleStretches([shown(0, 10, 1, 'WINWORD.EXE'), shown(0, 10, 2, 'WINWORD.EXE')], CONFIG, []);
    assert.deepEqual(stretches.map((s) => s.screen), [1, 2]);
  });
});

describe('otherScreens', () => {
  const segments = [seg(0, 30, 'work', 'code'), seg(30, 60, 'idle', 'code')];
  const events = [shown(0, 60, 2, 'chrome.exe', 'Lecture 4 - YouTube', 'youtube.com'), shown(0, 30, 3, 'code.exe')];
  const result = otherScreens(segments, events, CONFIG, [], 'day');

  it('breaks the time down per screen', () => {
    assert.deepEqual(result.byScreen.map((s) => [s.screen, s.ms]), [
      [2, 60 * MIN],
      [3, 30 * MIN],
    ]);
    assert.equal(result.screens, 2);
  });

  it('pairs what was in front with what was beside it, but not the same thing twice', () => {
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0]?.doing, 'code');
    assert.equal(result.pairs[0]?.visible, 'youtube.com');
    assert.equal(result.pairs[0]?.ms, 30 * MIN);
  });

  it('shows what was up while the PC sat idle', () => {
    assert.deepEqual(result.whileIdle.map((i) => [i.name, i.ms]), [['youtube.com', 30 * MIN]]);
  });

  it('leaves the stretch list out of week reports', () => {
    assert.deepEqual(otherScreens(segments, events, CONFIG, [], 'week').stretches, []);
  });
});
