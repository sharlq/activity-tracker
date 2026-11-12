import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeSchedule, parseSpan } from './journalCli.ts';

describe('parseSpan', () => {
  it('reads a span on the given day, with or without leading zeros', () => {
    assert.deepEqual(parseSpan('7:15-09:00', '2026-11-10'), { start: new Date(2026, 10, 10, 7, 15).getTime(), end: new Date(2026, 10, 10, 9).getTime() });
  });

  it('runs past midnight when the end is before the start', () => {
    assert.deepEqual(parseSpan('23:30-01:00', '2026-11-10'), { start: new Date(2026, 10, 10, 23, 30).getTime(), end: new Date(2026, 10, 11, 1).getTime() });
  });

  it('rejects what is not a span of times', () => {
    assert.throws(() => parseSpan('noon', '2026-11-10'), /time span/);
    assert.throws(() => parseSpan('25:00-26:00', '2026-11-10'), /not a time/);
  });
});

describe('describeSchedule', () => {
  it('says when a reminder goes off', () => {
    assert.equal(describeSchedule({ type: 'at', times: ['09:00', '21:00'], days: [] }), 'at 09:00, 21:00, every day');
    assert.equal(describeSchedule({ type: 'every', minutes: 90, from: '09:00', until: '22:00', days: [1, 2, 3, 4, 5] }), 'every 90m from 09:00 to 22:00, weekdays');
  });
});
