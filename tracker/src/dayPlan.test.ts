import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blockOutcome, comparePlan } from './dayPlan.ts';
import type { Entry, PlanBlock } from './journal.ts';
import type { Segment } from './report/index.ts';

const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m).getTime();
const block = (id: number, from: number, until: number, label: string, category: string | null): PlanBlock => ({ id, day: '2026-11-12', start: from, end: until, label, category });
const seg = (from: number, until: number, category: Segment['category'], detail: string = category): Segment => ({ start: from, end: until, category, detail, app: null, domain: null, game: null });
const entry = (from: number, until: number, label: string, category: string | null): Entry => ({ id: 1, start: from, end: until, label, category });
const FOCUS = ['work', 'learning', 'debate'];
const MIN = 60_000;

describe('blockOutcome', () => {
  it('keeps a block spent on its category, and names what filled it', () => {
    const o = blockOutcome(block(1, at(9), at(11), 'Study AWS', 'study'), [seg(at(9), at(10, 30), 'learning', 'aws.amazon.com'), seg(at(10, 30), at(11), 'video', 'YouTube')], [], at(12), FOCUS);
    assert.equal(o.status, 'kept');
    assert.equal(o.keptMs, 90 * MIN);
    assert.deepEqual(o.actual.map((a) => [a.name, a.ms / MIN, a.kept]), [['aws.amazon.com', 90, true], ['YouTube', 30, false]]);
    assert.equal(o.unknownMs, 0);
  });

  it('marks a block mostly spent on something else as missed, and partly in between', () => {
    const missed = blockOutcome(block(1, at(9), at(10), 'Work', 'work'), [seg(at(9), at(9, 50), 'video')], [], at(12), FOCUS);
    assert.equal(missed.status, 'missed');
    const partly = blockOutcome(block(1, at(9), at(10), 'Work', 'work'), [seg(at(9), at(9, 20), 'work'), seg(at(9, 20), at(10), 'video')], [], at(12), FOCUS);
    assert.equal(partly.status, 'partly');
  });

  it('lets what you logged win over the screen, and counts idle as unknown', () => {
    const o = blockOutcome(
      block(1, at(18), at(19), 'Gym', 'exercise'),
      [seg(at(18), at(19), 'video', 'Netflix'), seg(at(18), at(19), 'idle')],
      [entry(at(18), at(18, 45), 'Gym', 'exercise')],
      at(20),
      FOCUS,
    );
    assert.equal(o.keptMs, 45 * MIN);
    assert.equal(o.status, 'kept');
    // Netflix was on screen for the last 15 minutes only, once the logged gym time is cut out.
    assert.deepEqual(o.actual.map((a) => [a.name, a.ms / MIN]), [['Gym', 45], ['Netflix', 15]]);
  });

  it('matches by label when the block has no category', () => {
    const o = blockOutcome(block(1, at(14), at(15), 'Debate prep', null), [], [entry(at(14), at(15), 'debate prep with the team', null)], at(16), FOCUS);
    assert.equal(o.status, 'kept');
  });

  it('treats "focus" as any focused work, and study as learning', () => {
    const o = blockOutcome(block(1, at(9), at(10), 'Deep work', 'focus'), [seg(at(9), at(9, 30), 'debate'), seg(at(9, 30), at(10), 'work')], [], at(11), FOCUS);
    assert.equal(o.keptMs, 60 * MIN);
  });

  it('is upcoming before it starts and "now" while it runs, measured so far', () => {
    assert.equal(blockOutcome(block(1, at(15), at(16), 'Work', 'work'), [], [], at(14), FOCUS).status, 'upcoming');
    const now = blockOutcome(block(1, at(15), at(17), 'Work', 'work'), [seg(at(15), at(15, 30), 'work')], [], at(15, 30), FOCUS);
    assert.equal(now.status, 'now');
    assert.equal(now.elapsedMs, 30 * MIN);
  });

  it('counts overlapping entries once', () => {
    const o = blockOutcome(block(1, at(12), at(13), 'Lunch', 'meal'), [], [entry(at(12), at(13), 'Lunch', 'meal'), entry(at(12), at(12, 30), 'Lunch with Sara', 'meal')], at(14), FOCUS);
    assert.equal(o.keptMs, 60 * MIN);
  });
});

describe('comparePlan', () => {
  it('sums the day: share of elapsed planned time kept, and the count of each outcome', () => {
    const pc = comparePlan(
      [block(1, at(9), at(10), 'Work', 'work'), block(2, at(10), at(11), 'Study', 'study'), block(3, at(20), at(21), 'Gym', 'exercise')],
      [seg(at(9), at(10), 'work'), seg(at(10), at(11), 'video')],
      [],
      at(12),
      FOCUS,
    );
    assert.equal(pc.plannedMs, 3 * 60 * MIN);
    assert.equal(pc.elapsedMs, 2 * 60 * MIN);
    assert.equal(pc.share, 0.5);
    assert.deepEqual([pc.kept, pc.partly, pc.missed], [1, 0, 1]);
  });

  it('has no share before anything planned has started', () => {
    assert.equal(comparePlan([block(1, at(20), at(21), 'Gym', 'exercise')], [], [], at(8), FOCUS).share, null);
    assert.equal(comparePlan([], [], [], at(8), FOCUS).share, null);
  });
});
