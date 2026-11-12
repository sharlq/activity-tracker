import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { WindowActivity } from './categories.ts';
import { categorize, detailOf, parseCategories } from './categories.ts';

const win = (changes: Partial<WindowActivity> = {}): WindowActivity => ({
  kind: 'window',
  processName: 'chrome.exe',
  exePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  title: 'Something - Google Chrome',
  ...changes,
});
const rules = (list: object[], extra: object = {}) => parseCategories(JSON.stringify({ rules: list, ...extra }));

describe('categorize', () => {
  it('uses the first rule that matches', () => {
    const config = rules([
      { category: 'video', domain: 'youtube.com' },
      { category: 'work', process: 'chrome' },
    ]);
    assert.equal(categorize(win({ domain: 'youtube.com' }), config, []), 'video');
    assert.equal(categorize(win({ domain: 'github.com' }), config, []), 'work');
  });

  it('falls back to other, and always calls idle idle', () => {
    const config = rules([{ category: 'work', process: 'Code' }]);
    assert.equal(categorize(win(), config, []), 'other');
    assert.equal(categorize({ kind: 'idle' }, config, []), 'idle');
  });

  it('requires every condition in a rule, and any item in a list', () => {
    const config = rules([{ category: 'learning', process: 'chrome', title: ['Tutorial', 'Course'] }]);
    assert.equal(categorize(win({ title: 'React course - Google Chrome' }), config, []), 'learning');
    assert.equal(categorize(win({ processName: 'firefox.exe', title: 'React course' }), config, []), 'other');
    assert.equal(categorize(win({ title: 'Inbox' }), config, []), 'other');
  });

  it('matches each kind of condition', () => {
    const cases: Array<[object, Partial<WindowActivity>]> = [
      [{ process: 'CHROME' }, {}],
      [{ process: 'chrome.exe' }, {}],
      [{ exePath: '\\google\\chrome\\' }, {}],
      [{ title: 'something' }, {}],
      [{ domain: 'google.com' }, { domain: 'mail.google.com' }],
      [{ domain: '*' }, { domain: 'anything.io' }],
      [{ project: 'Tracker' }, { project: 'tracker' }],
      [{ project: '*' }, { project: 'anything' }],
    ];
    for (const [condition, changes] of cases) {
      assert.equal(categorize(win(changes), rules([{ category: 'work', ...condition }]), []), 'work', JSON.stringify(condition));
    }
  });

  it('does not let "*" match when the detail is missing', () => {
    assert.equal(categorize(win(), rules([{ category: 'work', domain: '*' }]), []), 'other');
    assert.equal(categorize(win(), rules([{ category: 'work', project: '*' }]), []), 'other');
  });

  it('uses the gaming rules for games and launchers, including the manual list', () => {
    const config = rules([
      { category: 'gaming', gaming: 'game' },
      { category: 'game launcher', gaming: 'launcher' },
    ]);
    assert.equal(categorize(win({ processName: 'Hades.exe', exePath: 'D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe' }), config, []), 'gaming');
    assert.equal(categorize(win({ processName: 'steam.exe', exePath: 'C:\\Program Files (x86)\\Steam\\steam.exe' }), config, []), 'game launcher');
    assert.equal(categorize(win({ processName: 'Celeste.exe', exePath: 'C:\\Games\\Celeste.exe' }), config, ['celeste']), 'gaming');
  });
});

describe('parseCategories', () => {
  it('rejects mistakes instead of ignoring them', () => {
    assert.throws(() => rules([{ category: 'wrok', process: 'x' }]), /not a category/);
    assert.throws(() => rules([{ category: 'work', proces: 'x' }]), /unknown condition "proces"/);
    assert.throws(() => rules([{ category: 'work' }]), /no conditions/);
    assert.throws(() => rules([{ category: 'work', title: [] }]), /must be text/);
    assert.throws(() => rules([{ category: 'idle', process: 'x' }]), /idle is assigned automatically/);
    assert.throws(() => rules([{ category: 'gaming', gaming: 'yes' }]), /"game" or "launcher"/);
    assert.throws(() => rules([], { focus: ['werk'] }), /not a category/);
  });

  it('allows a free-text note on a rule', () => {
    assert.doesNotThrow(() => rules([{ category: 'work', process: 'x', note: 'why this rule exists' }]));
  });
});

describe('the shipped config/categories.json', () => {
  const file = fileURLToPath(new URL('../../config/categories.json', import.meta.url));
  const config = parseCategories(readFileSync(file, 'utf8'));
  const chrome = (domain: string) => win({ domain, title: `${domain} - Google Chrome` });

  it('parses', () => {
    assert.ok(config.rules.length > 10);
  });

  it('sorts your usual apps and sites as expected', () => {
    const expectations: Array<[WindowActivity, string]> = [
      [win({ processName: 'Cursor.exe', exePath: 'C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe', title: 'x - Cursor' }), 'work'],
      [win({ processName: 'claude.exe', exePath: 'C:\\x\\claude.exe', title: 'Claude' }), 'work'],
      [chrome('github.com'), 'work'],
      [chrome('edways.atlassian.net'), 'work'],
      [chrome('dev.edways.com'), 'work'],
      [chrome('youtube.com'), 'video'],
      [chrome('reddit.com'), 'social media'],
      [chrome('web.whatsapp.com'), 'messaging'],
      [win({ processName: 'WhatsApp.Root.exe', exePath: 'C:\\Program Files\\WindowsApps\\5319275A.WhatsAppDesktop_2.2540.6.0_x64__cv1g1gvanyjgm\\WhatsApp.Root.exe', title: 'WhatsApp' }), 'messaging'],
      [chrome('bbc.com'), 'news'],
      [win({ processName: 'Riot Client.exe', exePath: 'C:\\Riot Games\\Riot Client\\Riot Client.exe', title: 'Riot Client' }), 'game launcher'],
      [win({ processName: 'League of Legends.exe', exePath: 'C:\\Riot Games\\League of Legends\\Game\\League of Legends.exe', title: 'League of Legends (TM) Client' }), 'gaming'],
      [win({ processName: 'FoxitPDFReader.exe', exePath: 'C:\\x\\FoxitPDFReader.exe', title: 'AWS Certified Cloud Practitioner.pdf - Foxit' }), 'learning'],
    ];
    for (const [activity, category] of expectations) {
      assert.equal(categorize(activity, config, []), category, `${activity.processName} ${activity.domain ?? ''}`);
    }
  });

  it('counts a project in any editor as work, ahead of the site rules', () => {
    assert.equal(categorize(win({ processName: 'Code.exe', project: 'website', domain: 'youtube.com' }), config, []), 'work');
  });
});

describe('detailOf', () => {
  it('prefers project, then game, then site, then app name', () => {
    assert.equal(detailOf(win({ project: 'backend', domain: 'github.com' }), []), 'backend');
    assert.equal(detailOf(win({ processName: 'Hades.exe', exePath: 'D:\\steamapps\\common\\Hades\\Hades.exe' }), []), 'Hades');
    assert.equal(detailOf(win({ domain: 'github.com' }), []), 'github.com');
    assert.equal(detailOf(win(), []), 'chrome');
    assert.equal(detailOf({ kind: 'idle' }, []), 'idle');
  });
});
