// Keeps the tracker running: starts it hidden, and restarts it if it crashes.
//
// Exit codes decide what happens next:
//   0  the tracker was asked to stop (tracker stop, Ctrl+C): stop supervising
//   3  another tracker already owns this data folder: nothing to do
//   anything else, or killed: a crash, so restart after a growing delay
import { spawn } from 'node:child_process';
import type { Logger } from './logger.ts';

export const EXIT_ALREADY_RUNNING = 3;

/** A run this long proves the tracker works, so the next crash starts the delays over. */
const HEALTHY_RUN_MS = 5 * 60_000;
const FIRST_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;

export type Decision = { action: 'stop'; reason: string } | { action: 'restart'; afterMs: number };

/** 1s, 2s, 4s ... up to a minute for repeated crashes; back to 1s after a healthy run. */
export function decide(exitCode: number | null, ranForMs: number, crashesInARow: number): Decision {
  if (exitCode === 0) return { action: 'stop', reason: 'the tracker was asked to stop' };
  if (exitCode === EXIT_ALREADY_RUNNING) return { action: 'stop', reason: 'another tracker is already running for this data folder' };
  const streak = ranForMs >= HEALTHY_RUN_MS ? 0 : crashesInARow;
  return { action: 'restart', afterMs: Math.min(MAX_DELAY_MS, FIRST_DELAY_MS * 2 ** streak) };
}

export interface ChildProcessLike {
  on(event: 'exit', listener: (code: number | null) => void): unknown;
}

export interface SupervisorDeps {
  start(): ChildProcessLike;
  logger: Logger;
  now(): number;
  wait(ms: number): Promise<void>;
}

/** Resolves when supervising should end; never rejects. */
export async function supervise({ start, logger, now, wait }: SupervisorDeps): Promise<void> {
  let crashesInARow = 0;
  for (;;) {
    const startedAt = now();
    const code = await new Promise<number | null>((resolve) => start().on('exit', resolve));
    const ranForMs = now() - startedAt;
    const decision = decide(code, ranForMs, crashesInARow);
    if (decision.action === 'stop') {
      logger.info(`Supervisor: stopping because ${decision.reason}`);
      return;
    }
    crashesInARow = ranForMs >= HEALTHY_RUN_MS ? 1 : crashesInARow + 1;
    logger.warn(`Supervisor: tracker exited with ${code ?? 'no code (killed)'} after ${Math.round(ranForMs / 1000)}s; restarting in ${decision.afterMs / 1000}s`);
    await wait(decision.afterMs);
  }
}

/** Starts `node main.js run` with no window, inheriting this process's environment. */
export function startTrackerProcess(mainScript: string): ChildProcessLike {
  return spawn(process.execPath, [mainScript, 'run'], { stdio: 'ignore', windowsHide: true });
}
