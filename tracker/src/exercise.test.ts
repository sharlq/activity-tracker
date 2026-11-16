import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSets, setsSpec, setsText, volumeOf } from './exercise.ts';

const set = (reps: number | null, weight: number | null, extra: { seconds?: number; distance?: number } = {}) => ({ reps, weight, rpe: null, seconds: extra.seconds ?? null, distance: extra.distance ?? null });

describe('sets written the short way', () => {
  it('reads sets of reps at a weight', () => {
    assert.deepEqual(parseSets('3x8@60'), [set(8, 60), set(8, 60), set(8, 60)]);
    assert.deepEqual(parseSets('8 @ 62.5  1x6@65kg'), [set(8, 62.5), set(6, 65)]);
    assert.deepEqual(parseSets('8/8/6@60'), [set(8, 60), set(8, 60), set(6, 60)]);
    assert.deepEqual(parseSets('3×10'), [set(10, null), set(10, null), set(10, null)]);
    assert.deepEqual(parseSets('2x12@bw'), [set(12, null), set(12, null)]);
  });

  it('turns pounds into kg', () => {
    assert.deepEqual(parseSets('135lb'.replace(/^/, '5@')), [set(5, 61.2)]);
    assert.deepEqual(parseSets('5@135', { lb: true }), [set(5, 61.2)]);
  });

  it('reads timed and distance sets', () => {
    assert.deepEqual(parseSets('3x45s'), [set(null, null, { seconds: 45 }), set(null, null, { seconds: 45 }), set(null, null, { seconds: 45 })]);
    assert.deepEqual(parseSets('5km'), [set(null, null, { distance: 5000 })]);
    assert.deepEqual(parseSets('2x400m'), [set(null, null, { distance: 400 }), set(null, null, { distance: 400 })]);
  });

  it('says what is wrong', () => {
    assert.throws(() => parseSets(''), /3x8@60/);
    assert.throws(() => parseSets('3y5'), /isn't a set/);
    assert.throws(() => parseSets('3x8.5@60'), /whole number/);
    assert.throws(() => parseSets('99x8@60'), /1 and 50/);
  });

  it('writes them back, the long way and the short way', () => {
    const sets = parseSets('3x8@60 6@62.5 3x10');
    assert.equal(setsText(sets), '3×8 @ 60 kg, 1×6 @ 62.5 kg, 3×10');
    assert.equal(setsSpec(sets), '3x8@60 6@62.5 3x10');
    assert.deepEqual(parseSets(setsSpec(sets)), sets);
    assert.equal(volumeOf(sets), 3 * 8 * 60 + 6 * 62.5);
  });
});
