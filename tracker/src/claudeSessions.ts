// Reads Claude Code session logs (~/.claude/projects/**/*.jsonl) and works out
// when each session ran and how much of that time was active.
//
// Strictly read-only: files are only ever opened for reading, and nothing here
// writes, renames, or touches their timestamps.
//
// Only "user" and "assistant" lines are used. The logs also hold bookkeeping
// lines (API requests, queue operations, file snapshots) whose timestamps don't
// mean anyone was working. Subagent logs carry their parent's sessionId, so
// their messages count toward the parent session.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import { createInterface } from 'node:readline';

/** Gaps up to this long between messages count as active time. */
export const ACTIVE_GAP_MS = 10 * 60_000;

export interface ClaudeSession {
  sessionId: string;
  /** Folder name of the working directory the session ran in. */
  project: string;
  /** The chat's name as shown in the Claude app: yours if you renamed it, otherwise the automatic one. */
  title: string | null;
  /** Message times in ms, sorted and without repeats. */
  timestamps: number[];
}

export interface SessionStats {
  start: number;
  end: number;
  spanMs: number;
  activeMs: number;
  messages: number;
}

export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  // Claude Code itself honours CLAUDE_CONFIG_DIR for a relocated ~/.claude.
  return join(env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude'), 'projects');
}

/**
 * Start, end, span, and active time for the messages inside [from, to).
 * A quiet stretch of up to ACTIVE_GAP_MS counts as active, clipped to the window,
 * so a session running past midnight splits cleanly between the two days.
 */
export function sessionStats(
  timestamps: readonly number[],
  from = -Infinity,
  to = Infinity,
  activeGapMs = ACTIVE_GAP_MS,
): SessionStats | null {
  const inside = timestamps.filter((t) => t >= from && t < to);
  if (inside.length === 0) return null;

  let activeMs = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const a = timestamps[i - 1] as number;
    const b = timestamps[i] as number;
    if (b - a > activeGapMs) continue;
    activeMs += Math.max(0, Math.min(b, to) - Math.max(a, from));
  }
  const start = inside[0] as number;
  const end = inside.at(-1) as number;
  return { start, end, spanMs: end - start, activeMs, messages: inside.length };
}

interface Accumulator {
  timestamps: Set<number>;
  cwds: Map<string, number>;
  customTitle: string | null;
  aiTitle: string | null;
}

function accumulator(sessions: Map<string, Accumulator>, sessionId: string): Accumulator {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { timestamps: new Set(), cwds: new Map(), customTitle: null, aiTitle: null };
    sessions.set(sessionId, session);
  }
  return session;
}

/** Folds one log line into the sessions seen so far. Returns false if the line was unusable. */
export function readLine(line: string, sessions: Map<string, Accumulator>): boolean {
  // Cheap checks first: most lines are large and irrelevant.
  const isTitle = line.includes('"type":"custom-title"') || line.includes('"type":"ai-title"');
  const isMessage = line.includes('"timestamp"') && (line.includes('"type":"user"') || line.includes('"type":"assistant"'));
  if (!isTitle && !isMessage) return true;

  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return false; // Damaged, or still being written by a running session.
  }
  const { type, timestamp, sessionId, cwd, customTitle, aiTitle } = entry;
  if (typeof sessionId !== 'string') return true;

  // A chat can be renamed many times; the latest name wins.
  if (type === 'custom-title' && typeof customTitle === 'string' && customTitle.trim() !== '') {
    accumulator(sessions, sessionId).customTitle = customTitle.trim();
    return true;
  }
  if (type === 'ai-title' && typeof aiTitle === 'string' && aiTitle.trim() !== '') {
    accumulator(sessions, sessionId).aiTitle = aiTitle.trim();
    return true;
  }

  if ((type !== 'user' && type !== 'assistant') || typeof timestamp !== 'string') return true;
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return false;

  const session = accumulator(sessions, sessionId);
  session.timestamps.add(at);
  if (typeof cwd === 'string' && cwd !== '') session.cwds.set(cwd, (session.cwds.get(cwd) ?? 0) + 1);
  return true;
}

function projectName(cwds: Map<string, number>): string {
  let best: string | null = null;
  let bestCount = 0;
  for (const [cwd, count] of cwds) {
    if (count > bestCount) [best, bestCount] = [cwd, count];
  }
  return best ? win32.basename(best.replace(/[\\/]+$/, '')) || best : 'unknown';
}

export function finishSessions(sessions: Map<string, Accumulator>): ClaudeSession[] {
  return [...sessions]
    .filter(([, { timestamps }]) => timestamps.size > 0) // A title alone isn't a session.
    .map(([sessionId, { timestamps, cwds, customTitle, aiTitle }]) => ({
      sessionId,
      project: projectName(cwds),
      title: customTitle ?? aiTitle,
      timestamps: [...timestamps].sort((a, b) => a - b),
    }))
    .sort((a, b) => (a.timestamps[0] ?? 0) - (b.timestamps[0] ?? 0));
}

async function findLogs(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // No Claude Code logs on this machine, or the folder moved.
  }
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return findLogs(path);
      return Promise.resolve(entry.name.endsWith('.jsonl') ? [path] : []);
    }),
  );
  return nested.flat();
}

export interface ReadResult {
  sessions: ClaudeSession[];
  filesRead: number;
  skippedLines: number;
}

/**
 * Reads every log modified at or after `modifiedSince`. A file last written
 * before then can't contain messages from later, so it's skipped unopened.
 */
export async function readClaudeSessions(
  dir: string = claudeProjectsDir(),
  modifiedSince = -Infinity,
): Promise<ReadResult> {
  const sessions = new Map<string, Accumulator>();
  let filesRead = 0;
  let skippedLines = 0;

  for (const file of await findLogs(dir)) {
    try {
      if ((await stat(file)).mtimeMs < modifiedSince) continue;
      const lines = createInterface({ input: createReadStream(file, { flags: 'r', encoding: 'utf8' }), crlfDelay: Infinity });
      for await (const line of lines) {
        if (line !== '' && !readLine(line, sessions)) skippedLines++;
      }
      filesRead++;
    } catch {
      // A log deleted or locked mid-read is skipped; the rest still count.
    }
  }
  return { sessions: finishSessions(sessions), filesRead, skippedLines };
}
