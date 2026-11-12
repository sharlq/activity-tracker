import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReminderSchedule, ReturnState } from './planner.ts';
import { DEFAULT_SETTINGS, detectReturn, dueSlot, eveningDue, IDLE_RETURN_MS, jobWindow, mergeSettings, morningDue, nextSlot, parseSchedule, projectReminderDue, slotsUntil } from './planner.ts';

describe('coming back to the PC', () => {
  const MIN = 60_000;
  const GAP = 15 * MIN;
  const seen = (lastSeenInputAt: number, wentAway = false): ReturnState => ({ lastSeenInputAt, wentAway });

  it('asks after a locked stretch of at least the shortest gap, from the last input before it', () => {
    let state = seen(at(14));
    ({ state } = detectReturn(state, { lastInputAt: at(14), locked: true, tickGap: false }, GAP));
    assert.equal(state.wentAway, true);
    const back = detectReturn(state, { lastInputAt: at(14, 20), locked: false, tickGap: false }, GAP);
    assert.deepEqual(back.away, { start: at(14), end: at(14, 20) });
    assert.deepEqual(back.state, seen(at(14, 20)));
  });

  it('counts sleep or the PC being off like locking', () => {
    const back = detectReturn(seen(at(9)), { lastInputAt: at(9, 30), locked: false, tickGap: true }, GAP);
    assert.deepEqual(back.away, { start: at(9), end: at(9, 30) });
  });

  it("doesn't ask about short breaks", () => {
    assert.equal(detectReturn(seen(at(9), true), { lastInputAt: at(9, 10), locked: false, tickGap: false }, GAP).away, null);
  });

  it('waits longer when the PC was left on and unlocked, since you may have been reading', () => {
    assert.equal(detectReturn(seen(at(9)), { lastInputAt: at(9, 30), locked: false, tickGap: false }, GAP).away, null);
    const later = detectReturn(seen(at(9)), { lastInputAt: at(9) + IDLE_RETURN_MS, locked: false, tickGap: false }, GAP);
    assert.deepEqual(later.away, { start: at(9), end: at(9) + IDLE_RETURN_MS });
  });

  it('starts quietly with no history, and does nothing while you keep working', () => {
    const first = detectReturn({ lastSeenInputAt: null, wentAway: true }, { lastInputAt: at(9), locked: false, tickGap: false }, GAP);
    assert.equal(first.away, null);
    const working = detectReturn(seen(at(9)), { lastInputAt: at(9, 0) + 5000, locked: false, tickGap: false }, GAP);
    assert.equal(working.away, null);
  });

  it('is a setting: window, toast, or off', () => {
    assert.equal(DEFAULT_SETTINGS.back.mode, 'window');
    assert.equal(mergeSettings(DEFAULT_SETTINGS, { back: { mode: 'toast' } }).back.mode, 'toast');
    assert.throws(() => mergeSettings(DEFAULT_SETTINGS, { back: { mode: 'loud' } }));
  });
});

/** Local time on Tuesday 10 November 2026. */
const at = (h: number, m = 0, day = 10) => new Date(2026, 10, day, h, m).getTime();
const hourly: ReminderSchedule = { type: 'every', minutes: 60, from: '09:00', until: '22:00', days: [] };
const pills: ReminderSchedule = { type: 'at', times: ['09:00', '21:00'], days: [] };

describe('reminder slots', () => {
  it('counts "every" slots from the start of the window', () => {
    assert.deepEqual(slotsUntil(hourly, at(11, 30)), [at(9), at(10), at(11)]);
    assert.deepEqual(slotsUntil(hourly, at(8, 59)), []);
    assert.equal(slotsUntil(hourly, at(23, 30)).at(-1), at(22));
  });

  it('lists the set times that have passed', () => {
    assert.deepEqual(slotsUntil(pills, at(12)), [at(9)]);
    assert.deepEqual(slotsUntil(pills, at(21)), [at(9), at(21)]);
  });

  it('skips days that are not chosen', () => {
    const weekends = { ...pills, days: [0, 6] };
    assert.deepEqual(slotsUntil(weekends, at(12)), []); // Tuesday
    assert.deepEqual(slotsUntil(weekends, at(12, 0, 14)), [at(9, 0, 14)]); // Saturday
  });
});

describe('dueSlot', () => {
  const reminder = (lastFiredAt: number | null, createdAt = at(8)) => ({ enabled: true, schedule: hourly, lastFiredAt, createdAt });

  it('fires once for the latest slot since it last fired', () => {
    assert.equal(dueSlot(reminder(null), at(9, 0)), at(9));
    assert.equal(dueSlot(reminder(at(9)), at(9, 30)), null);
    assert.equal(dueSlot(reminder(at(9)), at(10)), at(10));
  });

  it('fires one reminder, not a burst, after the PC slept through several slots', () => {
    assert.equal(dueSlot(reminder(at(9)), at(13, 20)), at(13));
  });

  it('never fires for a slot before it was created', () => {
    assert.equal(dueSlot(reminder(null, at(10, 30)), at(10, 45)), null);
    assert.equal(dueSlot(reminder(null, at(10, 30)), at(11)), at(11));
  });

  it('never fires when off, or for yesterday', () => {
    assert.equal(dueSlot({ ...reminder(null), enabled: false }, at(12)), null);
    assert.equal(dueSlot(reminder(at(22, 0, 9), at(8, 0, 9)), at(8, 30)), null);
  });
});

describe('nextSlot', () => {
  it('finds the next slot today or on a later day', () => {
    assert.equal(nextSlot(pills, at(12)), at(21));
    assert.equal(nextSlot(pills, at(21, 30)), at(9, 0, 11));
    assert.equal(nextSlot({ ...pills, days: [6] }, at(12)), at(9, 0, 14));
  });
});

describe('parseSchedule', () => {
  it('accepts valid schedules and fills in defaults', () => {
    assert.deepEqual(parseSchedule({ type: 'every', minutes: 30 }), { type: 'every', minutes: 30, from: '00:00', until: '24:00', days: [] });
    assert.deepEqual(parseSchedule({ type: 'at', times: ['21:00', '09:00', '09:00'], days: [5, 1] }), { type: 'at', times: ['09:00', '21:00'], days: [1, 5] });
  });

  it('rejects nonsense with a readable message', () => {
    assert.throws(() => parseSchedule({ type: 'every', minutes: 0 }), /whole number of minutes/);
    assert.throws(() => parseSchedule({ type: 'every', minutes: 5, from: '10:00', until: '09:00' }), /before the end/);
    assert.throws(() => parseSchedule({ type: 'at', times: ['25:00'] }), /not a time/);
    assert.throws(() => parseSchedule({ type: 'at', times: [] }), /at least one time/);
    assert.throws(() => parseSchedule({ type: 'sometimes' }), /either/);
  });
});

describe('morning and evening', () => {
  const none = { morningShown: null, eveningShown: null, projectsReminded: null };

  it('opens the morning page once, the first time you are at the PC in the window', () => {
    assert.equal(morningDue(DEFAULT_SETTINGS, none, at(7, 59), true), false);
    assert.equal(morningDue(DEFAULT_SETTINGS, none, at(8, 30), false), false); // Not at the PC.
    assert.equal(morningDue(DEFAULT_SETTINGS, none, at(8, 30), true), true);
    assert.equal(morningDue(DEFAULT_SETTINGS, { ...none, morningShown: '2026-11-10' }, at(9), true), false);
    assert.equal(morningDue(DEFAULT_SETTINGS, { ...none, morningShown: '2026-11-09' }, at(10, 30), true), true);
    assert.equal(morningDue(DEFAULT_SETTINGS, none, at(12), true), false);
  });

  it('sends the evening log at the set time, or the first time after it the PC is in use', () => {
    assert.equal(eveningDue(DEFAULT_SETTINGS, none, at(21, 59), true), false);
    assert.equal(eveningDue(DEFAULT_SETTINGS, none, at(22), true), true);
    assert.equal(eveningDue(DEFAULT_SETTINGS, none, at(22, 59), true), true);
    assert.equal(eveningDue(DEFAULT_SETTINGS, { ...none, eveningShown: '2026-11-10' }, at(22, 30), true), false);
    assert.equal(eveningDue({ ...DEFAULT_SETTINGS, evening: { enabled: false, at: '22:00', lateAfter: '23:00' } }, none, at(22, 30), true), false);
  });

  it('leaves the evening log for the morning page when you only get to the PC late', () => {
    // On 11 Nov the PC was off from 17:00 and the 22:00 log came at 23:31.
    assert.equal(eveningDue(DEFAULT_SETTINGS, none, at(23), true), false);
    assert.equal(eveningDue(DEFAULT_SETTINGS, none, at(23, 31), true), false);
    // A cut-off at or before the evening time switches it off: the old behaviour.
    assert.equal(eveningDue({ ...DEFAULT_SETTINGS, evening: { enabled: true, at: '22:00', lateAfter: '22:00' } }, none, at(23, 40), true), true);
    assert.equal(mergeSettings(DEFAULT_SETTINGS, { evening: { lateAfter: '23:30' } }).evening.lateAfter, '23:30');
  });

  it('merges settings from the UI, keeping what is not mentioned', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { evening: { at: '21:30' }, gaps: { minMinutes: 30 } });
    assert.equal(merged.evening.at, '21:30');
    assert.equal(merged.evening.enabled, true);
    assert.equal(merged.gaps.minMinutes, 30);
    assert.deepEqual(merged.morning, DEFAULT_SETTINGS.morning);
    assert.throws(() => mergeSettings(DEFAULT_SETTINGS, { morning: { from: '13:00' } }), /start before/);
    assert.throws(() => mergeSettings(DEFAULT_SETTINGS, { gaps: { minMinutes: 0 } }), /1 to 240/);
  });
});

describe('the project reminder', () => {
  const none = { morningShown: null, eveningShown: null, projectsReminded: null };
  const on = mergeSettings(DEFAULT_SETTINGS, { projects: { reminder: { enabled: true, at: '20:30' } } });

  it('is off unless switched on in Settings', () => {
    assert.equal(projectReminderDue(DEFAULT_SETTINGS, none, at(23), true), false);
  });

  it('goes out once a day at its time, and not after the evening log', () => {
    assert.equal(projectReminderDue(on, none, at(20, 29), true), false);
    assert.equal(projectReminderDue(on, none, at(20, 30), true), true);
    assert.equal(projectReminderDue(on, none, at(21), false), false);
    assert.equal(projectReminderDue(on, { ...none, projectsReminded: '2026-11-10' }, at(21), true), false);
    assert.equal(projectReminderDue(on, { ...none, eveningShown: '2026-11-10' }, at(22, 30), true), false);
  });

  it('checks the project settings', () => {
    assert.equal(mergeSettings(DEFAULT_SETTINGS, { projects: { neglectAfterDays: 5 } }).projects.neglectAfterDays, 5);
    assert.equal(mergeSettings(on, {}).projects.reminder.at, '20:30');
    assert.throws(() => mergeSettings(DEFAULT_SETTINGS, { projects: { neglectAfterDays: 0 } }), /1 to 60/);
    assert.throws(() => mergeSettings(DEFAULT_SETTINGS, { projects: { reminder: { at: 'soon' } } }));
  });

  it('highlights job hours on job days only', () => {
    const tuesday = new Date(2026, 10, 10).getTime();
    const friday = new Date(2026, 10, 13).getTime();
    assert.deepEqual(jobWindow(DEFAULT_SETTINGS, tuesday), { start: new Date(2026, 10, 10, 7).getTime(), end: new Date(2026, 10, 10, 16).getTime() });
    assert.equal(jobWindow(DEFAULT_SETTINGS, friday), null);
    const everyDay = mergeSettings(DEFAULT_SETTINGS, { job: { days: [], from: '08:30' } });
    assert.equal(jobWindow(everyDay, friday)?.start, new Date(2026, 10, 13, 8, 30).getTime());
    assert.equal(jobWindow(mergeSettings(DEFAULT_SETTINGS, { job: { enabled: false } }), tuesday), null);
    assert.throws(() => mergeSettings(DEFAULT_SETTINGS, { job: { from: '17:00' } }), /start before/);
  });
});
