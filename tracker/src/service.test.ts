// Runs the whole service with a fake system and clock, checking what reaches the database.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Config } from './config.ts';
import type { GamepadState } from './gamepad.ts';
import { pause, requestStop } from './control.ts';
import { Logger } from './logger.ts';
import type { ForegroundWindow, SystemProbe } from './sampler.ts';
import type { RunningService } from './service.ts';
import { dbPath, startService } from './service.ts';
import { Store } from './store.ts';

const T0 = new Date(2026, 10, 5, 12).getTime();
const MINUTE = 60_000;

const GAME: ForegroundWindow = {
  processName: 'Hades.exe',
  exePath: 'D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe',
  title: 'Hades',
};
const DESKTOP: ForegroundWindow = {
  processName: 'explorer.exe',
  exePath: 'C:\\Windows\\explorer.exe',
  title: '',
};
const NEUTRAL: GamepadState = {
  buttons: 0,
  leftTrigger: 0,
  rightTrigger: 0,
  leftX: 0,
  leftY: 0,
  rightX: 0,
  rightY: 0,
};
const CONFIG: Config = {
  pollIntervalMs: 5000,
  idleThresholdMs: 2 * MINUTE,
  exclude: { apps: [], titleContains: [], domains: ['bank.com'] },
  gaming: { games: [] },
  browser: { fullUrlDomains: [] },
  api: { port: 0 },
};
const CHROME = (title: string): ForegroundWindow => ({
  processName: 'chrome.exe',
  exePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  title: `${title} - Google Chrome`,
});

describe('service', () => {
  let dir: string;
  let window: ForegroundWindow;
  let lastKeyboardAt: number;
  let gamepad: GamepadState | null;
  let service: RunningService | null;
  let probe: SystemProbe;

  /** Moves time in small steps: one big tick would look like a gap to the service. */
  function advance(ms: number): void {
    for (let elapsed = 0; elapsed < ms; elapsed += 200) mock.timers.tick(200);
  }

  function start(): void {
    service = startService(CONFIG, probe, new Logger({ file: join(dir, 'logs', 'test.log') }));
  }

  /** Stops the service and returns events oldest first, in minutes since the start. */
  function stored() {
    service?.stop();
    service = null;
    const store = new Store(dbPath());
    const events = store.recent(100).reverse();
    store.close();
    return events.map(({ activity, start: from, end }) => ({
      what: activity.kind === 'idle' ? 'idle' : (activity.domain ?? activity.processName),
      from: (from - T0) / MINUTE,
      to: (end - T0) / MINUTE,
    }));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracker-service-'));
    process.env['ACTIVITY_TRACKER_HOME'] = dir;
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });
    window = DESKTOP;
    lastKeyboardAt = T0;
    gamepad = null;
    service = null;
    probe = {
      isSessionLocked: () => false,
      foregroundWindow: () => window,
      idleMs: () => Date.now() - lastKeyboardAt,
      readGamepad: (slot) => (slot === 0 ? gamepad : null),
    };
  });

  afterEach(() => {
    service?.stop();
    mock.timers.reset();
    delete process.env['ACTIVITY_TRACKER_HOME'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('goes idle on the desktop, backdated to the last input', () => {
    start();
    advance(5 * MINUTE);
    assert.deepEqual(stored(), [
      { what: 'explorer.exe', from: 0, to: 0 },
      { what: 'idle', from: 0, to: 5 },
    ]);
  });

  it('never goes idle while a game is in the foreground', () => {
    window = GAME;
    start();
    advance(60 * MINUTE);
    assert.deepEqual(stored(), [{ what: 'Hades.exe', from: 0, to: 60 }]);
  });

  it('keeps all game time when the game closes while the user is away', () => {
    window = GAME;
    start();
    advance(60 * MINUTE);
    window = DESKTOP;
    advance(5 * MINUTE);

    const events = stored();
    const game = events.find((event) => event.what === 'Hades.exe');
    assert.ok(game && game.to >= 60, `game event was cut short: ${JSON.stringify(events)}`);
    assert.equal(events.at(-1)?.what, 'idle');
    assert.ok((events.at(-1)?.from as number) >= 60, 'idle must not overlap the game');
    assert.equal(events.at(-1)?.to, 65);
  });

  it('stays active on the desktop while the controller is in use, then goes idle', () => {
    gamepad = NEUTRAL;
    start();
    for (let minute = 1; minute <= 10; minute++) {
      advance(MINUTE);
      gamepad = { ...NEUTRAL, buttons: minute % 2 };
    }
    advance(5 * MINUTE);

    const events = stored();
    assert.equal(events.length, 2, JSON.stringify(events));
    assert.equal(events[0]?.what, 'explorer.exe');
    assert.equal(events[1]?.what, 'idle');
    assert.ok((events[0]?.to as number) >= 9, 'time using the controller should stay active');
  });

  it('keeps tracking windows when reading a controller throws', () => {
    probe.readGamepad = () => {
      throw new Error('driver problem');
    };
    window = GAME;
    start();
    advance(MINUTE);
    assert.deepEqual(stored(), [{ what: 'Hades.exe', from: 0, to: 1 }]);
  });
});

describe('service: browser tabs', () => {
  let dir: string;
  let window: ForegroundWindow;
  let service: RunningService | null;

  const probe: SystemProbe = {
    isSessionLocked: () => false,
    foregroundWindow: () => window,
    idleMs: () => 0,
    readGamepad: () => null,
  };

  function advance(ms: number): void {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) mock.timers.tick(1000);
  }

  function stored() {
    service?.stop();
    service = null;
    const store = new Store(dbPath());
    const events = store.recent(100).reverse();
    store.close();
    return events.map(({ activity, start, end }) => ({
      domain: activity.kind === 'window' ? (activity.domain ?? null) : 'idle',
      title: activity.kind === 'window' ? activity.title : '',
      seconds: (end - start) / 1000,
    }));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracker-service-tabs-'));
    process.env['ACTIVITY_TRACKER_HOME'] = dir;
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });
    service = null;
  });

  function start(first: ForegroundWindow, tab: { url: string; title: string }): void {
    window = first;
    service = startService(CONFIG, probe, new Logger({ file: join(dir, 'test.log') }));
    service.receiveTab(tab);
  }

  afterEach(() => {
    service?.stop();
    mock.timers.reset();
    delete process.env['ACTIVITY_TRACKER_HOME'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('splits Chrome time by site as tabs change', () => {
    start(CHROME('YouTube'), { url: 'https://www.youtube.com/', title: 'YouTube' });
    advance(29_000);
    window = CHROME('GitHub');
    service?.receiveTab({ url: 'https://github.com/', title: 'GitHub' });
    advance(21_000);
    assert.deepEqual(stored(), [
      // The first tick runs as the service starts, before any report arrives,
      // so Chrome is only recorded from the second tick.
      { domain: 'youtube.com', title: 'YouTube - Google Chrome', seconds: 25 },
      { domain: 'github.com', title: 'GitHub - Google Chrome', seconds: 20 },
    ]);
  });

  it('leaves no trace of an excluded site, in titles or anywhere else', () => {
    start(CHROME('YouTube'), { url: 'https://youtube.com/', title: 'YouTube' });
    advance(10_000);
    window = CHROME('Accounts - My Bank');
    service?.receiveTab({ url: 'https://online.bank.com/', title: 'Accounts - My Bank' });
    advance(60_000);
    const events = stored();
    assert.deepEqual(events.map((e) => e.domain), ['youtube.com']);
    assert.ok(!JSON.stringify(events).includes('Bank'));
  });

  it('stops recording Chrome when the extension stops reporting', () => {
    start(CHROME('YouTube'), { url: 'https://youtube.com/', title: 'YouTube' });
    advance(120_000);
    const events = stored();
    assert.deepEqual(events.map((e) => e.domain), ['youtube.com']);
    assert.ok((events[0]?.seconds as number) <= 50);
  });

  it('records nothing for a private window, which Chrome titles like any other', () => {
    start(CHROME('YouTube'), { url: 'https://youtube.com/', title: 'YouTube' });
    advance(10_000);
    // The extension can't see private windows, so its last report is still YouTube.
    window = CHROME('example.net');
    advance(60_000);
    const events = stored();
    assert.deepEqual(events.map((e) => e.domain), ['youtube.com']);
    assert.ok(!JSON.stringify(events).includes('example.net'));
  });
});

describe('service: editor heartbeats', () => {
  let dir: string;
  let window: ForegroundWindow;
  let service: RunningService | null;

  const probe: SystemProbe = {
    isSessionLocked: () => false,
    foregroundWindow: () => window,
    idleMs: () => 0,
    readGamepad: () => null,
  };
  const CURSOR = (file: string): ForegroundWindow => ({
    processName: 'Cursor.exe',
    exePath: 'C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe',
    title: `${file} - tracker - Cursor`,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracker-service-editor-'));
    process.env['ACTIVITY_TRACKER_HOME'] = dir;
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });
    service = null;
  });

  afterEach(() => {
    service?.stop();
    mock.timers.reset();
    delete process.env['ACTIVITY_TRACKER_HOME'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('splits editor time by language as files change, keeping the project and branch', () => {
    window = CURSOR('main.ts');
    service = startService(CONFIG, probe, new Logger({ file: join(dir, 'test.log') }));
    service.receiveEditor({ workspace: 'tracker', language: 'typescript', branch: 'main' });
    for (let i = 0; i < 29; i++) mock.timers.tick(1000);
    window = CURSOR('README.md');
    service.receiveEditor({ workspace: 'tracker', language: 'markdown', branch: 'main' });
    for (let i = 0; i < 21; i++) mock.timers.tick(1000);
    service.stop();
    service = null;

    const store = new Store(dbPath());
    const events = store.recent(10).reverse().map(({ activity, start, end }) => {
      const a = activity as { project?: string; language?: string; branch?: string };
      return { project: a.project ?? null, language: a.language ?? null, branch: a.branch ?? null, seconds: (end - start) / 1000 };
    });
    store.close();
    assert.deepEqual(events, [
      // The first tick runs before the first heartbeat, so it has no details.
      { project: null, language: null, branch: null, seconds: 5 },
      { project: 'tracker', language: 'typescript', branch: 'main', seconds: 25 },
      { project: 'tracker', language: 'markdown', branch: 'main', seconds: 20 },
    ]);
  });

  it('writes api.json so the editor extension can find the tracker', async () => {
    window = CURSOR('main.ts');
    mock.timers.reset(); // Real timers, so the server can start listening.
    service = startService(
      { ...CONFIG, api: { port: 0 } },
      probe,
      new Logger({ file: join(dir, 'test.log') }),
      { apiToken: 'd'.repeat(64), tokenFile: 'C:\\somewhere\\api-token.txt' },
    );
    const file = join(dir, 'api.json');
    for (let i = 0; i < 50 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 20));
    const written = JSON.parse(readFileSync(file, 'utf8')) as { port: number; tokenFile: string };
    assert.ok(written.port > 0);
    assert.equal(written.tokenFile, 'C:\\somewhere\\api-token.txt');
  });
});

describe('service: welcome back', () => {
  let dir: string;
  let service: RunningService | null = null;
  let locked = false;
  let lastInputAt = T0;
  const probe: SystemProbe = {
    isSessionLocked: () => locked,
    foregroundWindow: () => DESKTOP,
    idleMs: () => Date.now() - lastInputAt,
    readGamepad: () => null,
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracker-service-back-'));
    process.env['ACTIVITY_TRACKER_HOME'] = dir;
    locked = false;
    lastInputAt = T0;
  });

  afterEach(() => {
    service?.stop();
    service = null;
    mock.timers.reset();
    delete process.env['ACTIVITY_TRACKER_HOME'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('opens the small window asking about the time away, once you unlock after a gap', async () => {
    // Real timeouts let the API start listening; the clock and ticks are mocked.
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });
    const opened: { url: string; size: readonly [number, number] | undefined }[] = [];
    service = startService({ ...CONFIG, api: { port: 0 } }, probe, new Logger({ file: join(dir, 'test.log') }), {
      apiToken: 'e'.repeat(64),
      tokenFile: join(dir, 'token.txt'),
      openWindow: (url, size) => opened.push({ url, size }),
    });
    for (let i = 0; i < 50 && !existsSync(join(dir, 'api.json')); i++) await new Promise((r) => setTimeout(r, 20));
    const advance = (ms: number) => {
      for (let elapsed = 0; elapsed < ms; elapsed += 1000) mock.timers.tick(1000);
    };

    advance(10_000);
    lastInputAt = Date.now();
    advance(5000);
    const leftAt = lastInputAt;
    locked = true;
    advance(25 * MINUTE);
    assert.equal(opened.length, 0, 'nothing while locked');

    locked = false;
    lastInputAt = Date.now();
    advance(5000);
    assert.equal(opened.length, 1);
    const url = new URL(opened[0]!.url);
    assert.equal(url.searchParams.get('go'), 'back');
    assert.equal(url.searchParams.get('away'), `${leftAt}-${lastInputAt}`);
    assert.deepEqual(opened[0]!.size, [560, 720]);

    // A short break afterwards doesn't ask again.
    locked = true;
    advance(5 * MINUTE);
    locked = false;
    lastInputAt = Date.now();
    advance(5000);
    assert.equal(opened.length, 1);
  });
});

describe('service: pause and stop', () => {
  let dir: string;
  let service: RunningService | null;
  const probe: SystemProbe = {
    isSessionLocked: () => false,
    foregroundWindow: () => DESKTOP,
    idleMs: () => 0,
    readGamepad: () => null,
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracker-service-control-'));
    process.env['ACTIVITY_TRACKER_HOME'] = dir;
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });
    service = null;
  });

  afterEach(() => {
    service?.stop();
    mock.timers.reset();
    delete process.env['ACTIVITY_TRACKER_HOME'];
    rmSync(dir, { recursive: true, force: true });
  });

  const advance = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) mock.timers.tick(1000);
  };

  it('records nothing while paused, and carries on afterwards', () => {
    service = startService(CONFIG, probe, new Logger({ file: join(dir, 'test.log') }));
    advance(60_000);
    pause(dir, Date.now() + 10 * MINUTE);
    advance(10 * MINUTE + 30_000);
    service.stop();
    service = null;

    const store = new Store(dbPath());
    const events = store.recent(10).reverse().map((e) => [(e.start - T0) / 1000, (e.end - T0) / 1000]);
    store.close();
    // Recording stops at the pause and starts fresh after it, with nothing in between.
    assert.deepEqual(events, [[0, 60], [660, 690]]);
    const log = readFileSync(join(dir, 'test.log'), 'utf8');
    assert.match(log, /Paused until/);
    assert.match(log, /Resumed/);
  });

  it('calls back when a stop is requested', () => {
    let stopped = 0;
    service = startService(CONFIG, probe, new Logger({ file: join(dir, 'test.log') }), { onStopRequested: () => stopped++ });
    advance(10_000);
    requestStop(dir);
    advance(5000);
    assert.equal(stopped, 1);
  });
});
