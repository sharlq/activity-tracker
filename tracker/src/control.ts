// Pause and stop requests, passed to a running tracker through small files in the
// data folder. Files work whether the tracker is in a terminal or hidden at login,
// and a pause survives a restart.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PAUSE_FILE = 'pause.json';
const STOP_FILE = 'stop.request';

/** "30m", "2h", "1h30m", "90s". Null for anything else, including zero. */
export function parseDuration(text: string): number | null {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(text.trim());
  if (!match || text.trim() === '') return null;
  const [, h = '0', m = '0', s = '0'] = match;
  const ms = ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
  return ms > 0 ? ms : null;
}

/** When the current pause ends, or null if not paused. An expired pause file is removed. */
export function pausedUntil(dataFolder: string, now: number): number | null {
  const file = join(dataFolder, PAUSE_FILE);
  if (!existsSync(file)) return null;
  try {
    const { until } = JSON.parse(readFileSync(file, 'utf8')) as { until?: unknown };
    if (typeof until === 'number' && until > now) return until;
  } catch {
    // A damaged file is treated as no pause, so tracking never stops by accident.
  }
  rmSync(file, { force: true });
  return null;
}

export function pause(dataFolder: string, until: number): void {
  writeFileSync(join(dataFolder, PAUSE_FILE), `${JSON.stringify({ until })}\n`);
}

/** True if there was a pause to end. */
export function resume(dataFolder: string): boolean {
  const file = join(dataFolder, PAUSE_FILE);
  const existed = existsSync(file);
  rmSync(file, { force: true });
  return existed;
}

export function requestStop(dataFolder: string): void {
  writeFileSync(join(dataFolder, STOP_FILE), `${Date.now()}\n`);
}

/** True, and the request is consumed, if someone asked the tracker to stop. */
export function takeStopRequest(dataFolder: string): boolean {
  const file = join(dataFolder, STOP_FILE);
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}
