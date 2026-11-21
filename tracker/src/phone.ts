// Opening رقيب's window from a phone on the home network.
//
// Off until you switch it on in Settings on the PC. Then a second listener
// serves the window (never the extensions' API, never /ui/login) to phones
// you have connected:
//  1. Only requests from a private address (10.x, 172.16–31.x, 192.168.x)
//     get an answer, so the internet can't reach it even if a router forwards
//     the port.
//  2. The Host header must be a private address or this PC's name, with the
//     phone port, which blocks DNS-rebinding pages.
//  3. Each phone holds its own secret in a cookie (HttpOnly, SameSite=Strict).
//     Only a hash of it is kept, and removing the phone in Settings ends it.
//  4. A phone gets its secret by typing a six-digit code the PC shows for five
//     minutes; five wrong tries end the code.
// The page and its /v1/ui/ requests then work as on the PC (X-Raqib header,
// same-origin check). Connecting phones and switching this on or off is only
// possible from the PC itself.
//
// The phone talks plain HTTP on your Wi-Fi: fine at home, not on a shared
// network. Everything stays between the phone and this PC.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { hostname, networkInterfaces } from 'node:os';
import { HttpError, readJson, send } from './api.ts';
import type { Logger } from './logger.ts';

export const PHONE_COOKIE = 'raqib-phone';
const CODE_MS = 5 * 60_000;
const MAX_TRIES = 5;
const MAX_PHONES = 5;
const SEEN_EVERY_MS = 60_000;

export interface PhoneDevice {
  id: string;
  name: string;
  secretHash: string;
  createdAt: number;
  lastSeen: number | null;
}

export interface PhoneStatus {
  enabled: boolean;
  /** Whether the listener is up (false when the port was taken). */
  listening: boolean;
  port: number;
  /** Addresses a phone on this network can open. */
  urls: string[];
  devices: Array<Omit<PhoneDevice, 'secretHash'>>;
}

interface Store {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

type UiHandler = (request: IncomingMessage, response: ServerResponse, port: number) => Promise<void>;

/** Requests that came in through the phone listener, with the phone that sent them. */
export const phoneRequests = new WeakMap<IncomingMessage, PhoneDevice>();

const hash = (secret: string) => createHash('sha256').update(`raqib-phone:${secret}`).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 10.x, 172.16–31.x and 192.168.x, plus loopback; IPv4-mapped IPv6 too. */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (v4 === '::1') return true;
  const parts = v4.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** This PC's addresses on private networks, for the "open this on your phone" link. */
export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal && isPrivateAddress(item.address)) found.push(item.address);
    }
  }
  return found;
}

export function allowedPhoneHost(host: string | undefined, port: number, pcName = hostname()): boolean {
  if (!host) return false;
  const at = host.lastIndexOf(':');
  if (at < 0 || host.slice(at + 1) !== String(port)) return false;
  const name = host.slice(0, at).toLowerCase();
  const pc = pcName.toLowerCase();
  return (isPrivateAddress(name) && !name.startsWith('127.')) || name === pc || name === `${pc}.local`;
}

function readCookie(request: IncomingMessage, name: string): string {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return '';
}

export interface PhoneAccess {
  status(): PhoneStatus;
  setEnabled(enabled: boolean): Promise<PhoneStatus>;
  /** A new six-digit code for connecting a phone; replaces any earlier one. */
  startPairing(): { code: string; expiresAt: number; urls: string[] };
  removeDevice(id: string): boolean;
  /** Starts the listener when it's switched on. Call once at start-up. */
  start(): Promise<void>;
  stop(): void;
}

export function createPhoneAccess(options: { store: Store; ui: UiHandler; logger: Logger; port: number; now?: () => number; host?: string }): PhoneAccess {
  const { store, ui, logger, port } = options;
  const now = options.now ?? Date.now;
  const bindHost = options.host ?? '0.0.0.0';
  let server: Server | null = null;
  let listening = false;
  let pairing: { code: string; expiresAt: number; tries: number } | null = null;

  const enabled = () => store.get('phone.enabled') === true;
  const devices = (): PhoneDevice[] => {
    const value = store.get('phone.devices');
    return Array.isArray(value) ? (value as PhoneDevice[]) : [];
  };
  const saveDevices = (list: PhoneDevice[]) => store.set('phone.devices', list);
  const urls = () => lanAddresses().map((a) => `http://${a}:${port}/ui/`);

  const deviceFor = (request: IncomingMessage): PhoneDevice | null => {
    const [id, secret] = readCookie(request, PHONE_COOKIE).split('.');
    if (!id || !secret) return null;
    const list = devices();
    const device = list.find((d) => d.id === id);
    if (!device || !safeEqual(device.secretHash, hash(secret))) return null;
    const at = now();
    if (device.lastSeen === null || at - device.lastSeen > SEEN_EVERY_MS) {
      device.lastSeen = at;
      saveDevices(list);
    }
    return device;
  };

  const claim = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.headers['x-raqib'] !== '1') throw new HttpError(403, 'missing X-Raqib header');
    const body = (await readJson(request)) as Record<string, unknown>;
    const code = typeof body['code'] === 'string' ? body['code'].replace(/\s/g, '') : '';
    const rawName = typeof body['name'] === 'string' ? body['name'].trim().slice(0, 40) : '';
    if (!pairing || now() > pairing.expiresAt) {
      pairing = null;
      throw new HttpError(400, 'No code is waiting. Make one in Settings on the PC.');
    }
    if (!safeEqual(code.padEnd(6).slice(0, 6), pairing.code) || code.length !== 6) {
      pairing.tries += 1;
      if (pairing.tries >= MAX_TRIES) pairing = null;
      throw new HttpError(400, pairing ? 'That code is not right. Check it on the PC.' : 'Too many wrong tries. Make a new code on the PC.');
    }
    pairing = null;
    const list = devices();
    if (list.length >= MAX_PHONES) throw new HttpError(400, `Five phones at most. Remove one in Settings on the PC.`);
    const id = randomBytes(6).toString('hex');
    const secret = randomBytes(32).toString('hex');
    const device: PhoneDevice = { id, name: rawName || 'Phone', secretHash: hash(secret), createdAt: now(), lastSeen: now() };
    saveDevices([...list, device]);
    logger.info(`Phone access: connected "${device.name}"`);
    response
      .writeHead(204, { 'set-cookie': `${PHONE_COOKIE}=${id}.${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`, 'cache-control': 'no-store' })
      .end();
  };

  const route = async (request: IncomingMessage, response: ServerResponse) => {
    if (!isPrivateAddress(request.socket.remoteAddress)) throw new HttpError(403, 'only devices on your home network');
    if (!allowedPhoneHost(request.headers.host, port)) throw new HttpError(403, 'host not allowed');
    const path = request.url?.split('?')[0] ?? '';
    if (path === '/ui/login') throw new HttpError(404, 'not found');
    if (path === '/v1/ui/phone/claim' && request.method === 'POST') return claim(request, response);
    if (path.startsWith('/v1/ui/')) {
      const device = deviceFor(request);
      if (!device) throw new HttpError(401, 'not signed in');
      if (path.startsWith('/v1/ui/phone')) throw new HttpError(403, 'connect and remove phones on the PC');
      phoneRequests.set(request, device);
    } else if (!(path === '/ui' || path === '/favicon.ico' || path.startsWith('/ui/'))) {
      throw new HttpError(404, 'not found');
    }
    await ui(request, response, port);
  };

  const listen = () =>
    new Promise<void>((resolve) => {
      const s = createServer((request, response) => {
        route(request, response).catch((error: unknown) => {
          const status = error instanceof HttpError ? error.status : 500;
          if (status === 500) logger.error('Phone request failed', error);
          response.setHeader('connection', 'close');
          send(response, status, { error: error instanceof HttpError ? error.message : 'internal error' });
        });
      });
      s.once('error', (error) => {
        logger.error(`Phone access could not use port ${port}`, error);
        listening = false;
        server = null;
        resolve();
      });
      s.listen(port, bindHost, () => {
        server = s;
        listening = true;
        logger.info(`Phone access: listening on port ${port}`);
        resolve();
      });
    });

  const close = () => {
    server?.close();
    server?.closeAllConnections();
    server = null;
    listening = false;
  };

  const status = (): PhoneStatus => ({
    enabled: enabled(),
    listening,
    port,
    urls: urls(),
    devices: devices().map(({ secretHash: _, ...d }) => d),
  });

  return {
    status,
    async setEnabled(on) {
      store.set('phone.enabled', on);
      if (on && !server) await listen();
      if (!on) {
        close();
        pairing = null;
      }
      logger.info(`Phone access: switched ${on ? 'on' : 'off'}`);
      return status();
    },
    startPairing() {
      if (!enabled()) throw new HttpError(400, 'Switch phone access on first');
      pairing = { code: String(randomInt(0, 1_000_000)).padStart(6, '0'), expiresAt: now() + CODE_MS, tries: 0 };
      return { code: pairing.code, expiresAt: pairing.expiresAt, urls: urls() };
    },
    removeDevice(id) {
      const list = devices();
      const kept = list.filter((d) => d.id !== id);
      if (kept.length === list.length) return false;
      saveDevices(kept);
      return true;
    },
    async start() {
      if (enabled()) await listen();
    },
    stop: close,
  };
}
