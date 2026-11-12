import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ForegroundWindow, SampleRules, SystemProbe } from './sampler.ts';
import type { BrowserTab } from './browser.ts';
import { sample } from './sampler.ts';

const NOW = 1_000_000;
const WINDOW: ForegroundWindow = {
  processName: 'firefox.exe',
  exePath: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  title: 'My Bank - Mozilla Firefox',
};
const CHROME_WINDOW: ForegroundWindow = {
  processName: 'chrome.exe',
  exePath: 'C:\\Program Files\\Google\\Chrome\\chrome.exe',
  title: 'My Bank - Google Chrome',
};
const RULES: SampleRules = {
  idleThresholdMs: 120_000,
  exclude: { apps: [], titleContains: [], domains: [] },
  gaming: { games: [] },
  browser: { fullUrlDomains: [] },
};

function probe(overrides: Partial<{ locked: boolean; window: ForegroundWindow | null; idleMs: number }> = {}): SystemProbe {
  const { locked = false, window = WINDOW, idleMs = 0 } = overrides;
  return {
    isSessionLocked: () => locked,
    foregroundWindow: () => window,
    idleMs: () => idleMs,
    readGamepad: () => null,
  };
}

const withExclude = (exclude: Partial<SampleRules['exclude']>): SampleRules => ({
  ...RULES,
  exclude: { ...RULES.exclude, ...exclude },
});

describe('sample', () => {
  it('reports the foreground window while the user is active', () => {
    assert.deepEqual(sample(probe(), RULES, NOW).activity, { kind: 'window', ...WINDOW });
  });

  it('becomes idle exactly at the threshold and not before', () => {
    assert.deepEqual(sample(probe({ idleMs: 119_999 }), RULES, NOW).activity, { kind: 'window', ...WINDOW });
    assert.deepEqual(sample(probe({ idleMs: 120_000 }), RULES, NOW).activity, { kind: 'idle', window: WINDOW });
  });

  it('reports when the last input happened', () => {
    assert.equal(sample(probe({ idleMs: 5000 }), RULES, NOW).lastInputAt, NOW - 5000);
  });

  it('records nothing while locked, even when also idle', () => {
    const result = sample(probe({ locked: true, idleMs: 999_999 }), RULES, NOW);
    assert.equal(result.activity, null);
    assert.equal(result.locked, true);
  });

  it('asks to keep the open event when there is no foreground window', () => {
    assert.equal(sample(probe({ window: null }), RULES, NOW).activity, 'unchanged');
  });

  it('prefers idle over a missing foreground window', () => {
    assert.deepEqual(sample(probe({ window: null, idleMs: 200_000 }), RULES, NOW).activity, { kind: 'idle' });
  });
});

describe('sample: exclusions', () => {
  const excludedBy = (exclude: Partial<SampleRules['exclude']>) =>
    sample(probe(), withExclude(exclude), NOW).activity === null;

  it('matches app names ignoring case, with or without .exe', () => {
    assert.ok(excludedBy({ apps: ['FIREFOX.EXE'] }));
    assert.ok(excludedBy({ apps: ['firefox'] }));
  });

  it('matches a full exe path', () => {
    assert.ok(excludedBy({ apps: [WINDOW.exePath as string] }));
  });

  it('does not match part of an app name', () => {
    assert.ok(!excludedBy({ apps: ['firef'] }));
  });

  it('matches title text ignoring case', () => {
    assert.ok(excludedBy({ titleContains: ['my bank'] }));
    assert.ok(!excludedBy({ titleContains: ['other bank'] }));
  });

  it('records no idle for an excluded app, and does not reveal why', () => {
    const result = sample(probe({ idleMs: 999_999 }), withExclude({ apps: ['firefox'] }), NOW);
    assert.deepEqual(result, { activity: null, lastInputAt: NOW - 999_999, locked: false, inGame: false });
  });
});

describe('sample: controller input', () => {
  const LONG_AGO = 999_999;

  it('keeps the user active when only the controller was used recently', () => {
    const result = sample(probe({ idleMs: LONG_AGO }), RULES, NOW, NOW - 1000);
    assert.deepEqual(result.activity, { kind: 'window', ...WINDOW });
    assert.equal(result.lastInputAt, NOW - 1000);
  });

  it('goes idle when both keyboard and controller have been quiet', () => {
    const result = sample(probe({ idleMs: LONG_AGO }), RULES, NOW, NOW - 120_000);
    assert.deepEqual(result.activity, { kind: 'idle', window: WINDOW });
  });

  it('uses the keyboard time when it is the more recent input', () => {
    assert.equal(sample(probe({ idleMs: 1000 }), RULES, NOW, NOW - 50_000).lastInputAt, NOW - 1000);
  });

  it('goes idle as normal when no controller has ever been used', () => {
    assert.deepEqual(sample(probe({ idleMs: LONG_AGO }), RULES, NOW).activity, { kind: 'idle', window: WINDOW });
  });
});

describe('sample: never idle in a game', () => {
  const GAME: ForegroundWindow = {
    processName: 'Hades.exe',
    exePath: 'D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe',
    title: 'Hades',
  };
  const LAUNCHER: ForegroundWindow = {
    processName: 'steam.exe',
    exePath: 'C:\\Program Files (x86)\\Steam\\steam.exe',
    title: 'Steam',
  };
  const LONG_AGO = 999_999;

  it('stays on the game however long there has been no input', () => {
    const result = sample(probe({ window: GAME, idleMs: LONG_AGO }), RULES, NOW);
    assert.deepEqual(result.activity, { kind: 'window', ...GAME });
  });

  it('reports being in a game only while one is actually recorded', () => {
    assert.equal(sample(probe({ window: GAME }), RULES, NOW).inGame, true);
    assert.equal(sample(probe({ window: LAUNCHER }), RULES, NOW).inGame, false);
    assert.equal(sample(probe({ window: GAME, locked: true }), RULES, NOW).inGame, false);
    assert.equal(sample(probe({ window: GAME }), withExclude({ apps: ['hades'] }), NOW).inGame, false);
  });

  it('applies to games from the manual list too', () => {
    const rules = { ...RULES, gaming: { games: ['firefox'] } };
    assert.deepEqual(sample(probe({ idleMs: LONG_AGO }), rules, NOW).activity, { kind: 'window', ...WINDOW });
  });

  it('does not apply to launchers, which still go idle', () => {
    assert.deepEqual(sample(probe({ window: LAUNCHER, idleMs: LONG_AGO }), RULES, NOW).activity, { kind: 'idle', window: LAUNCHER });
  });

  it('records nothing for a game while locked', () => {
    assert.equal(sample(probe({ window: GAME, locked: true, idleMs: LONG_AGO }), RULES, NOW).activity, null);
  });

  it('records nothing for an excluded game', () => {
    const rules = withExclude({ apps: ['hades'] });
    assert.equal(sample(probe({ window: GAME, idleMs: LONG_AGO }), rules, NOW).activity, null);
  });
});

describe('sample: browser tabs', () => {
  const BANK_TAB: BrowserTab = {
    url: 'https://online.bank.com/accounts',
    domain: 'online.bank.com',
    title: 'My Bank',
    receivedAt: NOW - 1000,
  };

  const chrome = () => probe({ window: CHROME_WINDOW });

  it('adds the domain from a matching tab report to the Chrome window', () => {
    assert.deepEqual(sample(chrome(), RULES, NOW, -Infinity, [BANK_TAB]).activity, {
      kind: 'window',
      ...CHROME_WINDOW,
      domain: 'online.bank.com',
    });
  });

  it('adds the full URL only for allowlisted domains', () => {
    const rules = { ...RULES, browser: { fullUrlDomains: ['bank.com'] } };
    const activity = sample(chrome(), rules, NOW, -Infinity, [BANK_TAB]).activity as { url?: string };
    assert.equal(activity.url, 'https://online.bank.com/accounts');
  });

  it('records nothing at all for an excluded domain, and does not reveal why', () => {
    const result = sample(chrome(), withExclude({ domains: ['bank.com'] }), NOW, -Infinity, [BANK_TAB]);
    assert.deepEqual(result, { activity: null, lastInputAt: NOW, locked: false, inGame: false });
  });

  it('leaves other browsers to window titles alone', () => {
    assert.deepEqual(sample(probe(), RULES, NOW, -Infinity, [BANK_TAB]).activity, { kind: 'window', ...WINDOW });
  });

  it('records nothing for Chrome when no report vouches for the window', () => {
    const result = sample(chrome(), RULES, NOW, -Infinity, []);
    assert.deepEqual(result, { activity: null, lastInputAt: NOW, locked: false, inGame: false });
  });
});

describe('sample: what was on screen while idle', () => {
  const LONG_AGO = 999_999;
  const CHROME_TAB: BrowserTab = { url: 'https://docs.example.com/guide', domain: 'docs.example.com', title: 'Guide', receivedAt: NOW - 1000 };
  const chromeWindow: ForegroundWindow = { processName: 'chrome.exe', exePath: 'C:\\g\\chrome.exe', title: 'Guide - Google Chrome' };

  it('keeps the site you were reading', () => {
    const result = sample(probe({ window: chromeWindow, idleMs: LONG_AGO }), RULES, NOW, -Infinity, [CHROME_TAB]);
    assert.deepEqual(result.activity, { kind: 'idle', window: { ...chromeWindow, domain: 'docs.example.com' } });
  });

  it('keeps the editor project you were reading', () => {
    const cursor: ForegroundWindow = { processName: 'Cursor.exe', exePath: 'C:\\c\\Cursor.exe', title: 'main.ts - tracker - Cursor' };
    const editors = [{ workspace: 'tracker', language: 'typescript', branch: 'main', receivedAt: NOW - 60_000 }];
    const result = sample(probe({ window: cursor, idleMs: LONG_AGO }), RULES, NOW, -Infinity, [], editors);
    assert.deepEqual(result.activity, { kind: 'idle', window: { ...cursor, project: 'tracker', language: 'typescript', branch: 'main' } });
  });

  it('still records nothing for an excluded site or a private Chrome window, even when idle', () => {
    const excluded = sample(probe({ window: chromeWindow, idleMs: LONG_AGO }), withExclude({ domains: ['example.com'] }), NOW, -Infinity, [CHROME_TAB]);
    assert.equal(excluded.activity, null);
    const unvouched = sample(probe({ window: chromeWindow, idleMs: LONG_AGO }), RULES, NOW, -Infinity, []);
    assert.equal(unvouched.activity, null);
  });
});
