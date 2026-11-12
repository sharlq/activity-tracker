import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Activity, OpenEvent, Op, Tick } from './merger.ts';
import { EventMerger } from './merger.ts';

const MAX_GAP = 15_000;
const app = (title: string, processName = 'code.exe'): Activity => ({
  kind: 'window',
  processName,
  exePath: `C:\\apps\\${processName}`,
  title,
});
const IDLE: Activity = { kind: 'idle' };

/** Replays ticks and returns the resulting event list, as the store would hold it. */
function play(
  ticks: Array<Partial<Tick> & Pick<Tick, 'at' | 'activity'>>,
  resume: OpenEvent | null = null,
): OpenEvent[] {
  const merger = new EventMerger(MAX_GAP, resume);
  const events: OpenEvent[] = resume ? [{ ...resume }] : [];
  for (const tick of ticks) {
    const { ops } = merger.tick({ lastInputAt: tick.at, ...tick });
    applyOps(events, ops);
  }
  return events;
}

/** Heartbeats every 5s from `from` to `to` inclusive, so no gap appears between them. */
function beats(from: number, to: number, activity: Activity, lastInputAt: number): Tick[] {
  const ticks: Tick[] = [];
  for (let at = from; at <= to; at += 5000) ticks.push({ at, activity, lastInputAt });
  return ticks;
}

function applyOps(events: OpenEvent[], ops: Op[]): void {
  for (const op of ops) {
    if (op.type === 'start') events.push({ activity: op.activity, start: op.start, end: op.end });
    else (events.at(-1) as OpenEvent).end = op.end;
  }
}

describe('EventMerger: merging', () => {
  it('merges consecutive identical heartbeats into one event', () => {
    const a = app('main.ts');
    assert.deepEqual(
      play([
        { at: 0, activity: a },
        { at: 5000, activity: a },
        { at: 10_000, activity: a },
      ]),
      [{ activity: a, start: 0, end: 10_000 }],
    );
  });

  it('treats a changed title as a new event, with no hole between them', () => {
    const [a, b] = [app('a.ts'), app('b.ts')];
    assert.deepEqual(
      play([
        { at: 0, activity: a },
        { at: 5000, activity: a },
        { at: 10_000, activity: b },
      ]),
      [
        { activity: a, start: 0, end: 10_000 },
        { activity: b, start: 10_000, end: 10_000 },
      ],
    );
  });

  it('treats a different process with the same title as a new event', () => {
    const events = play([
      { at: 0, activity: app('same', 'one.exe') },
      { at: 5000, activity: app('same', 'two.exe') },
    ]);
    assert.equal(events.length, 2);
  });

  it('merges when a brief missing foreground window interrupts the same app', () => {
    const a = app('main.ts');
    assert.deepEqual(
      play([
        { at: 0, activity: a },
        { at: 5000, activity: 'unchanged' },
        { at: 10_000, activity: a },
      ]),
      [{ activity: a, start: 0, end: 10_000 }],
    );
  });

  it('starts nothing when there is no foreground window and nothing open', () => {
    assert.deepEqual(play([{ at: 0, activity: 'unchanged' }]), []);
  });
});

describe('EventMerger: gaps', () => {
  it('does not bridge sleep: the old event ends at its last heartbeat', () => {
    const a = app('main.ts');
    const hourLater = 5000 + 3_600_000;
    assert.deepEqual(
      play([
        { at: 0, activity: a },
        { at: 5000, activity: a },
        { at: hourLater, activity: a },
      ]),
      [
        { activity: a, start: 0, end: 5000 },
        { activity: a, start: hourLater, end: hourLater },
      ],
    );
  });

  it('reports the length of the gap', () => {
    const merger = new EventMerger(MAX_GAP);
    const a = app('x');
    assert.equal(merger.tick({ at: 0, activity: a, lastInputAt: 0 }).gapMs, null);
    assert.equal(merger.tick({ at: 5000, activity: a, lastInputAt: 0 }).gapMs, null);
    assert.equal(merger.tick({ at: 65_000, activity: a, lastInputAt: 0 }).gapMs, 60_000);
  });

  it('treats a silence of exactly the limit as continuous and just over as a gap', () => {
    const a = app('x');
    assert.equal(play([{ at: 0, activity: a }, { at: MAX_GAP, activity: a }]).length, 1);
    assert.equal(play([{ at: 0, activity: a }, { at: MAX_GAP + 1, activity: a }]).length, 2);
  });

  it('does not produce a negative event when the clock jumps backwards', () => {
    const a = app('x');
    const events = play([
      { at: 100_000, activity: a },
      { at: 50_000, activity: a },
    ]);
    assert.equal(events.length, 2);
    for (const event of events) assert.ok(event.end >= event.start);
  });

  it('does not extend across a gap via a no-foreground tick', () => {
    const a = app('x');
    assert.deepEqual(
      play([
        { at: 0, activity: a },
        { at: 3_600_000, activity: 'unchanged' },
      ]),
      [{ activity: a, start: 0, end: 0 }],
    );
  });
});

describe('EventMerger: lock and exclusions', () => {
  it('closes the open event and records nothing while activity is null', () => {
    const a = app('main.ts');
    assert.deepEqual(
      play([
        { at: 0, activity: a },
        { at: 5000, activity: a },
        { at: 10_000, activity: null },
        { at: 15_000, activity: null },
        { at: 20_000, activity: a },
      ]),
      [
        { activity: a, start: 0, end: 5000 },
        { activity: a, start: 20_000, end: 20_000 },
      ],
    );
  });

  it('leaves no zero-length trace of an excluded app between two windows', () => {
    const [a, b] = [app('a'), app('b')];
    assert.deepEqual(
      play([
        { at: 0, activity: a },
        { at: 5000, activity: null },
        { at: 10_000, activity: b },
      ]),
      [
        { activity: a, start: 0, end: 0 },
        { activity: b, start: 10_000, end: 10_000 },
      ],
    );
  });
});

describe('EventMerger: idle', () => {
  it('backdates idle to the last input and shortens the window event to match', () => {
    const a = app('main.ts');
    assert.deepEqual(
      play([...beats(0, 120_000, a, 1000), { at: 125_000, activity: IDLE, lastInputAt: 1000 }]),
      [
        { activity: a, start: 0, end: 1000 },
        { activity: IDLE, start: 1000, end: 125_000 },
      ],
    );
  });

  it('never moves idle earlier than the start of the open event', () => {
    const [a, popup] = [app('main.ts'), app('popup')];
    assert.deepEqual(
      play([
        ...beats(0, 55_000, a, 0),
        ...beats(60_000, 120_000, popup, 0),
        { at: 125_000, activity: IDLE, lastInputAt: 0 },
      ]),
      [
        { activity: a, start: 0, end: 60_000 },
        { activity: popup, start: 60_000, end: 60_000 },
        { activity: IDLE, start: 60_000, end: 125_000 },
        // The popup keeps zero length: it appeared with nobody there to see it.
      ],
    );
  });

  it('merges idle ticks into one event', () => {
    assert.deepEqual(
      play([
        { at: 0, activity: IDLE, lastInputAt: -200_000 },
        { at: 5000, activity: IDLE, lastInputAt: -200_000 },
        { at: 10_000, activity: IDLE, lastInputAt: -200_000 },
      ]),
      [{ activity: IDLE, start: 0, end: 10_000 }],
    );
  });

  it('ends idle when input returns, with no hole', () => {
    const a = app('main.ts');
    assert.deepEqual(
      play([
        { at: 0, activity: IDLE },
        { at: 5000, activity: IDLE },
        { at: 10_000, activity: a },
      ]),
      [
        { activity: IDLE, start: 0, end: 10_000 },
        { activity: a, start: 10_000, end: 10_000 },
      ],
    );
  });

  it('does not backdate idle across a gap, so idle cannot cover a sleep', () => {
    const a = app('main.ts');
    const wake = 7_200_000;
    assert.deepEqual(
      play([
        { at: 0, activity: a, lastInputAt: 0 },
        { at: 5000, activity: a, lastInputAt: 5000 },
        { at: wake, activity: IDLE, lastInputAt: 5000 },
      ]),
      [
        { activity: a, start: 0, end: 5000 },
        { activity: IDLE, start: wake, end: wake },
      ],
    );
  });

  it('clamps a last-input time from the future, so an event never ends past now', () => {
    const a = app('main.ts');
    const events = play([
      { at: 0, activity: a },
      { at: 5000, activity: IDLE, lastInputAt: 9000 },
    ]);
    assert.equal((events[0] as OpenEvent).end, 5000);
    assert.equal((events[1] as OpenEvent).start, 5000);
  });
});

describe('EventMerger: resuming after a restart', () => {
  const a = app('main.ts');
  const resume: OpenEvent = { activity: a, start: 0, end: 100_000 };

  it('continues the stored event after a quick restart', () => {
    assert.deepEqual(play([{ at: 105_000, activity: a }], resume), [
      { activity: a, start: 0, end: 105_000 },
    ]);
  });

  it('starts a new event if the tracker was down for longer than the limit', () => {
    assert.deepEqual(play([{ at: 500_000, activity: a }], resume), [
      { activity: a, start: 0, end: 100_000 },
      { activity: a, start: 500_000, end: 500_000 },
    ]);
  });
});

describe('EventMerger: idle with what was on screen', () => {
  const claude = { processName: 'claude.exe', exePath: 'C:\\c\\claude.exe', title: 'Claude' };
  const idleOn = (window: typeof claude, title = window.title): Activity => ({ kind: 'idle', window: { ...window, title } });

  it('keeps one idle event while the same app stays in front, even if its title changes', () => {
    const events = play([
      { at: 0, activity: idleOn(claude) },
      { at: 5000, activity: idleOn(claude, '(1) Claude') },
      { at: 10_000, activity: idleOn(claude, '(2) Claude') },
    ]);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.end, 10_000);
  });

  it('starts a new idle event when another app comes to the front, without backdating it', () => {
    const popup = { processName: 'Teams.exe', exePath: 'C:\\t\\Teams.exe', title: 'Teams' };
    const events = play([
      { at: 0, activity: idleOn(claude), lastInputAt: -300_000 },
      { at: 5000, activity: idleOn(claude), lastInputAt: -300_000 },
      { at: 10_000, activity: idleOn(popup), lastInputAt: -300_000 },
    ]);
    assert.deepEqual(events.map((e) => [e.start, e.end]), [[0, 10_000], [10_000, 10_000]]);
  });

  it('still backdates going idle from active work to the last input', () => {
    const a = app('main.ts');
    const events = play([...beats(0, 120_000, a, 1000), { at: 125_000, activity: idleOn(claude), lastInputAt: 1000 }]);
    assert.deepEqual(events.map((e) => [e.activity.kind, e.start, e.end]), [['window', 0, 1000], ['idle', 1000, 125_000]]);
  });

  it('treats idle with nothing in front as different from idle with an app', () => {
    const events = play([{ at: 0, activity: IDLE }, { at: 5000, activity: idleOn(claude) }]);
    assert.equal(events.length, 2);
  });
});
