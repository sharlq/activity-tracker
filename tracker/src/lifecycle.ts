// raqib status | install | uninstall | start | stop | pause | resume | supervise
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as autostart from './autostart.ts';
import { dataDir } from './config.ts';
import * as control from './control.ts';
import { Logger } from './logger.ts';
import { unregisterAppIdentity } from './notify.ts';
import { EventReader } from './reader.ts';
import { startTrackerProcess, supervise as runSupervisor } from './supervisor.ts';
import { acquireSingleInstance, isRunning } from './win32.ts';

type Command = (args: string[], mainScript: string) => Promise<number>;

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (condition()) return true;
    await sleep(250);
  }
  return condition();
}

export const status: Command = async () => {
  const folder = dataDir();
  const running = isRunning(folder);
  const supervised = isRunning(folder, 'supervisor');
  const installed = autostart.isInstalled();
  const paused = control.pausedUntil(folder, Date.now());

  console.log(`رقيب:        ${running ? `running${supervised ? ' (hidden, restarts if it crashes)' : ' (in a terminal)'}` : 'not running'}`);
  console.log(`Recording:   ${paused ? `paused until ${new Date(paused).toLocaleString('en-GB')}` : running ? 'yes' : 'no'}`);

  const database = join(folder, 'data.db');
  if (existsSync(database)) {
    const reader = new EventReader(database);
    const last = reader.lastEvent();
    reader.close();
    const what = last ? (last.activity.kind === 'idle' ? 'idle' : last.activity.processName.replace(/\.exe$/i, '')) : '';
    console.log(`Last event:  ${last ? `${new Date(last.end).toLocaleString('en-GB')} (${ago(last.end)}), ${what}` : 'none yet'}`);
    const total = sizeOf(database) + sizeOf(`${database}-wal`) + sizeOf(`${database}-shm`);
    console.log(`Database:    ${megabytes(total)}  (${database})`);
  } else {
    console.log('Last event:  none yet (no database)');
  }

  try {
    const { port } = JSON.parse(readFileSync(join(folder, 'api.json'), 'utf8')) as { port: number };
    console.log(`API:         127.0.0.1:${port}${running ? '' : ' (when running)'}`);
  } catch {
    // The tracker has not run with the API yet.
  }
  if (autostart.onlyLegacyInstalled()) {
    console.log(`Autostart:   installed under the old name "${autostart.LEGACY_TASK_NAME}". Run "raqib install" to switch it to رقيب.`);
    return 0;
  }
  console.log(`Autostart:   ${installed ? `installed (Task Scheduler: "${autostart.taskName()}")` : 'not installed (run "raqib install")'}`);
  return 0;
};

export const install: Command = async (_args, mainScript) => {
  const folder = dataDir();
  mkdirSync(folder, { recursive: true });
  autostart.install(folder, mainScript);
  console.log(`Installed: رقيب will start hidden each time you log in (task "${autostart.taskName()}").`);
  const shortcut = autostart.startMenuShortcut();
  if (shortcut && existsSync(shortcut)) console.log('Added "رقيب" to the Start menu: it opens your day, tasks, and reminders.');
  if (isRunning(folder)) {
    console.log('A tracker is already running, probably in a terminal. Stop it with Ctrl+C, then run "raqib start".');
    return 0;
  }
  return start([], mainScript);
};

/** Adds or refreshes the desktop shortcut. Runs after every "npm run build". */
export const shortcut: Command = async (_args, mainScript) => {
  const folder = dataDir();
  mkdirSync(folder, { recursive: true });
  try {
    const where = autostart.installDesktopShortcut(folder, mainScript);
    console.log(where ? `Desktop shortcut ready: ${where}` : 'Could not find the Desktop folder; no shortcut made.');
  } catch (error) {
    // Never fail a build over a shortcut.
    console.log(`Could not make the desktop shortcut: ${(error as Error).message}`);
  }
  return 0;
};

export const uninstall: Command = async () => {
  const removed = autostart.uninstall();
  await unregisterAppIdentity();
  console.log(removed ? 'Removed: رقيب will no longer start at login, and its Start menu and desktop shortcuts are gone.' : 'Autostart was not installed.');
  if (isRunning(dataDir())) console.log('The tracker is still running for now. Run "raqib stop" to stop it.');
  return 0;
};

export const start: Command = async () => {
  const folder = dataDir();
  if (isRunning(folder)) {
    console.log('The tracker is already running.');
    return 0;
  }
  if (!autostart.isInstalled() && autostart.onlyLegacyInstalled()) {
    autostart.runNow(autostart.LEGACY_TASK_NAME);
    const ok = await waitFor(() => isRunning(folder), 15_000);
    console.log(ok ? 'Started the hidden tracker. Run "raqib install" to move autostart to the name رقيب.' : 'Asked Task Scheduler to start it, but it is not running yet.');
    return ok ? 0 : 1;
  }
  if (!autostart.isInstalled()) {
    console.error('Autostart is not installed. Run "raqib install", or "raqib run" to track in this window.');
    return 1;
  }
  autostart.runNow();
  const ok = await waitFor(() => isRunning(folder), 15_000);
  console.log(ok ? 'Started the hidden tracker.' : 'Asked Task Scheduler to start it, but it is not running yet. Check "raqib status" in a moment.');
  return ok ? 0 : 1;
};

export const stop: Command = async () => {
  const folder = dataDir();
  if (!isRunning(folder)) {
    console.log('The tracker is not running.');
    return 0;
  }
  control.requestStop(folder);
  const ok = await waitFor(() => !isRunning(folder) && !isRunning(folder, 'supervisor'), 15_000);
  console.log(ok ? 'Stopped.' : 'Asked the tracker to stop, but it is still running.');
  if (ok && autostart.isInstalled()) console.log('It will start again at your next login, or now with "raqib start".');
  return ok ? 0 : 1;
};

export const pause: Command = async (args) => {
  const ms = args[0] === undefined ? null : control.parseDuration(args[0]);
  if (ms === null) {
    console.error('Usage: raqib pause 30m   (also 2h, 1h30m, 90s)');
    return 1;
  }
  const folder = dataDir();
  mkdirSync(folder, { recursive: true });
  const until = Date.now() + ms;
  control.pause(folder, until);
  console.log(`Paused until ${time(until)}. Nothing is recorded until then, or until "raqib resume".`);
  if (!isRunning(folder)) console.log('(The tracker is not running right now; the pause applies once it starts.)');
  return 0;
};

export const resume: Command = async () => {
  console.log(control.resume(dataDir()) ? 'Resumed: recording again.' : 'Not paused.');
  return 0;
};

/** Run by the hidden launcher. Not meant to be typed. */
export const supervise: Command = async (_args, mainScript) => {
  const folder = dataDir();
  mkdirSync(folder, { recursive: true });
  const logger = new Logger({ file: join(folder, 'logs', 'tracker.log') });
  if (!acquireSingleInstance(folder, 'supervisor')) return 0; // Another supervisor has it covered.
  logger.info('Supervisor: started');
  await runSupervisor({ start: () => startTrackerProcess(mainScript), logger, now: Date.now, wait: sleep });
  return 0;
};
