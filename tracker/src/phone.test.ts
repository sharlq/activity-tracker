import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Logger } from './logger.ts';
import type { PhoneAccess } from './phone.ts';
import { allowedPhoneHost, createPhoneAccess, isPrivateAddress, PHONE_COOKIE, phoneRequests } from './phone.ts';

describe('phone addresses', () => {
  it('knows private addresses', () => {
    for (const a of ['192.168.1.20', '10.0.0.4', '172.16.0.1', '172.31.255.1', '::ffff:192.168.0.9', '127.0.0.1']) assert.equal(isPrivateAddress(a), true, a);
    for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '11.0.0.1', 'example.com', '', undefined]) assert.equal(isPrivateAddress(a), false, String(a));
  });

  it('takes only a private address or this PC name, with the phone port', () => {
    assert.equal(allowedPhoneHost('192.168.1.20:5611', 5611, 'DESKTOP-1'), true);
    assert.equal(allowedPhoneHost('desktop-1.local:5611', 5611, 'DESKTOP-1'), true);
    assert.equal(allowedPhoneHost('192.168.1.20:5610', 5611, 'DESKTOP-1'), false);
    assert.equal(allowedPhoneHost('evil.example:5611', 5611, 'DESKTOP-1'), false);
    assert.equal(allowedPhoneHost('127.0.0.1:5611', 5611, 'DESKTOP-1'), false);
    assert.equal(allowedPhoneHost(undefined, 5611, 'DESKTOP-1'), false);
  });
});

describe('phone access', () => {
  let dir: string;
  let port: number;
  let phone: PhoneAccess;
  const values = new Map<string, unknown>();
  const store = { get: (k: string) => values.get(k), set: (k: string, v: unknown) => void values.set(k, v) };
  const seen: Array<string | null> = [];

  function call(path: string, { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    return new Promise<{ status: number; body: string; cookie: string | undefined }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers: { host: `192.168.1.20:${port}`, ...headers } }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text, cookie: res.headers['set-cookie']?.[0] }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  const claim = (code: string) =>
    call('/v1/ui/phone/claim', { method: 'POST', headers: { 'content-type': 'application/json', 'x-raqib': '1' }, body: JSON.stringify({ code, name: 'Pixel' }) });

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-phone-'));
    // A free port first, then the phone listener on it.
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    port = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    phone = createPhoneAccess({
      store,
      logger: new Logger({ file: join(dir, 'phone.log') }),
      port,
      host: '127.0.0.1',
      ui: async (req, res) => {
        seen.push(phoneRequests.get(req)?.name ?? null);
        res.writeHead(200).end('ui');
      },
    });
    await phone.setEnabled(true);
  });
  after(() => {
    phone.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the page but not the data without a connected phone', async () => {
    assert.equal((await call('/ui/')).status, 200);
    assert.equal((await call('/v1/ui/day', { headers: { 'x-raqib': '1' } })).status, 401);
    assert.equal((await call('/ui/login?key=x')).status, 404);
    assert.equal((await call('/v1/browser/tab', { method: 'POST' })).status, 404);
  });

  it('refuses a Host that is not this network', async () => {
    assert.equal((await call('/ui/', { headers: { host: `evil.example:${port}` } })).status, 403);
  });

  it('connects a phone with the code, and only once', async () => {
    assert.equal((await claim('123456')).status, 400);
    const { code } = phone.startPairing();
    const wrong = code === '000000' ? '111111' : '000000';
    assert.equal((await claim(wrong)).status, 400);
    const ok = await claim(code);
    assert.equal(ok.status, 204);
    assert.match(ok.cookie ?? '', new RegExp(`^${PHONE_COOKIE}=[0-9a-f]{12}\\.[0-9a-f]{64}; HttpOnly; SameSite=Strict`));
    assert.equal((await claim(code)).status, 400, 'the code is used up');

    const cookie = (ok.cookie as string).split(';')[0] as string;
    const day = await call('/v1/ui/day', { headers: { 'x-raqib': '1', cookie } });
    assert.equal(day.status, 200);
    assert.equal(seen.at(-1), 'Pixel');
    assert.equal(phone.status().devices.length, 1);
    assert.equal('secretHash' in (phone.status().devices[0] as object), false);

    // Phones can't manage phones.
    assert.equal((await call('/v1/ui/phone', { headers: { 'x-raqib': '1', cookie } })).status, 403);

    const id = phone.status().devices[0]?.id as string;
    assert.equal(phone.removeDevice(id), true);
    assert.equal((await call('/v1/ui/day', { headers: { 'x-raqib': '1', cookie } })).status, 401);
  });

  it('ends a code after five wrong tries', async () => {
    const { code } = phone.startPairing();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await claim(wrong);
    assert.equal((await claim(code)).status, 400);
  });

  it('stops answering when switched off', async () => {
    await phone.setEnabled(false);
    await assert.rejects(call('/ui/'));
    assert.throws(() => phone.startPairing());
  });
});
