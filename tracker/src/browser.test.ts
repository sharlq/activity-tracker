import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BrowserRules, BrowserTab } from './browser.ts';
import { TAB_FRESH_MS, domainMatches, domainOf, normalizeDomainEntry, rememberTab, tabContext } from './browser.ts';

const NOW = 1_000_000;
const RULES: BrowserRules = { excludeDomains: [], fullUrlDomains: [] };
const CHROME = { processName: 'chrome.exe', title: 'Pull requests - GitHub - Google Chrome' };
const tab = (changes: Partial<BrowserTab> = {}): BrowserTab => ({
  url: 'https://github.com/pulls?q=open#top',
  domain: 'github.com',
  title: 'Pull requests - GitHub',
  receivedAt: NOW - 1000,
  ...changes,
});

describe('domainOf', () => {
  it('returns the lowercase host without www', () => {
    assert.equal(domainOf('https://WWW.YouTube.com/watch?v=1'), 'youtube.com');
    assert.equal(domainOf('http://docs.github.com/en'), 'docs.github.com');
    assert.equal(domainOf('http://127.0.0.1:3000/'), '127.0.0.1');
  });

  it('returns null for pages that are not websites', () => {
    for (const url of ['chrome://newtab/', 'file:///C:/Users/me/secret.pdf', 'chrome-extension://abc/x.html', 'not a url']) {
      assert.equal(domainOf(url), null, url);
    }
  });
});

describe('domainMatches', () => {
  it('matches the domain and its subdomains, but not lookalikes', () => {
    assert.ok(domainMatches('bank.com', 'bank.com'));
    assert.ok(domainMatches('login.bank.com', 'bank.com'));
    assert.ok(!domainMatches('mybank.com', 'bank.com'));
    assert.ok(!domainMatches('bank.com.evil.io', 'bank.com'));
  });

  it('accepts entries written with www., *. or capitals', () => {
    assert.equal(normalizeDomainEntry(' *.Bank.com '), 'bank.com');
    assert.ok(domainMatches('bank.com', 'www.bank.com'));
    assert.ok(domainMatches('online.bank.com', '*.BANK.com'));
  });
});

describe('tabContext', () => {
  it('attaches the domain, but not the URL, to the matching Chrome window', () => {
    assert.deepEqual(tabContext(CHROME, [tab()], NOW, RULES), { domain: 'github.com', url: null });
  });

  it('keeps the full URL only for allowlisted domains, without its #fragment', () => {
    const rules = { ...RULES, fullUrlDomains: ['github.com'] };
    assert.deepEqual(tabContext(CHROME, [tab()], NOW, rules), {
      domain: 'github.com',
      url: 'https://github.com/pulls?q=open',
    });
  });

  it('strips login details from a stored URL', () => {
    const rules = { ...RULES, fullUrlDomains: ['github.com'] };
    const result = tabContext(CHROME, [tab({ url: 'https://me:hunter2@github.com/x' })], NOW, rules);
    assert.deepEqual(result, { domain: 'github.com', url: 'https://github.com/x' });
  });

  it('ignores reports for other apps', () => {
    assert.equal(tabContext({ processName: 'Code.exe', title: CHROME.title }, [tab()], NOW, RULES), null);
  });

  it('hides a Chrome window whose title does not match the report: a private window, another window, or a tab change in flight', () => {
    assert.equal(tabContext({ ...CHROME, title: 'Inbox - Gmail - Google Chrome' }, [tab()], NOW, RULES), 'hidden');
  });

  it('hides a private window titled like a normal one, as Chrome 156 does', () => {
    const privateWindow = { processName: 'chrome.exe', title: 'example.net - Google Chrome' };
    assert.equal(tabContext(privateWindow, [tab()], NOW, RULES), 'hidden');
  });

  it('hides Chrome entirely when there is no report at all', () => {
    assert.equal(tabContext(CHROME, [], NOW, RULES), 'hidden');
  });

  it('does not trust a report with an empty title, which would match any window', () => {
    assert.equal(tabContext(CHROME, [tab({ title: '' })], NOW, RULES), 'hidden');
  });

  it('does not trust a stale report', () => {
    assert.equal(tabContext(CHROME, [tab({ receivedAt: NOW - TAB_FRESH_MS - 1 })], NOW, RULES), 'hidden');
    assert.notEqual(tabContext(CHROME, [tab({ receivedAt: NOW - TAB_FRESH_MS })], NOW, RULES), 'hidden');
  });

  it('hides excluded domains, including subdomains', () => {
    const rules = { ...RULES, excludeDomains: ['github.com'] };
    assert.equal(tabContext(CHROME, [tab({ domain: 'gist.github.com' })], NOW, rules), 'hidden');
  });

  it('records no domain for non-web pages', () => {
    const newTab = tab({ url: 'chrome://newtab/', domain: null, title: 'New Tab' });
    assert.deepEqual(tabContext({ ...CHROME, title: 'New Tab - Google Chrome' }, [newTab], NOW, RULES), {
      domain: null,
      url: null,
    });
  });
});

describe('tabContext with several reports', () => {
  it('uses the report matching the window, even if a different one arrived later', () => {
    // Address and title reports raced; the older one is the page now on screen.
    const reports = [tab(), tab({ url: 'https://github.com/', title: 'GitHub', receivedAt: NOW - 500 })];
    assert.deepEqual(tabContext(CHROME, reports, NOW, RULES), { domain: 'github.com', url: null });
  });

  it('prefers the newest of several matching reports', () => {
    const reports = [tab({ domain: 'old.github.com' }), tab({ domain: 'github.com', receivedAt: NOW - 10 })];
    assert.deepEqual(tabContext(CHROME, reports, NOW, RULES), { domain: 'github.com', url: null });
  });

  it('still hides an excluded site when that is the report matching the window', () => {
    const rules = { ...RULES, excludeDomains: ['github.com'] };
    const reports = [tab({ url: 'https://news.site/', domain: 'news.site', title: 'News' }), tab()];
    assert.equal(tabContext(CHROME, reports, NOW, rules), 'hidden');
  });
});

describe('rememberTab', () => {
  it('drops reports too old to use and keeps the newest last', () => {
    const old = tab({ receivedAt: 0 });
    const kept = tab({ receivedAt: NOW - 1000 });
    const latest = tab({ receivedAt: NOW });
    assert.deepEqual(rememberTab([old, kept], latest), [kept, latest]);
  });

  it('keeps at most 20 reports', () => {
    let tabs: BrowserTab[] = [];
    for (let i = 0; i < 30; i++) tabs = rememberTab(tabs, tab({ receivedAt: NOW + i }));
    assert.equal(tabs.length, 20);
    assert.equal(tabs.at(-1)?.receivedAt, NOW + 29);
  });
});
