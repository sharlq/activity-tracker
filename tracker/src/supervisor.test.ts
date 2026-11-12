import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Logger } from './logger.ts';
import type { ChildProcessLike } from './supervisor.ts';
import { EXIT_ALREADY_RUNNING, decide, supervise } from './supervisor.ts';

describe('decide', () => {
  it('stops supervising when the tracker was asked to stop', () => {
    assert.equal(decide(0, 1000, 0).action, 'stop');
  });

  it('stops when another tracker already owns the data folder', () => {
    assert.equal(decide(EXIT_ALREADY_RUNNING, 100, 0).action, 'stop');
  });

  it('restarts after a crash or a kill, waiting longer each time', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => decide(1, 1000, n));
    assert.deepEqual(
      delays.map((d) => (d.action === 'restart' ? d.afterMs / 1000 : null)),
      [1, 2, 4, 8, 16, 32, 60, 60],
    );
    assert.equal(decide(null, 1000, 0).action, 'restart');
  });

  it('goes back to a short delay after the tracker ran fine for a while', () => {
    const decision = decide(1, 10 * 60_000, 6);
    assert.deepEqual(decision, { action: 'restart', afterMs: 1000 });
  });
});

describe('supervise', () => {
  function run(exitCodes: Array<number | null>) {
    const dir = mkdtempSync(join(tmpdir(), 'tracker-supervisor-'));
    const logFile = join(dir, 'log.txt');
    const waits: number[] = [];
    let starts = 0;
    const codes = [...exitCodes];
    const promise = supervise({
      start: (): ChildProcessLike => {
        starts++;
        const code = codes.length > 0 ? (codes.shift() as number | null) : 0;
        return { on: (_event, listener) => setImmediate(() => listener(code)) };
      },
      logger: new Logger({ file: logFile }),
      now: () => 0,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    return promise.then(() => {
      const log = readFileSync(logFile, 'utf8');
      rmSync(dir, { recursive: true, force: true });
      return { starts, waits, log };
    });
  }

  it('restarts a crashing tracker until it stops cleanly', async () => {
    const { starts, waits, log } = await run([1, null, 1, 0]);
    assert.equal(starts, 4);
    assert.deepEqual(waits, [1000, 2000, 4000]);
    assert.match(log, /exited with no code \(killed\)/);
    assert.match(log, /stopping because the tracker was asked to stop/);
  });

  it('does nothing more when another tracker is already running', async () => {
    const { starts, waits } = await run([EXIT_ALREADY_RUNNING]);
    assert.equal(starts, 1);
    assert.deepEqual(waits, []);
  });
});
