import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaudeSession, StoredEvent } from '@activity-tracker/tracker/lib';
import { buildReport, idleBy, nameClaudeBlocks } from './build.ts';
import { parseCategories } from './categories.ts';
import { parseArgs, period } from './main.ts';
import { duration, renderMarkdown, renderText } from './render.ts';

const MIN = 60_000;
const DAY = new Date(2026, 10, 6).getTime(); // A Friday
const at = (h: number, m = 0) => new Date(2026, 10, 6, h, m).getTime();
const CATEGORIES = parseCategories(
  JSON.stringify({
    focus: ['work'],
    distraction: ['video', 'gaming'],
    rules: [
      { category: 'gaming', gaming: 'game' },
      { category: 'work', project: '*' },
      { category: 'video', domain: 'youtube.com' },
    ],
  }),
);

let id = 0;
function event(start: number, end: number, activity: StoredEvent['activity']): StoredEvent {
  return { id: ++id, start, end, activity };
}
const cursor = (project: string) => ({ kind: 'window' as const, processName: 'Cursor.exe', exePath: 'C:\\c\\Cursor.exe', title: `x - ${project} - Cursor | SECRET TITLE`, project });
const chrome = (domain: string) => ({ kind: 'window' as const, processName: 'chrome.exe', exePath: 'C:\\g\\chrome.exe', title: 'SECRET TITLE', domain, url: `https://${domain}/secret-path` });
const game = { kind: 'window' as const, processName: 'Hades.exe', exePath: 'D:\\steamapps\\common\\Hades\\Hades.exe', title: 'Hades' };

const EVENTS: StoredEvent[] = [
  event(at(9), at(10, 30), cursor('backend')),
  event(at(10, 30), at(10, 30) + 30_000, chrome('youtube.com')),
  event(at(10, 30) + 30_000, at(11), cursor('backend')),
  event(at(11), at(11, 20), chrome('youtube.com')),
  event(at(11, 20), at(12, 20), { kind: 'idle' }),
  event(at(20), at(21, 30), game),
];
const SESSIONS: ClaudeSession[] = [
  { sessionId: 's1', project: 'backend', title: 'Backend refactor', timestamps: [at(9, 5), at(9, 10), at(9, 50), at(9, 55)] },
];

const report = () => buildReport({ kind: 'day', from: DAY, to: at(24), events: EVENTS, claudeSessions: SESSIONS, categories: CATEGORIES, games: [] });

describe('buildReport (day)', () => {
  it('adds up tracked, idle, and per-category time', () => {
    const r = report();
    assert.equal(r.trackedMs, (120 + 20 + 60 + 90) * MIN);
    assert.equal(r.idleMs, 60 * MIN);
    assert.deepEqual(r.totals.map((t) => t.category), ['work', 'gaming', 'idle', 'video']);
  });

  it('builds the timeline with the 30-second YouTube glance folded into work', () => {
    assert.deepEqual(
      report().timeline.map((b) => [b.category, b.detail, (b.end - b.start) / MIN]),
      [['work', 'backend', 120], ['video', 'youtube.com', 20], ['idle', 'idle', 60], ['gaming', 'Hades', 90]],
    );
  });

  it('counts switches on the raw data, so the glance counts (gaming after video is the same side, so no switch)', () => {
    assert.equal(report().switches, 3);
  });

  it('finds the longest focused stretch, the glance not breaking it', () => {
    assert.equal(report().longestFocus?.ms, 120 * MIN);
  });

  it('lists gaming and Claude Code sessions', () => {
    const r = report();
    assert.deepEqual(r.gaming.map((g) => [g.game, g.ms / MIN]), [['Hades', 90]]);
    assert.deepEqual(r.claude.map((c) => [c.project, c.spanMs / MIN, c.activeMs / MIN]), [['backend', 50, 10]]);
  });

  it('clips events and sessions that run past the end of the day', () => {
    const late = [event(at(23, 30), at(24) + 60 * MIN, cursor('night'))];
    const r = buildReport({ kind: 'day', from: DAY, to: at(24), events: late, claudeSessions: [], categories: CATEGORIES, games: [] });
    assert.equal(r.trackedMs, 30 * MIN);
  });
});

describe('buildReport (week)', () => {
  it('summarizes each of the seven days, and groups Claude sessions by project', () => {
    const { from, to } = period(DAY, true);
    const r = buildReport({ kind: 'week', from, to, events: EVENTS, claudeSessions: [...SESSIONS, { ...(SESSIONS[0] as ClaudeSession), sessionId: 's2' }], categories: CATEGORIES, games: [] });
    assert.equal(r.days.length, 7);
    const friday = r.days[4];
    assert.equal(friday?.focusMs, 120 * MIN - 30_000);
    assert.equal(friday?.distractionMs, (20 + 90) * MIN + 30_000);
    assert.deepEqual(r.claude.map((c) => [c.project, c.sessions]), [['backend', 2]]);
    assert.deepEqual(r.timeline, []);
  });
});

describe('nameClaudeBlocks', () => {
  const block = (detail: string, fromMin: number, toMin: number) => ({
    start: at(14, fromMin),
    end: at(14, toMin),
    category: 'work' as const,
    detail,
  });
  const chat = (title: string | null, minutes: number[], project = 'tracker'): ClaudeSession => ({
    sessionId: title ?? 'untitled',
    project,
    title,
    timestamps: minutes.map((m) => at(14, m)),
  });

  it('names a Claude block after the chat active during it', () => {
    const [named] = nameClaudeBlocks([block('claude', 0, 10)], [chat('Personal activity tracker', [2, 4, 6])]);
    assert.equal(named?.detail, 'claude: Personal activity tracker');
  });

  it('picks the chat with the most messages, and says how many others there were', () => {
    const sessions = [chat('Small question', [1]), chat('Main work', [2, 3, 4, 5]), chat('Other', [8])];
    assert.equal(nameClaudeBlocks([block('claude', 0, 10)], sessions)[0]?.detail, 'claude: Main work (+2 more)');
  });

  it('falls back to the project when a chat has no title', () => {
    assert.equal(nameClaudeBlocks([block('claude', 0, 10)], [chat(null, [3], 'devbackend')])[0]?.detail, 'claude: devbackend');
  });

  it('names a block where you were writing after the chat your next message went to', () => {
    const sessions = [chat('Later chat', [13]), chat('Reply chat', [12, 20])];
    assert.equal(nameClaudeBlocks([block('claude', 0, 10)], sessions)[0]?.detail, 'claude: Reply chat');
  });

  it('does not reach further than 5 minutes ahead for a writing block', () => {
    assert.equal(nameClaudeBlocks([block('claude', 0, 10)], [chat('Much later', [16])])[0]?.detail, 'claude');
  });

  it('leaves a Claude block alone when no logged chat was active, as for the Chat tab', () => {
    assert.equal(nameClaudeBlocks([block('claude', 0, 10)], [chat('Earlier', [30])])[0]?.detail, 'claude');
  });

  it('only renames Claude blocks', () => {
    assert.equal(nameClaudeBlocks([block('backend', 0, 10)], [chat('Busy', [2])])[0]?.detail, 'backend');
  });

  it('shows the chat name in the day timeline and the sessions list', () => {
    const r = report();
    const events = [event(at(9, 0), at(9, 30), { kind: 'window', processName: 'claude.exe', exePath: 'C:\\c\\claude.exe', title: 'Claude' })];
    const withClaude = buildReport({ kind: 'day', from: DAY, to: at(24), events, claudeSessions: SESSIONS, categories: CATEGORIES, games: [] });
    assert.deepEqual(withClaude.timeline.map((b) => b.detail), ['claude: Backend refactor']);
    assert.match(renderText(r), /active\s+10m\s+Backend refactor \(backend\)/);
    assert.match(renderMarkdown(r), /\| 09:05–09:55 \| Backend refactor \| backend \| 50m \| 10m \|/);
  });
});

describe('Claude Code sessions in a week', () => {
  it('adds up span day by day, so a session left open overnight is not counted as 20+ hours', () => {
    const { from, to } = period(DAY, true);
    const overnight: ClaudeSession = {
      sessionId: 'night',
      project: 'tracker',
      title: 'Tracker',
      // 18:00-18:30 on Thursday, then 09:00-09:20 on Friday.
      timestamps: [new Date(2026, 10, 5, 18).getTime(), new Date(2026, 10, 5, 18, 30).getTime(), at(9), at(9, 20)],
    };
    const r = buildReport({ kind: 'week', from, to, events: [], claudeSessions: [overnight], categories: CATEGORIES, games: [] });
    assert.deepEqual(r.claude.map((c) => [c.sessions, c.spanMs / MIN]), [[1, 50]]);
  });
});

describe('rendering', () => {
  it('prints every section as text', () => {
    const text = renderText(report());
    for (const heading of ['Categories', 'Timeline', 'Top apps', 'Top domains', 'Gaming sessions', 'Claude Code sessions', 'Focus']) {
      assert.match(text, new RegExp(`^${heading}$`, 'm'), heading);
    }
    assert.match(text, /09:00–11:00\s+2h00m\s+work \/ backend/);
    assert.match(text, /Switches between focus and distraction: 3/);
  });

  it('writes Markdown tables', () => {
    const md = renderMarkdown(report());
    assert.match(md, /^# Activity report: Friday, 6 November 2026$/m);
    assert.match(md, /^\| 09:00–11:00 \| 2h00m \| work \| backend \|$/m);
    assert.match(md, /^\| Category \| Time \| Share \|$/m);
  });

  it('never includes window titles or full URLs, so it is safe to paste', () => {
    for (const output of [renderText(report()), renderMarkdown(report())]) {
      assert.ok(!output.includes('SECRET'), 'title or URL leaked');
    }
  });

  it('formats durations', () => {
    assert.deepEqual([0, 20_000, 59 * MIN, 61 * MIN, 600 * MIN].map(duration), ['0m', '<1m', '59m', '1h01m', '10h00m']);
  });
});

describe('command line', () => {
  const today = new Date(2026, 10, 6, 15, 30);

  it('defaults to today', () => {
    assert.deepEqual(parseArgs([], today), { date: DAY, week: false, md: null });
  });

  it('reads --date, --week, and --md with or without a file name', () => {
    assert.deepEqual(parseArgs(['--date', '2026-11-05', '--week', '--md'], today), { date: new Date(2026, 10, 5).getTime(), week: true, md: true });
    assert.deepEqual(parseArgs(['--md', 'out.md'], today), { date: DAY, week: false, md: 'out.md' });
  });

  it('rejects bad input with a message', () => {
    assert.equal(typeof parseArgs(['--date', '2026-02-31'], today), 'string');
    assert.equal(typeof parseArgs(['--weak'], today), 'string');
  });

  it('runs weeks Monday to Sunday', () => {
    const { from, to } = period(DAY, true);
    assert.equal(from, new Date(2026, 10, 2).getTime());
    assert.equal(to, new Date(2026, 10, 9).getTime());
    assert.equal(new Date(from).getDay(), 1);
  });

  it('handles a Sunday as the end of its week, not the start of the next', () => {
    assert.equal(period(new Date(2026, 10, 8).getTime(), true).from, new Date(2026, 10, 2).getTime());
  });
});

describe('idle time with what was on screen', () => {
  const claudeWindow = { processName: 'claude.exe', exePath: 'C:\\c\\claude.exe', title: 'Claude' };
  const events: StoredEvent[] = [
    event(at(14), at(14, 10), { kind: 'window', ...claudeWindow }),
    event(at(14, 10), at(14, 30), { kind: 'idle', window: claudeWindow }),
    event(at(14, 30), at(14, 40), { kind: 'idle', window: { processName: 'chrome.exe', exePath: 'C:\\g\\chrome.exe', title: 'x', domain: 'docs.example.com' } }),
    event(at(15), at(15, 30), { kind: 'idle' }),
  ];
  const chats: ClaudeSession[] = [{ sessionId: 'c', project: 'tracker', title: 'Long answer', timestamps: [at(14, 2), at(14, 9), at(14, 12)] }];
  const r = () => buildReport({ kind: 'day', from: DAY, to: at(24), events, claudeSessions: chats, categories: CATEGORIES, games: [] });

  it('labels idle blocks with the app, site, or chat that was in front', () => {
    assert.deepEqual(r().timeline.map((b) => [b.category, b.detail]), [
      ['other', 'claude: Long answer'],
      ['idle', 'claude: Long answer'],
      ['idle', 'docs.example.com'],
      ['idle', 'idle'],
    ]);
  });

  it('still counts it all as idle, not as the app', () => {
    const report = r();
    assert.equal(report.idleMs, 60 * MIN);
    assert.deepEqual(report.topApps.map((a) => a.name), ['claude']);
  });

  it('breaks idle time down by what was on screen', () => {
    assert.deepEqual(idleBy(r().timeline).map((i) => [i.name, i.ms / MIN]), [
      ['idle', 30],
      ['claude: Long answer', 20],
      ['docs.example.com', 10],
    ]);
  });

  it('shows the breakdown in both outputs, calling unknown idle "unknown"', () => {
    const text = renderText(r());
    assert.match(text, /^Idle time, by what was on screen$/m);
    assert.match(text, /unknown\s+30m/);
    assert.match(text, /14:10–14:30\s+20m\s+idle \/ claude: Long answer/);
    assert.match(renderMarkdown(r()), /^\| claude: Long answer \| 20m \|$/m);
  });
});
