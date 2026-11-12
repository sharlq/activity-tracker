import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GamepadState } from './gamepad.ts';
import { GamepadMonitor, isGamepadActivity } from './gamepad.ts';

const NEUTRAL: GamepadState = {
  buttons: 0,
  leftTrigger: 0,
  rightTrigger: 0,
  leftX: 0,
  leftY: 0,
  rightX: 0,
  rightY: 0,
};
const pad = (changes: Partial<GamepadState> = {}): GamepadState => ({ ...NEUTRAL, ...changes });

describe('isGamepadActivity', () => {
  it('counts a button press and a button release', () => {
    assert.ok(isGamepadActivity(pad(), pad({ buttons: 0x1000 })));
    assert.ok(isGamepadActivity(pad({ buttons: 0x1000 }), pad()));
  });

  it('counts a real trigger pull but not trigger noise', () => {
    assert.ok(isGamepadActivity(pad(), pad({ rightTrigger: 200 })));
    assert.ok(!isGamepadActivity(pad(), pad({ leftTrigger: 20 })));
  });

  it('counts a stick pushed out of its dead zone', () => {
    assert.ok(isGamepadActivity(pad(), pad({ leftX: 20_000 })));
    assert.ok(isGamepadActivity(pad(), pad({ rightY: -20_000 })));
  });

  it('ignores drift inside the dead zone, however much it wanders', () => {
    assert.ok(!isGamepadActivity(pad({ leftX: -5000 }), pad({ leftX: 5000 })));
    assert.ok(!isGamepadActivity(pad({ rightY: -6000 }), pad({ rightY: 6000 })));
  });

  it('ignores a stick held still outside the dead zone, with small jitter', () => {
    assert.ok(!isGamepadActivity(pad({ leftX: 20_000 }), pad({ leftX: 20_500 })));
  });

  it('applies the dead zone to the stick position, not to each axis', () => {
    assert.ok(isGamepadActivity(pad(), pad({ leftX: 6000, leftY: 6000 })));
  });
});

describe('GamepadMonitor', () => {
  /** A monitor whose controllers read from a slot-to-state map you can change. */
  function setup(initial: Record<number, GamepadState> = {}) {
    const slots = new Map(Object.entries(initial).map(([k, v]) => [Number(k), v]));
    const reads: number[] = [];
    const monitor = new GamepadMonitor((slot) => {
      reads.push(slot);
      return slots.get(slot) ?? null;
    });
    return { monitor, slots, reads };
  }

  it('does not count a controller already connected at startup', () => {
    const { monitor } = setup({ 0: pad() });
    monitor.poll(1000);
    assert.equal(monitor.lastActivityAt, null);
    assert.equal(monitor.connectedCount, 1);
  });

  it('records when input happens, and keeps that time while nothing changes', () => {
    const { monitor, slots } = setup({ 0: pad() });
    monitor.poll(1000);
    slots.set(0, pad({ buttons: 1 }));
    monitor.poll(2000);
    monitor.poll(3000);
    assert.equal(monitor.lastActivityAt, 2000);
  });

  it('never counts a steady state as activity, even with an old baseline', () => {
    const { monitor } = setup({ 0: pad({ leftX: 20_000 }) });
    for (let at = 0; at < 10_000; at += 200) monitor.poll(at);
    assert.equal(monitor.lastActivityAt, null);
  });

  it('adds up slow stick movement against the baseline', () => {
    const { monitor, slots } = setup({ 0: pad({ leftX: 10_000 }) });
    monitor.poll(0);
    let at = 0;
    for (const leftX of [11_000, 12_000, 13_000, 14_000]) {
      slots.set(0, pad({ leftX }));
      monitor.poll((at += 200));
    }
    assert.equal(monitor.lastActivityAt, 800);
  });

  it('counts input from any slot', () => {
    const { monitor, slots } = setup({ 0: pad(), 3: pad() });
    monitor.poll(0);
    slots.set(3, pad({ buttons: 1 }));
    monitor.poll(200);
    assert.equal(monitor.lastActivityAt, 200);
  });

  it('checks empty slots rarely and one at a time, but connected ones every poll', () => {
    const { monitor, reads } = setup({ 1: pad() });
    monitor.poll(0);
    assert.deepEqual(reads, [0, 1, 2, 3]);

    reads.length = 0;
    for (let i = 1; i <= 25; i++) monitor.poll(i * 200);
    const empties = reads.filter((slot) => slot !== 1);
    assert.deepEqual(empties.sort(), [0, 2, 3]);
    assert.equal(reads.filter((slot) => slot === 1).length, 25);
  });

  it('notices a controller plugged in later and counts that as activity', () => {
    const { monitor, slots } = setup();
    monitor.poll(0);
    slots.set(0, pad());
    for (let i = 1; i <= 25; i++) monitor.poll(i * 200);
    assert.equal(monitor.connectedCount, 1);
    assert.equal(monitor.lastActivityAt, 5000);
  });

  it('notices a disconnect, without counting it as activity', () => {
    const { monitor, slots } = setup({ 0: pad() });
    monitor.poll(0);
    slots.delete(0);
    monitor.poll(200);
    assert.equal(monitor.connectedCount, 0);
    assert.equal(monitor.lastActivityAt, null);
  });
});
