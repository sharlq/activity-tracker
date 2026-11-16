// Local HTTP API for the browser and editor extensions, and رقيب's own window.
//
// Defences, in the order they're checked:
//  1. Listens on 127.0.0.1 only, so nothing off this machine can connect.
//  2. Host header must name 127.0.0.1 or localhost, which blocks DNS-rebinding
//     tricks where a web page makes its own domain point at this machine.
//  3. A bearer token from the config folder, compared in constant time.
// It sends no CORS headers, so web pages in the browser can't read responses.
// رقيب's window (/ui and /v1/ui/) uses a cookie instead of the token: see ui.ts.
//
// Privacy: never log request bodies, since they hold URLs and titles.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from './logger.ts';

const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_URL_LENGTH = 8192;
const MAX_TITLE_LENGTH = 2048;

export interface TabReport {
  url: string;
  title: string;
}

export interface EditorHeartbeat {
  workspace: string | null;
  language: string | null;
  branch: string | null;
}

export interface ApiHandlers {
  onTab(report: TabReport): void;
  onEditor(heartbeat: EditorHeartbeat): void;
  /** Tabs currently playing sound, from the Chrome extension. */
  onAudibleTabs?(tabs: TabReport[]): void;
  /** Every Chrome window's active tab, so windows on other screens can be named. */
  onVisibleTabs?(tabs: TabReport[]): void;
  /** رقيب's window. Gets every /ui and /v1/ui/ request after the Host check. */
  ui?(request: IncomingMessage, response: ServerResponse, port: number): Promise<void>;
}

const MAX_AUDIBLE_TABS = 20;

const MAX_EDITOR_FIELD_LENGTH = 256;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const presented = Buffer.from(header?.replace(/^Bearer /, '') ?? '');
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** The names the window and the API answer to: 127.0.0.1 and localhost, unless told otherwise (the demo). */
export const DEFAULT_HOST_NAMES = [HOST, 'localhost'];

function allowedHost(host: string | undefined, port: number, names: readonly string[]): boolean {
  return names.some((name) => host === `${name}:${port}`);
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw new HttpError(415, 'expected application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

function parseTabReport(body: unknown): TabReport {
  const { url, title } = (body ?? {}) as Record<string, unknown>;
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) throw new HttpError(400, 'bad url');
  if (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) throw new HttpError(400, 'bad title');
  return { url, title };
}

function parseAudibleTabs(body: unknown): TabReport[] {
  const { tabs } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(tabs) || tabs.length > MAX_AUDIBLE_TABS) throw new HttpError(400, 'bad tabs');
  return tabs.map(parseTabReport);
}

/** Takes only the three known fields, so nothing else a client sends is ever kept. */
function parseEditorHeartbeat(body: unknown): EditorHeartbeat {
  const raw = (body ?? {}) as Record<string, unknown>;
  const field = (name: string): string | null => {
    const value = raw[name];
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' || value.length > MAX_EDITOR_FIELD_LENGTH) throw new HttpError(400, `bad ${name}`);
    return value;
  };
  return { workspace: field('workspace'), language: field('language'), branch: field('branch') };
}

export function send(response: ServerResponse, status: number, body?: object): void {
  if (body === undefined) {
    response.writeHead(status).end();
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

export function createApi(token: string, handlers: ApiHandlers, logger: Logger, hostNames: readonly string[] = DEFAULT_HOST_NAMES): Server {
  let warnedAboutToken = false;

  const route = async (request: IncomingMessage, response: ServerResponse, port: number) => {
    if (!allowedHost(request.headers.host, port, hostNames)) throw new HttpError(403, 'host not allowed');
    const uiPath = request.url?.split('?')[0] ?? '';
    if (handlers.ui && (uiPath === '/ui' || uiPath === '/favicon.ico' || uiPath.startsWith('/ui/') || uiPath.startsWith('/v1/ui/'))) {
      await handlers.ui(request, response, port);
      return;
    }
    if (!tokenMatches(request.headers.authorization, token)) {
      if (!warnedAboutToken) logger.warn('Rejected an API request with a missing or wrong token');
      warnedAboutToken = true;
      throw new HttpError(401, 'missing or wrong token');
    }

    const path = request.url?.split('?')[0];
    if (path === '/v1/ping' && request.method === 'GET') {
      send(response, 200, { ok: true });
    } else if (path === '/v1/browser/tab' && request.method === 'POST') {
      handlers.onTab(parseTabReport(await readJson(request)));
      send(response, 204);
    } else if (path === '/v1/browser/audio' && request.method === 'POST') {
      handlers.onAudibleTabs?.(parseAudibleTabs(await readJson(request)));
      send(response, 204);
    } else if (path === '/v1/browser/visible' && request.method === 'POST') {
      handlers.onVisibleTabs?.(parseAudibleTabs(await readJson(request)));
      send(response, 204);
    } else if (path === '/v1/editor/heartbeat' && request.method === 'POST') {
      handlers.onEditor(parseEditorHeartbeat(await readJson(request)));
      send(response, 204);
    } else {
      throw new HttpError(404, 'not found');
    }
  };

  const server = createServer((request, response) => {
    const { port } = server.address() as AddressInfo;
    const started = performance.now();
    response.on('finish', () => {
      // Requests share the tracker's one thread, so a slow one delays the next tick.
      const ms = Math.round(performance.now() - started);
      if (ms >= 2_000) logger.warn(`Slow: ${request.method} ${request.url?.split('?')[0]} took ${ms}ms`);
    });
    route(request, response, port).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) logger.error('API request failed', error);
      // Keep-alive would hold the connection open with an unread body.
      response.setHeader('connection', 'close');
      send(response, status, { error: error instanceof HttpError ? error.message : 'internal error' });
    });
  });
  return server;
}

/** Resolves with the port actually used, which matters when asking for port 0. */
export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}
