import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Logger, localTimestamp } from './logger.ts';

describe('Logger', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracker-log-'));
    file = join(dir, 'nested', 'tracker.log');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates its folder and appends lines with a level', () => {
    new Logger({ file }).info('hello');
    assert.match(readFileSync(file, 'utf8'), /^\S+ INFO hello\n$/);
  });

  it('rotates at the size limit and keeps only maxFiles old logs', () => {
    const logger = new Logger({ file, maxBytes: 100, maxFiles: 2 });
    for (let i = 0; i < 12; i++) logger.info(`message number ${i} padded out to some length`);

    const rotated = (n: number) => join(dir, 'nested', `tracker.${n}.log`);
    assert.ok(existsSync(file));
    assert.ok(existsSync(rotated(1)));
    assert.ok(existsSync(rotated(2)));
    assert.ok(!existsSync(rotated(3)));
    assert.match(readFileSync(file, 'utf8'), /message number 11 /);
    assert.doesNotMatch(readFileSync(rotated(2), 'utf8'), /message number 0 /);
  });

  it('counts existing file size after a restart', () => {
    new Logger({ file, maxBytes: 100 }).info('x'.repeat(80));
    new Logger({ file, maxBytes: 100 }).info('y'.repeat(80));
    assert.ok(existsSync(join(dir, 'nested', 'tracker.1.log')));
  });
});

describe('localTimestamp', () => {
  it('writes local time with its UTC offset, which parses back to the same moment', () => {
    const now = new Date(2026, 10, 6, 23, 26, 5, 123);
    const stamp = localTimestamp(now);
    assert.match(stamp, /^2026-11-06T23:26:05\.123[+-]\d{2}:\d{2}$/);
    assert.equal(new Date(stamp).getTime(), now.getTime());
  });
});
