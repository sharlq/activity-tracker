import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, loadConfig, loadOrCreateToken, parseConfig } from './config.ts';
import { parseLocalDate } from './dates.ts';

describe('parseConfig', () => {
  it('fills in defaults for missing values', () => {
    assert.deepEqual(parseConfig('{}'), DEFAULT_CONFIG);
  });

  it('reads exclusions', () => {
    const { exclude } = parseConfig('{"exclude":{"apps":["bank.exe"],"titleContains":["secret"]}}');
    assert.deepEqual(exclude, { apps: ['bank.exe'], titleContains: ['secret'], domains: [] });
  });

  it('reads browser settings and normalizes domain entries', () => {
    const config = parseConfig(
      '{"exclude":{"domains":["*.Bank.com"]},"browser":{"fullUrlDomains":["www.github.com"]},"api":{"port":6000}}',
    );
    assert.deepEqual(config.exclude.domains, ['bank.com']);
    assert.deepEqual(config.browser.fullUrlDomains, ['github.com']);
    assert.equal(config.api.port, 6000);
  });

  it('rejects URLs where a domain is expected, and bad ports', () => {
    assert.throws(() => parseConfig('{"exclude":{"domains":["https://bank.com"]}}'), /exclude\.domains/);
    assert.throws(() => parseConfig('{"browser":{"fullUrlDomains":["github.com/me"]}}'), /fullUrlDomains/);
    assert.throws(() => parseConfig('{"api":{"port":70000}}'), /api\.port/);
    assert.throws(() => parseConfig('{"api":{"port":56.1}}'), /api\.port/);
  });

  it('reads the manual game list', () => {
    assert.deepEqual(parseConfig('{"gaming":{"games":["celeste"]}}').gaming, { games: ['celeste'] });
  });

  it('rejects malformed values instead of ignoring them', () => {
    assert.throws(() => parseConfig('not json'));
    assert.throws(() => parseConfig('[]'));
    assert.throws(() => parseConfig('{"pollIntervalMs":0}'), /pollIntervalMs/);
    assert.throws(() => parseConfig('{"idleThresholdMs":"2m"}'), /idleThresholdMs/);
    assert.throws(() => parseConfig('{"exclude":"bank"}'), /exclude/);
    assert.throws(() => parseConfig('{"exclude":{"apps":"bank.exe"}}'), /exclude\.apps/);
    assert.throws(() => parseConfig('{"exclude":{"titleContains":[""]}}'), /titleContains/);
    assert.throws(() => parseConfig('{"gaming":null}'), /gaming/);
    assert.throws(() => parseConfig('{"gaming":{"games":"celeste"}}'), /gaming\.games/);
  });

  it('parses the config file shipped with the project', () => {
    const config = loadConfig();
    assert.equal(config.pollIntervalMs, 5000);
    assert.equal(config.idleThresholdMs, 120_000);
  });
});

describe('parseLocalDate', () => {
  it('returns local midnight', () => {
    assert.equal(parseLocalDate('2026-11-05'), new Date(2026, 10, 5).getTime());
  });

  it('rejects anything else, including dates that do not exist', () => {
    for (const bad of ['2026-02-31', '2026-13-01', '2026-1-5', '05/11/2026', 'yesterday', '']) {
      assert.equal(parseLocalDate(bad), null, bad);
    }
  });
});

describe('loadOrCreateToken', () => {
  it('creates a 64-character token once and then keeps returning it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracker-token-'));
    try {
      const file = join(dir, 'api-token.txt');
      const token = loadOrCreateToken(file);
      assert.match(token, /^[0-9a-f]{64}$/);
      assert.equal(loadOrCreateToken(file), token);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a damaged token file instead of quietly replacing it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracker-token-'));
    try {
      const file = join(dir, 'api-token.txt');
      writeFileSync(file, 'oops');
      assert.throws(() => loadOrCreateToken(file), /malformed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
