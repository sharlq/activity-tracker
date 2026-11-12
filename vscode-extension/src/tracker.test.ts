import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { discover, trackerHome } from './tracker.ts';

const TOKEN = 'c'.repeat(64);

describe('discover', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tracker-discover-'));
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function setup(api: unknown, token: string = TOKEN): void {
    const tokenFile = join(home, 'api-token.txt');
    writeFileSync(tokenFile, `${token}\n`);
    writeFileSync(join(home, 'api.json'), JSON.stringify(api === 'default' ? { port: 5610, tokenFile } : api));
  }

  it('finds the port and token from api.json', async () => {
    setup('default');
    assert.deepEqual(await discover(home), { port: 5610, token: TOKEN });
  });

  it('returns null when the tracker has never run', async () => {
    assert.equal(await discover(home), null);
  });

  it('returns null for a malformed api.json or token', async () => {
    setup({ port: '5610', tokenFile: join(home, 'api-token.txt') });
    assert.equal(await discover(home), null);
    setup('default', 'not-a-token');
    assert.equal(await discover(home), null);
  });

  it('honours the same data-folder override as the tracker', () => {
    assert.equal(trackerHome({ ACTIVITY_TRACKER_HOME: 'D:\\elsewhere' }), 'D:\\elsewhere');
  });
});
