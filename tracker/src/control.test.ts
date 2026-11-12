import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parseDuration, pause, pausedUntil, requestStop, resume, takeStopRequest } from './control.ts';

describe('parseDuration', () => {
  it('reads hours, minutes, and seconds in any combination', () => {
    const cases: Array<[string, number]> = [
      ['30m', 30 * 60_000],
      ['2h', 2 * 3_600_000],
      ['1h30m', 90 * 60_000],
      ['90s', 90_000],
      ['1H5M', 65 * 60_000],
    ];
    for (const [text, ms] of cases) assert.equal(parseDuration(text), ms, text);
  });

  it('rejects anything else, including zero', () => {
    for (const text of ['', '30', 'm', '30 min', '0m', '-5m', '1.5h', 'soon']) assert.equal(parseDuration(text), null, text);
  });
});

describe('pause and resume', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracker-control-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is paused until the chosen time, then not', () => {
    pause(dir, 10_000);
    assert.equal(pausedUntil(dir, 5000), 10_000);
    assert.equal(pausedUntil(dir, 10_000), null);
  });

  it('removes an expired pause file', () => {
    pause(dir, 10_000);
    pausedUntil(dir, 20_000);
    assert.ok(!existsSync(join(dir, 'pause.json')));
  });

  it('treats a damaged pause file as not paused, so tracking never stops by accident', () => {
    writeFileSync(join(dir, 'pause.json'), 'garbage');
    assert.equal(pausedUntil(dir, 0), null);
  });

  it('resumes early, and says whether there was a pause', () => {
    pause(dir, 10_000);
    assert.equal(resume(dir), true);
    assert.equal(pausedUntil(dir, 0), null);
    assert.equal(resume(dir), false);
  });
});

describe('stop requests', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracker-control-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is taken once', () => {
    assert.equal(takeStopRequest(dir), false);
    requestStop(dir);
    assert.equal(takeStopRequest(dir), true);
    assert.equal(takeStopRequest(dir), false);
  });
});
