import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nightWindow, sleepFor } from './sleep.ts';

/** Local time; day 10 is Tuesday 10 November 2026, day 9 the evening before. */
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const DAY = at(10, 0);
const NOW = at(10, 23);
const sleep = (start: number, end: number) => ({ start, end, category: 'sleep' });

describe('sleep', () => {
  it('looks for the night from 18:00 the evening before to 14:00', () => {
    assert.deepEqual(nightWindow(DAY), { start: at(9, 18), end: at(10, 14) });
  });

  it('uses logged sleep, joining a night the evening log split at midnight', () => {
    const result = sleepFor(DAY, [sleep(at(9, 23, 30), at(10, 0)), sleep(at(10, 0), at(10, 6, 30))], [], NOW);
    assert.deepEqual(result.night, { start: at(9, 23, 30), end: at(10, 6, 30), ms: 7 * 3600_000, source: 'logged' });
    assert.equal(result.totalMs, 7 * 3600_000);
  });

  it('counts sleep later in the day as naps, and adds them in', () => {
    const result = sleepFor(DAY, [sleep(at(10, 0, 44), at(10, 6, 47)), sleep(at(10, 16, 40), at(10, 18))], [], NOW);
    assert.equal(result.night?.source, 'logged');
    assert.deepEqual(result.naps, [{ start: at(10, 16, 40), end: at(10, 18) }]);
    assert.equal(result.napMs, 80 * 60_000);
    assert.equal(result.totalMs, result.night!.ms + 80 * 60_000);
  });

  it("leaves tonight's sleep to tomorrow", () => {
    const result = sleepFor(DAY, [sleep(at(10, 23), at(11, 7))], [], at(11, 9));
    assert.equal(result.night, null);
    assert.deepEqual(result.naps, []);
  });

  it('estimates from the longest night-time stretch without PC use', () => {
    const active = [{ start: at(9, 20), end: at(10, 0, 30) }, { start: at(10, 7, 15), end: at(10, 9) }];
    const result = sleepFor(DAY, [], active, NOW);
    assert.deepEqual(result.night, { start: at(10, 0, 30), end: at(10, 7, 15), ms: 6.75 * 3600_000, source: 'estimated' });
  });

  it("doesn't count logged time out as sleep, or a short quiet stretch", () => {
    const active = [{ start: at(9, 20), end: at(9, 23) }, { start: at(10, 1), end: at(10, 2) }, { start: at(10, 8), end: at(10, 9) }];
    // Out from 23:00 to 01:00, then a 6-hour stretch.
    const result = sleepFor(DAY, [{ start: at(9, 23), end: at(10, 1), category: 'social' }], active, NOW);
    assert.deepEqual(result.night && [result.night.start, result.night.end], [at(10, 2), at(10, 8)]);
    const quiet = sleepFor(DAY, [], [{ start: at(9, 20), end: at(10, 5) }, { start: at(10, 7), end: at(10, 9) }], NOW);
    assert.equal(quiet.night, null);
  });

  it("won't estimate a stretch so long it must include time out", () => {
    // Last on the PC at 00:44, then out all morning until 13:28.
    const active = [{ start: at(9, 22), end: at(10, 0, 44) }, { start: at(10, 13, 28), end: at(10, 15) }];
    assert.equal(sleepFor(DAY, [], active, NOW).night, null);
  });

  it("won't guess when bedtime or waking is out of sight", () => {
    // No PC use all evening: when did you go to bed?
    assert.equal(sleepFor(DAY, [], [{ start: at(10, 8), end: at(10, 9) }], NOW).night, null);
    // Still asleep (or away) at the moment.
    assert.equal(sleepFor(DAY, [], [{ start: at(9, 22), end: at(9, 23) }], at(10, 6)).night, null);
  });
});
