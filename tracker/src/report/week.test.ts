import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DayFigures } from './week.ts';
import { clockOf, mondayOf, observations, weekTotals } from './week.ts';

const HOUR = 3600_000;
const start = (d: number) => new Date(2026, 10, d).getTime();

function figures(d: number, over: Partial<DayFigures> = {}): DayFigures {
  return {
    date: `2026-11-${String(d).padStart(2, '0')}`,
    past: true,
    activeMs: 4 * HOUR,
    focusMs: 2 * HOUR,
    distractionMs: HOUR,
    phoneMs: 0,
    sleep: { night: null, naps: [], napMs: 0, totalMs: 0 },
    mood: null,
    energy: null,
    tasksDone: 0,
    tasksTotal: 0,
    goalsMet: 0,
    goalsPartly: 0,
    goalsTotal: 0,
    gapMs: 0,
    focusByHour: Array.from({ length: 24 }, () => 0),
    ...over,
  };
}

const night = (d: number, bedHour: number, hours: number) => {
  const startMs = new Date(2026, 10, d, bedHour).getTime();
  return { night: { start: startMs, end: startMs + hours * HOUR, ms: hours * HOUR, source: 'logged' as const }, naps: [], napMs: 0, totalMs: hours * HOUR };
};

describe('weekly review', () => {
  it('finds the Monday of any day, across a month end', () => {
    assert.equal(mondayOf('2026-11-10'), '2026-11-09');
    assert.equal(mondayOf('2026-11-09'), '2026-11-09');
    assert.equal(mondayOf('2026-11-15'), '2026-11-09');
    assert.equal(mondayOf('2026-11-01'), '2026-10-26');
  });

  it('averages over the days that have data, and leaves future days out', () => {
    const days = [
      figures(9, { mood: 4, energy: 3, sleep: night(8, 23, 7), tasksDone: 1, tasksTotal: 2 }),
      figures(10, { mood: 2, focusMs: 4 * HOUR, sleep: night(10, 1, 6), goalsMet: 1, goalsTotal: 2 }),
      figures(11, { activeMs: 0, focusMs: 0, distractionMs: 0 }),
      figures(12, { past: false, activeMs: 0, mood: 5 }),
    ];
    const t = weekTotals(days, [9, 10, 11, 12].map(start));
    assert.deepEqual(t.focusMs, { value: 3 * HOUR, days: 2 });
    assert.deepEqual(t.mood, { value: 3, days: 2 });
    assert.deepEqual(t.sleepMs, { value: 6.5 * HOUR, days: 2 });
    // 23:00 the evening before and 01:00: on average midnight, an hour either way.
    assert.deepEqual(t.bedtime, { minutes: 0, spread: 60 });
    assert.equal(clockOf(-60), '23:00');
    assert.equal(t.tasksDone, 1);
    assert.equal(t.goalsTotal, 2);
  });

  it('only compares groups of days it has enough of', () => {
    const focusAt10 = Array.from({ length: 24 }, (_, h) => (h === 10 || h === 11 ? HOUR : 0));
    const days = [
      figures(9, { sleep: night(8, 23, 8), focusMs: 3 * HOUR, focusByHour: focusAt10 }),
      figures(10, { sleep: night(9, 23, 8), focusMs: 3 * HOUR }),
      figures(11, { sleep: night(11, 2, 5), focusMs: HOUR }),
    ];
    const t = weekTotals(days, [9, 10, 11].map(start));
    const said = observations(days, t);
    assert.ok(said.some((s) => s.startsWith('Your most focused day was Monday')));
    assert.ok(said.some((s) => s.includes('between 10:00 and 12:00')));
    // Only one short night: no sleep comparison yet.
    assert.ok(!said.some((s) => s.startsWith('After nights under')));

    days.push(figures(12, { sleep: night(12, 3, 4), focusMs: HOUR }));
    const more = observations(days, weekTotals(days, [9, 10, 11, 12].map(start)));
    assert.ok(more.includes('After nights under 6h30m you focused 1h00m a day on average, against 3h00m after longer nights.'));
    assert.ok(more.includes('You went to bed after 01:00 on 2 nights.'));
  });

  it('averages phone time over the days it was logged, and sets it against focus', () => {
    const days = [figures(9, { phoneMs: 7 * HOUR }), figures(10, { phoneMs: 5 * HOUR }), figures(11)];
    const t = weekTotals(days, [9, 10, 11].map(start));
    assert.deepEqual(t.phoneMs, { value: 6 * HOUR, days: 2 });
    assert.ok(observations(days, t).includes('You logged 6h00m a day on your phone (2 days logged), against 2h00m focused at the PC.'));
  });
});
