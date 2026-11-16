// Opens رقيب's window: a page served by the tracker on 127.0.0.1, shown as an
// app window (no tabs or address bar) in Chrome or Edge, or failing that in a
// tab of the default browser.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, loadOrCreateToken } from './config.ts';

export type Page = 'today' | 'morning' | 'evening' | 'back' | 'week' | 'projects' | 'reminders' | 'settings';

/** The small window that asks what you were doing while away. */
export const BACK_WINDOW_SIZE = [560, 720] as const;

export function browserCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LOCALAPPDATA']].filter((r): r is string => Boolean(r));
  return [
    ...roots.map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    ...roots.map((root) => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
  ];
}

/**
 * The address that signs the window in. The key is the API token: anyone who
 * can read it can already read the database, so it gives nothing new away.
 */
export function loginUrl(port: number, token: string, page: Page = 'today', date?: string, away?: { start: number; end: number }): string {
  const params = new URLSearchParams({ key: token, go: page });
  if (date) params.set('date', date);
  if (away) params.set('away', `${away.start}-${away.end}`);
  return `http://127.0.0.1:${port}/ui/login?${params}`;
}

/** The port the running tracker is listening on, from the api.json it writes at start. */
export function runningPort(): number | null {
  try {
    const { port } = JSON.parse(readFileSync(join(dataDir(), 'api.json'), 'utf8')) as { port?: unknown };
    return typeof port === 'number' ? port : null;
  } catch {
    return null;
  }
}

function detached(file: string, args: string[]): void {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

/** Gives the new window رقيب's own taskbar icon and pin, instead of the browser's. Never throws. */
async function tagWindow(): Promise<void> {
  try {
    const [{ tagNewAppWindow }, { appIdentity }] = await Promise.all([import('./appIdentity.ts'), import('./autostart.ts')]);
    const mainScript = fileURLToPath(import.meta.url).replace(/launch\.(ts|js)$/, 'main.$1');
    await tagNewAppWindow(appIdentity(dataDir(), mainScript));
  } catch {
    // The window still works; it just sits under the browser's icon.
  }
}

/** Opens the window. The promise settles once it has its taskbar identity (or after a while). */
export function openUrl(url: string, size: readonly [number, number] = [1180, 860], { tag = true }: { tag?: boolean } = {}): Promise<void> {
  const browser = browserCandidates().find((path) => existsSync(path));
  if (browser) {
    const tagged = tag ? tagWindow() : Promise.resolve();
    detached(browser, [`--app=${url}`, `--window-size=${size[0]},${size[1]}`]);
    return tagged;
  } else {
    // The default browser, whatever it is. url.dll takes the address as one argument, so & is safe.
    detached('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
    return Promise.resolve();
  }
}

export function openPage(port: number, page: Page = 'today', date?: string): Promise<void> {
  return openUrl(loginUrl(port, loadOrCreateToken(), page, date));
}
