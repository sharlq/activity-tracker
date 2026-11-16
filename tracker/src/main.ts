#!/usr/bin/env node
// رقيب's command line: run | open | recent | purge | token | claude, plus the lifecycle commands.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, loadConfig, loadOrCreateToken, TOKEN_FILE } from './config.ts';
import { parseLocalDate } from './dates.ts';
import { classifyGaming } from './gaming.ts';
import { Logger } from './logger.ts';
import type { Activity } from './merger.ts';
import { isJournalCommand, JOURNAL_USAGE, runJournalCommand } from './journalCli.ts';
import { Store } from './store.ts';

const USAGE = `رقيب (Raqib), your activity tracker. Usage:
  raqib open [page]                   Open رقيب's window: today, morning, evening, week, reminders, settings
  raqib status                        Running or not, last event, database size, autostart
  raqib install                       Start hidden at every login (and right now)
  raqib uninstall                     Stop starting at login
  raqib shortcut                      Add (or refresh) the رقيب icon on the desktop
  raqib start                         Start the hidden tracker now
  raqib stop                          Stop the tracker, hidden or not
  raqib pause 30m                     Record nothing for a while (e.g. 30m, 2h, 1h30m)
  raqib resume                        End a pause early
  raqib run                           Start tracking in this window (Ctrl+C to stop)
  raqib recent [count]                Show the newest events (default 20)
  raqib purge --before YYYY-MM-DD     Permanently delete events that ended before that day
  raqib backup                        Copy the database now (one is also made each day)
  raqib token                         Show the API port and token for the extensions
  raqib gym-sync [--replace-plan]     Send the plan and workouts to the gym app now (also done at start)
  raqib claude [--date YYYY-MM-DD]    Show Claude Code sessions for a day (default today)
  raqib demo [--reset] [--tabs a,b]   Open a made-up demo profile to film or share (your data stays hidden)

Your day, tasks, and reminders:
${JOURNAL_USAGE}`;

function openStore(): Store {
  mkdirSync(dataDir(), { recursive: true });
  return new Store(join(dataDir(), 'data.db'));
}

async function run(): Promise<number> {
  const config = loadConfig();
  const logger = new Logger({
    file: join(dataDir(), 'logs', 'tracker.log'),
    echo: Boolean(process.stdout.isTTY),
  });

  // Loaded here so that purge and recent never touch Win32.
  const { acquireSingleInstance, processInfo, win32Probe, win32Screens } = await import('./win32.ts');
  const { readAudioSessions } = await import('./win32Audio.ts');
  const { microphoneUsers } = await import('./win32Mic.ts');
  const { windowsNotifier } = await import('./notify.ts');
  const { openUrl } = await import('./launch.ts');
  const { startService } = await import('./service.ts');
  const { EXIT_ALREADY_RUNNING } = await import('./supervisor.ts');
  const { takeStopRequest } = await import('./control.ts');

  mkdirSync(dataDir(), { recursive: true });
  if (!acquireSingleInstance(dataDir())) {
    console.error('رقيب is already running. See "raqib status".');
    return EXIT_ALREADY_RUNNING;
  }

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    process.exit(1);
  });

  // A stop request left over from when nothing was running must not stop us now.
  takeStopRequest(dataDir());

  const shutdown = (reason: string): void => {
    logger.info(reason);
    service.stop();
    process.exit(0);
  };
  const service = startService(config, { ...win32Probe, microphoneUsers }, logger, {
    apiToken: loadOrCreateToken(),
    tokenFile: TOKEN_FILE,
    onStopRequested: () => shutdown('Stopping on request'),
    notifier: windowsNotifier(logger, fileURLToPath(new URL('../ui/icon.png', import.meta.url))),
    openWindow: openUrl,
    audio: { readSessions: readAudioSessions, processInfo },
    screens: win32Screens,
    backups: true,
    gymSync: true,
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) {
    process.on(signal, () => shutdown(`Received ${signal}`));
  }
  return new Promise<number>(() => {}); // Runs until a signal or stop request arrives.
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}m` : `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

function recent(countArg: string | undefined): number {
  const count = countArg === undefined ? 20 : Number(countArg);
  if (!Number.isInteger(count) || count <= 0) {
    console.error('count must be a positive whole number');
    return 1;
  }
  const { games } = loadConfig().gaming;
  const store = openStore();
  const events = store.recent(count).reverse();
  store.close();
  if (events.length === 0) console.log('No events yet.');
  for (const { start, end, activity } of events) {
    const span = `${new Date(start).toLocaleTimeString('en-GB')}-${new Date(end).toLocaleTimeString('en-GB')}`;
    console.log(`${span}  ${formatDuration(end - start).padStart(7)}  ${describe(activity, games)}`);
  }
  return 0;
}

function describe(activity: Activity, games: string[]): string {
  if (activity.kind === 'idle') {
    if (!activity.window) return '[idle]';
    return `[idle, in front:]  ${describe({ kind: 'window', ...activity.window }, games)}`;
  }
  const gaming = classifyGaming(activity, games);
  const tag =
    gaming?.category === 'gaming'
      ? `[gaming: ${gaming.gameName}]  `
      : gaming
        ? `[game launcher: ${gaming.launcher}]  `
        : '';
  const site = activity.domain ? `  <${activity.url ?? activity.domain}>` : '';
  const code = activity.project
    ? `  {${[activity.project + (activity.branch ? `@${activity.branch}` : ''), activity.language].filter(Boolean).join(' ')}}`
    : '';
  return `${tag}${activity.processName}${site}${code}  ${activity.title}`;
}

async function open(args: string[]): Promise<number> {
  const { openPage, runningPort } = await import('./launch.ts');
  const { isRunning } = await import('./win32.ts');
  const page = (args[0] ?? 'today') as Parameters<typeof openPage>[1];
  if (!['today', 'morning', 'evening', 'week', 'projects', 'reminders', 'settings'].includes(page ?? '')) {
    console.error('Usage: raqib open [today | morning | evening | week | projects | reminders | settings]');
    return 1;
  }
  const port = runningPort();
  if (!isRunning(dataDir()) || port === null) {
    console.error('رقيب is not running, so there is no window to open. Start it with "raqib start".');
    return 1;
  }
  await openPage(port, page);
  return 0;
}

function token(): number {
  console.log(`Port:  ${loadConfig().api.port}`);
  console.log(`Token: ${loadOrCreateToken()}`);
  console.log(`(stored in ${TOKEN_FILE})`);
  return 0;
}

async function claude(args: string[]): Promise<number> {
  const dateArg = args[0] === '--date' ? args[1] : undefined;
  if (args.length > 0 && dateArg === undefined) {
    console.error('Usage: tracker claude [--date YYYY-MM-DD]');
    return 1;
  }
  const today = new Date();
  const from = dateArg === undefined ? new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() : parseLocalDate(dateArg);
  if (from === null) {
    console.error('Usage: tracker claude [--date YYYY-MM-DD]');
    return 1;
  }
  const to = new Date(from).setDate(new Date(from).getDate() + 1);

  const { readClaudeSessions, sessionStats } = await import('./claudeSessions.ts');
  const { sessions, filesRead, skippedLines } = await readClaudeSessions(undefined, from);
  const day = new Date(from).toLocaleDateString('en-CA');
  // Sorted by start within this day: a session begun yesterday starts at its first message today.
  const rows = sessions
    .map((session) => ({ session, stats: sessionStats(session.timestamps, from, to) }))
    .filter((row) => row.stats !== null)
    .sort((a, b) => (a.stats?.start ?? 0) - (b.stats?.start ?? 0));

  console.log(`Claude Code sessions on ${day}`);
  if (rows.length === 0) console.log('  None.');
  const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  let span = 0;
  let active = 0;
  for (const { session, stats } of rows) {
    if (!stats) continue;
    span += stats.spanMs;
    active += stats.activeMs;
    console.log(
      `  ${time(stats.start)}-${time(stats.end)}  span ${formatDuration(stats.spanMs).padStart(6)}  active ${formatDuration(stats.activeMs).padStart(6)}  ${session.project}  (${stats.messages} messages)`,
    );
  }
  if (rows.length > 1) console.log(`  Total: span ${formatDuration(span)}, active ${formatDuration(active)} across ${rows.length} sessions`);
  console.log(`(read ${filesRead} log file(s)${skippedLines ? `, skipped ${skippedLines} unreadable line(s)` : ''})`);
  return 0;
}

async function backup(): Promise<number> {
  const { backupFolder, backUp, listBackups } = await import('./backup.ts');
  const config = loadConfig();
  const folder = backupFolder(config);
  const file = await backUp(join(dataDir(), 'data.db'), folder, new Date().toLocaleDateString('en-CA'), config.backup.keep, true);
  console.log(`Backed up to ${file}`);
  console.log(`Keeping the newest ${config.backup.keep}: ${listBackups(folder).map((b) => b.day).join(', ')}`);
  console.log('To restore one: "raqib stop", copy it over data.db in the data folder, then "raqib start".');
  return 0;
}

function purge(args: string[]): number {
  const dateArg = args[0] === '--before' ? args[1] : undefined;
  const cutoff = dateArg === undefined ? null : parseLocalDate(dateArg);
  if (cutoff === null) {
    console.error('Usage: tracker purge --before YYYY-MM-DD');
    return 1;
  }
  if (cutoff > Date.now()) {
    console.error('The date must not be in the future.');
    return 1;
  }
  const store = openStore();
  const deleted = store.purgeBefore(cutoff);
  store.close();
  console.log(`Deleted ${deleted} event(s) that ended before ${dateArg}.`);
  return 0;
}

async function gymSync(args: string[]): Promise<number> {
  const { GYM_SYNC_FILE, loadGymTarget, pushToGym } = await import('./gymSync.ts');
  const target = loadGymTarget(dataDir());
  if (!target) {
    console.error(`Gym sync is not set up. Make ${join(dataDir(), GYM_SYNC_FILE)} holding:\n  { "url": "https://….convex.cloud", "syncKey": "your SYNC_KEY" }`);
    return 1;
  }
  const r = await pushToGym(join(dataDir(), 'data.db'), target, { replacePlan: args.includes('--replace-plan') });
  console.log(r.planPushed ? 'Plan: sent, as "Main plan"' : 'Plan: left as it is (the phone owns plans; --replace-plan overwrites them)');
  console.log(`Workouts: ${r.workouts} on the PC, ${r.added} added, ${r.updated} changed`);
  return 0;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (isJournalCommand(command)) return runJournalCommand(command as string, args);
  switch (command) {
    case 'run':
      return run();
    case 'open':
      return open(args);
    case 'recent':
      return recent(args[0]);
    case 'purge':
      return purge(args);
    case 'backup':
      return backup();
    case 'token':
      return token();
    case 'gym-sync':
      return gymSync(args);
    case 'claude':
      return claude(args);
    case 'demo':
      return (await import('./demo.ts')).runDemo(args);
    case 'status':
    case 'install':
    case 'uninstall':
    case 'shortcut':
    case 'start':
    case 'stop':
    case 'pause':
    case 'resume':
    case 'supervise': {
      const lifecycle = await import('./lifecycle.ts');
      return lifecycle[command](args, fileURLToPath(import.meta.url));
    }
    default:
      console.log(USAGE);
      return command === undefined ? 0 : 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
