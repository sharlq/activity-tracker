import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HEARTBEAT_INTERVAL_MS, HeartbeatGate, heartbeat } from './heartbeat.ts';

const TS = heartbeat('tracker', 'typescript', 'main');

describe('heartbeat', () => {
  it('holds exactly workspace, language, and branch', () => {
    assert.deepEqual(Object.keys(TS).sort(), ['branch', 'language', 'workspace']);
  });

  it('turns missing or empty values into null', () => {
    assert.deepEqual(heartbeat(undefined, '', undefined), { workspace: null, language: null, branch: null });
  });
});

describe('HeartbeatGate', () => {
  it('sends the first heartbeat', () => {
    assert.ok(new HeartbeatGate().shouldSend(TS, 0));
  });

  it('sends at most once per interval while nothing changes, however fast you type', () => {
    const gate = new HeartbeatGate();
    gate.shouldSend(TS, 0);
    for (let at = 100; at < HEARTBEAT_INTERVAL_MS; at += 100) assert.ok(!gate.shouldSend(TS, at), `at ${at}`);
    assert.ok(gate.shouldSend(TS, HEARTBEAT_INTERVAL_MS));
  });

  it('sends straight away when the language, workspace, or branch changes', () => {
    const gate = new HeartbeatGate();
    gate.shouldSend(TS, 0);
    assert.ok(gate.shouldSend(heartbeat('tracker', 'markdown', 'main'), 10));
    assert.ok(gate.shouldSend(heartbeat('tracker', 'markdown', 'feature'), 20));
    assert.ok(gate.shouldSend(heartbeat('other', 'markdown', 'feature'), 30));
  });

  it('lets the next activity retry immediately after a failed send', () => {
    const gate = new HeartbeatGate();
    gate.shouldSend(TS, 0);
    gate.forget();
    assert.ok(gate.shouldSend(TS, 10));
  });
});
