import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { EditorHeartbeat, TabReport } from './api.ts';
import { createApi, listen } from './api.ts';
import { Logger } from './logger.ts';

const TOKEN = 'a'.repeat(64);

describe('API', () => {
  let dir: string;
  let server: Server;
  let port: number;
  let received: TabReport[];
  let editors: EditorHeartbeat[];

  /** Raw request, so tests can send headers fetch() won't allow, such as Host. */
  function call(
    path: string,
    { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } },
        (res) => {
          let text = '';
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  const auth = { authorization: `Bearer ${TOKEN}` };
  const json = { ...auth, 'content-type': 'application/json' };
  const postTab = (body: unknown, headers: Record<string, string> = json) =>
    call('/v1/browser/tab', { method: 'POST', headers, body: JSON.stringify(body) });

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tracker-api-'));
    const logger = new Logger({ file: join(dir, 'api.log') });
    server = createApi(TOKEN, { onTab: (tab) => received.push(tab), onEditor: (beat) => editors.push(beat) }, logger);
    port = await listen(server, 0);
  });

  after(() => {
    server.close();
    server.closeAllConnections();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    received = [];
    editors = [];
  });

  it('listens on 127.0.0.1 only', () => {
    assert.equal((server.address() as { address: string }).address, '127.0.0.1');
  });

  it('answers ping with the right token', async () => {
    assert.deepEqual(await call('/v1/ping', { headers: auth }), { status: 200, body: '{"ok":true}' });
  });

  it('accepts localhost as the host too', async () => {
    const response = await call('/v1/ping', { headers: { ...auth, host: `localhost:${port}` } });
    assert.equal(response.status, 200);
  });

  it('rejects a missing, wrong, or differently sized token', async () => {
    const attempts: Array<Record<string, string>> = [
      {},
      { authorization: `Bearer ${'b'.repeat(64)}` },
      { authorization: 'Bearer short' },
    ];
    for (const headers of attempts) {
      assert.equal((await call('/v1/ping', { headers })).status, 401);
    }
  });

  it('rejects other hosts, even with the right token (DNS rebinding)', async () => {
    for (const host of ['evil.example', `evil.example:${port}`, '127.0.0.1:1']) {
      assert.equal((await call('/v1/ping', { headers: { ...auth, host } })).status, 403, host);
    }
  });

  it('hands a valid tab report to the tracker', async () => {
    const response = await postTab({ url: 'https://example.com', title: 'Example' });
    assert.equal(response.status, 204);
    assert.deepEqual(received, [{ url: 'https://example.com', title: 'Example' }]);
  });

  it('drops unknown fields from a tab report', async () => {
    await postTab({ url: 'https://example.com', title: 'Example', extra: 'ignored' });
    assert.deepEqual(received, [{ url: 'https://example.com', title: 'Example' }]);
  });

  it('rejects malformed tab reports without passing them on', async () => {
    assert.equal((await postTab({ url: 42, title: 'x' })).status, 400);
    assert.equal((await postTab({ url: 'https://x.com' })).status, 400);
    assert.equal((await postTab({ url: 'https://x.com/' + 'a'.repeat(9000), title: 'x' })).status, 400);
    assert.equal((await call('/v1/browser/tab', { method: 'POST', headers: json, body: '{not json' })).status, 400);
    assert.deepEqual(received, []);
  });

  const postEditor = (body: unknown) =>
    call('/v1/editor/heartbeat', { method: 'POST', headers: json, body: JSON.stringify(body) });

  it('hands an editor heartbeat to the tracker', async () => {
    const response = await postEditor({ workspace: 'tracker', language: 'typescript', branch: 'main' });
    assert.equal(response.status, 204);
    assert.deepEqual(editors, [{ workspace: 'tracker', language: 'typescript', branch: 'main' }]);
  });

  it('keeps only workspace, language, and branch from an editor heartbeat, never anything else', async () => {
    await postEditor({ workspace: 'tracker', language: null, content: 'const secret = 1;', file: 'C:\\a.ts' });
    assert.deepEqual(editors, [{ workspace: 'tracker', language: null, branch: null }]);
  });

  it('rejects malformed editor heartbeats', async () => {
    assert.equal((await postEditor({ workspace: 42 })).status, 400);
    assert.equal((await postEditor({ branch: 'x'.repeat(300) })).status, 400);
    assert.deepEqual(editors, []);
  });

  it('requires a JSON content type, which web pages cannot send without permission', async () => {
    const response = await postTab({ url: 'https://x.com', title: 'x' }, { ...auth, 'content-type': 'text/plain' });
    assert.equal(response.status, 415);
  });

  it('rejects an oversized body', async () => {
    const response = await call('/v1/browser/tab', { method: 'POST', headers: json, body: 'x'.repeat(20_000) });
    assert.equal(response.status, 413);
  });

  it('returns 404 for unknown paths and wrong methods, and sends no CORS headers', async () => {
    assert.equal((await call('/v1/nothing', { headers: auth })).status, 404);
    assert.equal((await call('/v1/ping', { method: 'POST', headers: auth })).status, 404);
    const response = await new Promise<Record<string, unknown>>((resolve) => {
      request({ host: '127.0.0.1', port, path: '/v1/ping', headers: { host: `127.0.0.1:${port}`, ...auth } }, (res) => {
        res.resume();
        resolve(res.headers);
      }).end();
    });
    assert.equal(response['access-control-allow-origin'], undefined);
  });
});
