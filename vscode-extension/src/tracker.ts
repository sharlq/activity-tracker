// Finds the tracker and talks to it. The only network destination is 127.0.0.1.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Heartbeat } from './heartbeat.ts';

export interface Connection {
  port: number;
  token: string;
}

export type SendResult = { ok: true } | { ok: false; message: string };

/** Same folder the tracker uses, including its override for test runs. */
export function trackerHome(env: NodeJS.ProcessEnv = process.env): string {
  return env['ACTIVITY_TRACKER_HOME'] ?? join(homedir(), '.activity-tracker');
}

/** Reads api.json (written by the tracker when it starts) and the token it points to. */
export async function discover(home: string = trackerHome()): Promise<Connection | null> {
  try {
    const { port, tokenFile } = JSON.parse(await readFile(join(home, 'api.json'), 'utf8')) as Record<string, unknown>;
    if (typeof port !== 'number' || typeof tokenFile !== 'string') return null;
    const token = (await readFile(tokenFile, 'utf8')).trim();
    return /^[0-9a-f]{64}$/.test(token) ? { port, token } : null;
  } catch {
    return null;
  }
}

export async function sendHeartbeat(connection: Connection, heartbeat: Heartbeat): Promise<SendResult> {
  try {
    const response = await fetch(`http://127.0.0.1:${connection.port}/v1/editor/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${connection.token}` },
      body: JSON.stringify(heartbeat),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok ? { ok: true } : { ok: false, message: `The tracker answered with HTTP ${response.status}.` };
  } catch {
    return { ok: false, message: `Can't reach the tracker on port ${connection.port}. Is it running?` };
  }
}
