// The polling loop: sample, merge, persist.
//
// Every tick commits to disk, so a crash, power cut, or forced shutdown loses at
// most one interval and leaves nothing to repair. Sleep and shutdown need no
// special events: they show up as a gap between ticks, which the merger won't
// bridge. Locked sessions record nothing at all.
import { writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import type { EditorHeartbeat, TabReport } from './api.ts';
import type { AudibleTab, ProcessInfo } from './audio.ts';
import { AudioRecorder, audioSources, LoudnessMemory, SpanRecorder } from './audio.ts';
import type { ScreenSource, ScreenWindow } from './screens.ts';
import { rememberVisibleTabs, screenSources } from './screens.ts';
import { createApi, listen } from './api.ts';
import type { BrowserTab } from './browser.ts';
import { domainOf, rememberTab } from './browser.ts';
import type { Config } from './config.ts';
import { dataDir } from './config.ts';
import { pausedUntil, takeStopRequest } from './control.ts';
import type { EditorReport } from './editor.ts';
import { rememberEditorReport } from './editor.ts';
import { GamepadMonitor } from './gamepad.ts';
import type { Logger } from './logger.ts';
import { EventMerger } from './merger.ts';
import type { SystemProbe } from './sampler.ts';
import { sample } from './sampler.ts';
import { Store } from './store.ts';
import type { Reminder } from './journal.ts';
import { Journal } from './journal.ts';
import type { Page } from './launch.ts';
import { BACK_WINDOW_SIZE, loginUrl } from './launch.ts';
import type { Notifier, Toast } from './notify.ts';
import type { BackMode, ReturnState } from './planner.ts';
import { dayKey, detectReturn, dueSlot, eveningDue, morningDue, projectReminderDue } from './planner.ts';
import type { ProjectOverview } from './projects.ts';
import { unanswered } from './projects.ts';
import { union } from './report/index.ts';
import { buildDay, createUi, readSettings, readState } from './ui.ts';

/** Ticks can run late under load, so only a clearly longer silence is a gap. */
const GAP_TOLERANCE_INTERVALS = 3;
/** Much faster than the main tick, or a quick button tap would fall between readings. */
const GAMEPAD_POLL_MS = 200;
/** Speech has pauses, so the audio meter is read often and remembered for a few seconds. */
const AUDIO_POLL_MS = 1000;
/** Process names and window titles are looked up again this often (a new song, a new episode). */
const PROCESS_INFO_TTL_MS = 15_000;
/** You count as at the PC for the morning page and evening log if you used it this recently. */
const PRESENT_MS = 60_000;

export interface ScreensProbe {
  screenWindows(): ScreenWindow[];
  screenCount(): number;
}

export interface AudioProbe {
  readSessions(): { pid: number; peak: number }[];
  processInfo(pid: number): ProcessInfo | null;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  return h === 0 ? `${minutes}m` : `${h}h${String(minutes % 60).padStart(2, '0')}m`;
}

export function reminderToast(reminder: Reminder, slot: number, now: number): Toast {
  const late = now - slot > 5 * 60_000;
  return {
    title: reminder.text,
    lines: [late ? `Was due at ${clock(slot)}` : `رقيب · ${clock(slot)}`],
    reminder: true,
    actions: [{ kind: 'snooze' }, { kind: 'dismiss', label: 'Done' }],
  };
}

/** "Anatomy exam, Side project app and 2 more". */
function names(projects: ProjectOverview[], max = 3): string {
  const shown = projects.slice(0, max).map((p) => p.name);
  if (projects.length <= max) return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : (shown[0] ?? '');
  return `${shown.join(', ')} and ${projects.length - max} more`;
}

/** The evening line about projects, or null with nothing to ask. */
export function eveningProjectsLine(projects: ProjectOverview[]): string | null {
  const open = unanswered(projects);
  if (open.length === 0) return null;
  return `What did you do on ${names(open)}?`;
}

/** The daily project nudge, for days you skip the evening log. Null when every project is answered. */
export function projectReminderToast(projects: ProjectOverview[], url: string | null): Toast | null {
  const open = unanswered(projects);
  if (open.length === 0) return null;
  const targets = open.flatMap((p) => p.subtasks.filter((s) => s.todayTarget !== null && s.doneToday < s.todayTarget && (s.total !== null || s.done < 1)));
  const lines = [`What did you do today on ${names(open)}?`];
  if (targets.length) lines.push(`Planned today: ${targets.slice(0, 3).map((s) => (s.total === null ? s.title : `${s.todayTarget} ${s.unit ?? ''} ${s.title}`.replace(/ +/g, ' '))).join(' · ')}`);
  return {
    title: open.length === 1 ? 'Your project today' : 'Your projects today',
    lines,
    ...(url ? { url, actions: [{ kind: 'open' as const, label: 'Answer now', url }, { kind: 'dismiss' as const, label: 'Later' }] } : {}),
  };
}

export interface RunningService {
  /** What the API does with a browser report. Tests call it directly. */
  receiveTab(report: TabReport): void;
  /** What the API does with an editor heartbeat. */
  receiveEditor(heartbeat: EditorHeartbeat): void;
  /** What the API does with the extension's list of tabs playing sound. */
  receiveAudibleTabs(tabs: TabReport[]): void;
  /** What the API does with the extension's list of every window's active tab. */
  receiveVisibleTabs(tabs: TabReport[]): void;
  stop(): void;
}

export interface ServiceOptions {
  /** Starts the local API with this token. Without it, no port is opened. */
  apiToken?: string;
  /**
   * Where the token lives. Written with the port to api.json in the data folder,
   * so the editor extension can find the tracker without any setup.
   */
  tokenFile?: string;
  /** Called when `tracker stop` asks this process to exit. */
  onStopRequested?: () => void;
  /** Shows notifications. Without it, reminders and the evening log stay quiet. */
  notifier?: Notifier;
  /** Opens رقيب's window at an address (the morning page, the welcome-back page). */
  openWindow?: (url: string, size?: readonly [number, number]) => void;
  /** Reads which apps are playing sound. Without it, background audio isn't recorded. */
  audio?: AudioProbe;
  /** Reads what's on top of each screen. Without it, other screens aren't recorded. */
  screens?: ScreensProbe;
}

export function dbPath(): string {
  return join(dataDir(), 'data.db');
}

export function startService(
  config: Config,
  probe: SystemProbe,
  logger: Logger,
  options: ServiceOptions = {},
): RunningService {
  const store = new Store(dbPath());
  const maxGapMs = config.pollIntervalMs * GAP_TOLERANCE_INTERVALS;
  let merger = new EventMerger(maxGapMs, store.lastEvent());
  const journal = new Journal(dbPath());
  const audioRecorder = new AudioRecorder(journal, maxGapMs);
  const loudness = new LoudnessMemory();
  const processCache = new Map<number, { info: ProcessInfo | null; at: number }>();
  let audibleTabs: AudibleTab[] = [];
  let audioFailing = false;
  const screenRecorder = new SpanRecorder<ScreenSource>(
    (source, start, end) => journal.startScreen(source, start, end),
    (id, end) => journal.extendScreen(id, end),
    maxGapMs,
  );
  let visibleTabs: BrowserTab[] = [];
  let screensFailing = false;
  let screenCount: number | null = null;
  let plannerFailing = false;
  let apiPort: number | null = null;
  let wasLocked = false;
  let failing = false;
  let wasPausedUntil: number | null = null;
  // Coming back after a gap. The tracker not running counts as being away, from
  // your last input it recorded (idle is backdated to it).
  const lastStored = store.lastEvent();
  let returns: ReturnState = {
    lastSeenInputAt: lastStored ? (lastStored.activity.kind === 'idle' ? lastStored.start : lastStored.end) : null,
    wentAway: true,
  };

  const gamepads = new GamepadMonitor(probe.readGamepad);
  let controllers = 0;
  let gamepadsFailing = false;
  // Without this, closing a game after an hour away would backdate idle over the
  // whole hour, marking time idle while the game was in the foreground.
  let lastGameAt: number | null = null;
  let recentTabs: BrowserTab[] = [];
  let recentEditors: EditorReport[] = [];

  const receiveTab = ({ url, title }: TabReport): void => {
    recentTabs = rememberTab(recentTabs, { url, title, domain: domainOf(url), receivedAt: Date.now() });
  };

  const receiveAudibleTabs = (tabs: TabReport[]): void => {
    const at = Date.now();
    audibleTabs = tabs.map(({ url, title }) => ({ url, title, domain: domainOf(url), receivedAt: at }));
  };

  const receiveVisibleTabs = (tabs: TabReport[]): void => {
    const at = Date.now();
    visibleTabs = rememberVisibleTabs(visibleTabs, tabs.map(({ url, title }) => ({ url, title, domain: domainOf(url), receivedAt: at })));
  };

  const recordScreens = (at: number, recording: boolean): void => {
    if (!options.screens) return;
    try {
      if (!recording || !readSettings(journal).screens.enabled) {
        screenRecorder.tick(at, []);
        return;
      }
      const windows = options.screens.screenWindows();
      const count = options.screens.screenCount();
      if (count !== screenCount) {
        logger.info(`Screens: ${count}`);
        screenCount = count;
      }
      screenRecorder.tick(at, screenSources(windows, visibleTabs, at, config));
      if (screensFailing) logger.info('Screens: recovered');
      screensFailing = false;
    } catch (error) {
      // The other screens are a nice extra: trouble here must never stop window tracking.
      if (!screensFailing) logger.error('Recording other screens failed', error);
      screensFailing = true;
      screenRecorder.reset();
    }
  };

  const pollAudio = (): void => {
    if (!options.audio) return;
    try {
      if (!readSettings(journal).audio.enabled) return;
      loudness.hear(options.audio.readSessions(), Date.now());
      if (audioFailing) logger.info('Audio: recovered');
      audioFailing = false;
    } catch (error) {
      // Sound is a nice extra: trouble here must never stop window tracking.
      if (!audioFailing) logger.error('Audio poll failed', error);
      audioFailing = true;
    }
  };

  const playingNow = (at: number): ProcessInfo[] => {
    if (!options.audio) return [];
    const found: ProcessInfo[] = [];
    for (const pid of loudness.playing(at)) {
      let cached = processCache.get(pid);
      if (!cached || at - cached.at > PROCESS_INFO_TTL_MS) {
        cached = { info: options.audio.processInfo(pid), at };
        processCache.set(pid, cached);
      }
      if (cached.info) found.push(cached.info);
    }
    for (const [pid, entry] of processCache) if (at - entry.at > 4 * PROCESS_INFO_TTL_MS) processCache.delete(pid);
    return found;
  };

  const recordAudio = (at: number, recording: boolean): void => {
    try {
      const sources = recording && readSettings(journal).audio.enabled ? audioSources(playingNow(at), audibleTabs, at, config) : [];
      audioRecorder.tick(at, sources);
    } catch (error) {
      if (!audioFailing) logger.error('Recording audio failed', error);
      audioFailing = true;
      audioRecorder.reset();
    }
  };

  const pageUrl = (page: Page, away?: { start: number; end: number }): string | null =>
    apiPort === null || options.apiToken === undefined ? null : loginUrl(apiPort, options.apiToken, page, undefined, away);

  const show = (toast: Toast, what: string): Promise<void> =>
    options.notifier
      ? options.notifier.show(toast).catch((error: unknown) => logger.error(`Could not show the ${what} notification`, error))
      : Promise.resolve();

  const sendEvening = async (at: number): Promise<void> => {
    const day = await buildDay({ journal, dbPath: dbPath(), config }, dayKey(at), at);
    const done = day.tasks.filter((t) => t.doneAt !== null).length;
    const url = pageUrl('evening');
    const weekUrl = new Date(at).getDay() === 0 ? pageUrl('week') : null;
    const projectsLine = eveningProjectsLine(journal.projectOverviews(dayKey(at), journal.neglectAfterDays(), 'active'));
    const lines = [
      `${duration(day.activeMs)} active on the PC · ${duration(day.focusMs)} focused${day.tasks.length ? ` · tasks ${done}/${day.tasks.length}` : ''}`,
      day.gaps.length ? `${day.gaps.length} gap${day.gaps.length === 1 ? '' : 's'} (${duration(day.gapMs)}) to fill in` : 'No gaps left to fill in',
      ...(projectsLine ? [projectsLine] : []),
    ];
    await show(
      {
        title: 'Your day so far',
        lines,
        ...(url
          ? {
              url,
              actions: [
                { kind: 'open' as const, label: 'Log my day', url },
                // Sundays: the week is done, so offer its review too.
                ...(weekUrl ? [{ kind: 'open' as const, label: 'Weekly review', url: weekUrl }] : []),
                { kind: 'dismiss' as const, label: 'Later' },
              ],
            }
          : {}),
      },
      'evening',
    );
  };

  /** Asks what you were doing while away, unless you've logged it already. */
  const askAboutAway = (away: { start: number; end: number }, mode: BackMode): void => {
    const logged = union(journal.entriesBetween(away.start, away.end).map((e) => ({ start: Math.max(e.start, away.start), end: Math.min(e.end, away.end) })));
    const loggedMs = logged.reduce((s, i) => s + (i.end - i.start), 0);
    if (loggedMs >= 0.9 * (away.end - away.start)) return;
    const url = pageUrl('back', away);
    if (!url) return;
    logger.info(`Back after ${duration(away.end - away.start)}; asking by ${mode}`);
    if (mode === 'window' && options.openWindow) {
      options.openWindow(url, BACK_WINDOW_SIZE);
    } else if (options.notifier) {
      void show(
        {
          title: 'Welcome back',
          lines: [`You were away ${clock(away.start)}–${clock(away.end)} (${duration(away.end - away.start)})`, 'What were you doing?'],
          url,
          actions: [{ kind: 'open', label: 'Log it', url }, { kind: 'dismiss', label: 'Later' }],
        },
        'welcome-back',
      );
    }
  };

  /** Reminders, the morning page, the evening log, and asking about time away. Never lets a failure reach the tracking loop. */
  const plan = (at: number, locked: boolean, lastInputAt: number, tickGap: boolean, paused: boolean): void => {
    try {
      const settings = readSettings(journal);
      const returned = detectReturn(returns, { lastInputAt, locked, tickGap }, settings.gaps.minMinutes * 60_000);
      returns = returned.state;
      // While locked, wait: a toast nobody sees is no reminder.
      if (locked) return;
      for (const reminder of journal.reminders()) {
        const slot = dueSlot(reminder, at);
        if (slot === null) continue;
        journal.markFired(reminder.id, at); // First, so a slow or failed toast never repeats.
        void show(reminderToast(reminder, slot, at), 'reminder');
      }

      const state = readState(journal);
      const present = at - lastInputAt < PRESENT_MS;
      // The morning page and the evening log ask about the gaps themselves.
      let askedAlready = false;
      if (morningDue(settings, state, at, present)) {
        askedAlready = true;
        const url = pageUrl('morning');
        if (url && options.openWindow) {
          journal.set('state.morningShown', dayKey(at));
          logger.info('Opening the morning page');
          options.openWindow(url);
        }
      }
      if (eveningDue(settings, state, at, present) && options.notifier) {
        askedAlready = true;
        journal.set('state.eveningShown', dayKey(at));
        logger.info('Sending the evening log');
        sendEvening(at).catch((error: unknown) => logger.error('Could not put together the evening log', error));
      }
      if (projectReminderDue(settings, state, at, present) && options.notifier) {
        // Marked first, so a failing toast never repeats; skipped quietly when all are answered.
        journal.set('state.projectsReminded', dayKey(at));
        const toast = projectReminderToast(journal.projectOverviews(dayKey(at), journal.neglectAfterDays(), 'active'), pageUrl('evening'));
        if (toast) {
          askedAlready = true;
          logger.info('Sending the project reminder');
          void show(toast, 'projects');
        }
      }
      if (returned.away && !askedAlready && !paused && settings.back.mode !== 'off') askAboutAway(returned.away, settings.back.mode);
      plannerFailing = false;
    } catch (error) {
      if (!plannerFailing) logger.error('Planner failed', error);
      plannerFailing = true;
    }
  };

  const receiveEditor = (heartbeat: EditorHeartbeat): void => {
    recentEditors = rememberEditorReport(recentEditors, { ...heartbeat, receivedAt: Date.now() });
  };

  const pollGamepads = (): void => {
    try {
      gamepads.poll(Date.now());
      if (gamepads.connectedCount !== controllers) {
        controllers = gamepads.connectedCount;
        logger.info(`Controllers connected: ${controllers}`);
      }
      gamepadsFailing = false;
    } catch (error) {
      // Controller trouble must never stop window tracking.
      if (!gamepadsFailing) logger.error('Controller poll failed', error);
      gamepadsFailing = true;
    }
  };

  const tick = (): void => {
    try {
      const at = Date.now();
      if (options.onStopRequested && takeStopRequest(dataDir())) {
        logger.info('Stop requested');
        options.onStopRequested();
        return;
      }

      // While paused, record nothing at all, exactly as for a locked screen.
      const until = pausedUntil(dataDir(), at);
      if (until !== wasPausedUntil) {
        logger.info(until === null ? 'Resumed' : `Paused until ${new Date(until).toLocaleString('en-GB')}`);
        wasPausedUntil = until;
      }

      const otherActivityAt = Math.max(gamepads.lastActivityAt ?? -Infinity, lastGameAt ?? -Infinity);
      const sampled = sample(probe, config, at, otherActivityAt, recentTabs, recentEditors);
      const { lastInputAt, locked, inGame } = sampled;
      const activity = until === null ? sampled.activity : null;
      const { ops, gapMs } = merger.tick({ at, activity, lastInputAt });
      store.apply(ops);
      if (inGame) lastGameAt = at;
      recordAudio(at, !locked && until === null);
      recordScreens(at, !locked && until === null);
      plan(at, locked, lastInputAt, gapMs !== null, until !== null);

      if (gapMs !== null) logger.info(`Gap of ${Math.round(gapMs / 1000)}s between ticks; not bridged`);
      if (locked !== wasLocked) logger.info(locked ? 'Session locked' : 'Session unlocked');
      if (failing) logger.info('Recovered');
      wasLocked = locked;
      failing = false;
    } catch (error) {
      // The write rolled back, so the merger is ahead of the database. Rebuild
      // from what was actually stored. Log once per outage to keep the log useful.
      if (!failing) logger.error('Tick failed', error);
      failing = true;
      try {
        merger = new EventMerger(maxGapMs, store.lastEvent());
      } catch {
        // Database still unavailable; the next tick tries again.
      }
    }
  };

  logger.info(`Started: polling every ${config.pollIntervalMs}ms, idle after ${config.idleThresholdMs}ms`);
  pollGamepads();
  tick();
  const gamepadTimer = setInterval(pollGamepads, GAMEPAD_POLL_MS);
  const audioTimer = setInterval(pollAudio, AUDIO_POLL_MS);
  const timer = setInterval(tick, config.pollIntervalMs);

  let api: Server | null = null;
  if (options.apiToken !== undefined) {
    const ui = createUi({
      journal,
      dbPath: dbPath(),
      config,
      logger,
      token: options.apiToken,
      testReminder: (reminder) => show(reminderToast(reminder, Date.now(), Date.now()), 'reminder'),
      testEvening: () => sendEvening(Date.now()),
      testProjectReminder: async () => {
        const at = Date.now();
        const toast = projectReminderToast(journal.projectOverviews(dayKey(at), journal.neglectAfterDays(), 'active'), pageUrl('evening'));
        if (toast) await show(toast, 'projects');
        return toast !== null;
      },
    });
    api = createApi(options.apiToken, { onTab: receiveTab, onEditor: receiveEditor, onAudibleTabs: receiveAudibleTabs, onVisibleTabs: receiveVisibleTabs, ui }, logger);
    listen(api, config.api.port).then(
      (port) => {
        logger.info(`API listening on 127.0.0.1:${port}`);
        apiPort = port;
        if (options.tokenFile !== undefined) {
          try {
            writeFileSync(join(dataDir(), 'api.json'), `${JSON.stringify({ port, tokenFile: options.tokenFile }, null, 2)}\n`);
          } catch (error) {
            logger.error('Could not write api.json for the editor extension', error);
          }
        }
      },
      // Tracking windows matters more than the API, so carry on without it.
      (error: unknown) => logger.error(`API could not use port ${config.api.port}; continuing without it`, error),
    );
  }

  return {
    receiveTab,
    receiveEditor,
    receiveAudibleTabs,
    receiveVisibleTabs,
    stop(): void {
      api?.close();
      api?.closeAllConnections();
      clearInterval(gamepadTimer);
      clearInterval(audioTimer);
      clearInterval(timer);
      store.close();
      journal.close();
      logger.info('Stopped');
    },
  };
}
