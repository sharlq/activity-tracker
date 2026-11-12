// Talks to the tracker. The only network destination is 127.0.0.1.
import type { TabReport } from './tabs.ts';

export const DEFAULT_PORT = 5610;

export interface Settings {
  port: number;
  token: string;
}

export interface Status {
  ok: boolean;
  at: number;
  message: string;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(['port', 'token']);
  return {
    port: typeof stored['port'] === 'number' ? stored['port'] : DEFAULT_PORT,
    token: typeof stored['token'] === 'string' ? stored['token'] : '',
  };
}

function describeFailure(status: number): string {
  if (status === 401) return 'The tracker rejected the token. Run "npm run raqib -- token" and paste it again.';
  return `The tracker answered with HTTP ${status}.`;
}

async function call(settings: Settings, path: string, init: RequestInit = {}): Promise<Status> {
  if (!settings.token) return { ok: false, at: Date.now(), message: 'No token set. Open the extension options.' };
  try {
    const response = await fetch(`http://127.0.0.1:${settings.port}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${settings.token}` },
    });
    return response.ok
      ? { ok: true, at: Date.now(), message: 'Connected' }
      : { ok: false, at: Date.now(), message: describeFailure(response.status) };
  } catch {
    return { ok: false, at: Date.now(), message: `Can't reach the tracker on port ${settings.port}. Is it running?` };
  }
}

export function ping(settings: Settings): Promise<Status> {
  return call(settings, '/v1/ping');
}

export function sendTab(settings: Settings, report: TabReport): Promise<Status> {
  return call(settings, '/v1/browser/tab', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  });
}

export function sendVisible(settings: Settings, tabs: TabReport[]): Promise<Status> {
  return call(settings, '/v1/browser/visible', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tabs }),
  });
}

export function sendAudible(settings: Settings, tabs: TabReport[]): Promise<Status> {
  return call(settings, '/v1/browser/audio', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tabs }),
  });
}
