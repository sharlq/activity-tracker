import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ACTIVE_GAP_MS, claudeProjectsDir, readClaudeSessions, sessionStats } from './claudeSessions.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 6, 10, 0);
const iso = (offsetMin: number) => new Date(T0 + offsetMin * MIN).toISOString();

/** One log line, shaped like Claude Code's. */
function line(type: string, offsetMin: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type,
    timestamp: iso(offsetMin),
    sessionId: 'session-a',
    cwd: 'C:\\Users\\me\\projects\\tracker',
    uuid: `${type}-${offsetMin}`,
    message: { role: type, content: 'SECRET conversation text' },
    ...extra,
  });
}

describe('sessionStats', () => {
  const at = (...minutes: number[]) => minutes.map((m) => T0 + m * MIN);

  it('counts short gaps as active and long ones as not', () => {
    const stats = sessionStats(at(0, 5, 8, 60, 62));
    assert.deepEqual(stats, { start: T0, end: T0 + 62 * MIN, spanMs: 62 * MIN, activeMs: 10 * MIN, messages: 5 });
  });

  it('counts a gap of exactly 10 minutes as active, and one just over as not', () => {
    assert.equal(sessionStats([T0, T0 + ACTIVE_GAP_MS])?.activeMs, ACTIVE_GAP_MS);
    assert.equal(sessionStats([T0, T0 + ACTIVE_GAP_MS + 1])?.activeMs, 0);
  });

  it('gives a single message zero span and zero active time', () => {
    assert.deepEqual(sessionStats(at(3)), { start: T0 + 3 * MIN, end: T0 + 3 * MIN, spanMs: 0, activeMs: 0, messages: 1 });
  });

  it('splits a session across a day boundary without double counting', () => {
    const times = at(0, 4, 8, 12);
    const midnight = T0 + 6 * MIN;
    const before = sessionStats(times, -Infinity, midnight);
    const after = sessionStats(times, midnight, Infinity);
    assert.equal(before?.activeMs, 6 * MIN);
    assert.equal(after?.activeMs, 6 * MIN);
    assert.equal(before?.messages, 2);
    assert.equal(after?.messages, 2);
  });

  it('returns null when no message falls inside the window', () => {
    assert.equal(sessionStats(at(0, 5), T0 + 10 * MIN, T0 + 20 * MIN), null);
  });
});

describe('readClaudeSessions', () => {
  let root: string;
  let project: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'claude-projects-'));
    project = join(root, 'C--Users-me-projects-tracker');
    mkdirSync(project);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const write = (path: string, lines: string[]) => writeFileSync(path, `${lines.join('\n')}\n`);

  it('reads start, end, and messages, naming the project after its folder', async () => {
    write(join(project, 'session-a.jsonl'), [line('user', 0), line('assistant', 1), line('user', 5)]);
    const { sessions } = await readClaudeSessions(root);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.project, 'tracker');
    assert.deepEqual(sessions[0]?.timestamps, [T0, T0 + MIN, T0 + 5 * MIN]);
  });

  it('ignores bookkeeping lines whose timestamps do not mean anyone was working', async () => {
    write(join(project, 'session-a.jsonl'), [
      line('user', 0),
      line('api-request', 30),
      line('queue-operation', 40),
      line('file-history-delta', 50),
      JSON.stringify({ type: 'custom-title', customTitle: 'x', sessionId: 'session-a' }),
    ]);
    const { sessions } = await readClaudeSessions(root);
    assert.deepEqual(sessions[0]?.timestamps, [T0]);
  });

  it("counts a subagent's messages toward its parent session", async () => {
    write(join(project, 'session-a.jsonl'), [line('user', 0), line('assistant', 20)]);
    const subagents = join(project, 'session-a', 'subagents');
    mkdirSync(subagents, { recursive: true });
    write(join(subagents, 'agent-1.jsonl'), [line('assistant', 10, { isSidechain: true })]);
    const { sessions } = await readClaudeSessions(root);
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0]?.timestamps, [T0, T0 + 10 * MIN, T0 + 20 * MIN]);
    // The subagent closes the 20-minute hole, so the whole session is active.
    assert.equal(sessionStats(sessions[0]?.timestamps ?? [])?.activeMs, 20 * MIN);
  });

  it('keeps separate sessions apart, sorted by start', async () => {
    write(join(project, 'b.jsonl'), [line('user', 30, { sessionId: 'session-b', cwd: 'D:\\work\\website\\' })]);
    write(join(project, 'a.jsonl'), [line('user', 0)]);
    const { sessions } = await readClaudeSessions(root);
    assert.deepEqual(sessions.map((s) => [s.sessionId, s.project]), [['session-a', 'tracker'], ['session-b', 'website']]);
  });

  it('names the project after the working directory used most', async () => {
    write(join(project, 'session-a.jsonl'), [
      line('user', 0, { cwd: 'C:\\other' }),
      line('user', 1),
      line('assistant', 2),
    ]);
    assert.equal((await readClaudeSessions(root)).sessions[0]?.project, 'tracker');
  });

  it('counts the same message once, even if it appears twice', async () => {
    write(join(project, 'session-a.jsonl'), [line('user', 0), line('user', 0), line('assistant', 1)]);
    assert.equal((await readClaudeSessions(root)).sessions[0]?.timestamps.length, 2);
  });

  it('skips damaged lines, including a half-written last line, and keeps the rest', async () => {
    writeFileSync(join(project, 'session-a.jsonl'), `${line('user', 0)}\n{"type":"user","timestamp":"broken\n${line('assistant', 3)}\n{"type":"assistant","timestamp":"${iso(4)}","sessionId":"session-a"`);
    const { sessions, skippedLines } = await readClaudeSessions(root);
    assert.deepEqual(sessions[0]?.timestamps, [T0, T0 + 3 * MIN]);
    assert.equal(skippedLines, 2);
  });

  it('skips files not modified since the cutoff, without opening them', async () => {
    const old = join(project, 'old.jsonl');
    write(old, [line('user', 0, { sessionId: 'old' })]);
    const longAgo = new Date(2020, 0, 1);
    utimesSync(old, longAgo, longAgo);
    write(join(project, 'new.jsonl'), [line('user', 0)]);
    const { sessions, filesRead } = await readClaudeSessions(root, new Date(2021, 0, 1).getTime());
    assert.equal(filesRead, 1);
    assert.deepEqual(sessions.map((s) => s.sessionId), ['session-a']);
  });

  it('never changes the files it reads, not even their timestamps', async () => {
    const file = join(project, 'session-a.jsonl');
    write(file, [line('user', 0), line('assistant', 1)]);
    const before = { hash: createHash('sha256').update(readFileSync(file)).digest('hex'), mtime: statSync(file).mtimeMs, size: statSync(file).size };
    await readClaudeSessions(root);
    const after = { hash: createHash('sha256').update(readFileSync(file)).digest('hex'), mtime: statSync(file).mtimeMs, size: statSync(file).size };
    assert.deepEqual(after, before);
  });

  it("names each session after its chat: your name if you renamed it, otherwise the automatic one", async () => {
    const title = (type: string, text: string, sessionId = 'session-a') =>
      JSON.stringify(type === 'custom-title' ? { type, customTitle: text, sessionId } : { type, aiTitle: text, sessionId });
    write(join(project, 'a.jsonl'), [line('user', 0), title('ai-title', 'Fix login bug'), title('custom-title', 'Login work')]);
    write(join(project, 'b.jsonl'), [line('user', 5, { sessionId: 'session-b' }), title('ai-title', 'Draft README', 'session-b')]);
    write(join(project, 'c.jsonl'), [line('user', 9, { sessionId: 'session-c' })]);
    const { sessions } = await readClaudeSessions(root);
    assert.deepEqual(sessions.map((s) => s.title), ['Login work', 'Draft README', null]);
  });

  it('uses the latest name of a renamed chat', async () => {
    const rename = (text: string) => JSON.stringify({ type: 'custom-title', customTitle: text, sessionId: 'session-a' });
    write(join(project, 'a.jsonl'), [rename('First name'), line('user', 0), rename('Second name')]);
    assert.equal((await readClaudeSessions(root)).sessions[0]?.title, 'Second name');
  });

  it('does not turn a title with no messages into a session', async () => {
    write(join(project, 'a.jsonl'), [JSON.stringify({ type: 'custom-title', customTitle: 'Empty', sessionId: 'lonely' })]);
    assert.deepEqual((await readClaudeSessions(root)).sessions, []);
  });

  it('keeps no message content, only times and the project', async () => {
    write(join(project, 'session-a.jsonl'), [line('user', 0)]);
    const { sessions } = await readClaudeSessions(root);
    assert.ok(!JSON.stringify(sessions).includes('SECRET'));
  });

  it('returns nothing when the folder does not exist', async () => {
    assert.deepEqual(await readClaudeSessions(join(root, 'missing')), { sessions: [], filesRead: 0, skippedLines: 0 });
  });
});

describe('claudeProjectsDir', () => {
  it('follows CLAUDE_CONFIG_DIR, as Claude Code does', () => {
    assert.equal(claudeProjectsDir({ CLAUDE_CONFIG_DIR: 'D:\\claude' }), join('D:\\claude', 'projects'));
  });
});
