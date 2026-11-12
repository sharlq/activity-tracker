// Turns a Report into terminal text or Markdown. Only names of categories,
// projects, games, sites, and apps appear: never window titles or URLs (nor
// the titles of what was playing). What you logged yourself appears as written.
import type { Report } from './build.ts';

export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return ms > 0 ? '<1m' : '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : `${h}h${String(m).padStart(2, '0')}m`;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const span = (start: number, end: number) => `${time(start)}–${time(end)}`;
const percent = (share: number) => `${(share * 100).toFixed(1)}%`;
const weekday = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export function title(report: Report): string {
  const first = new Date(report.from);
  if (report.kind === 'day') {
    return first.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  const last = new Date(report.to - 1);
  const short = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `Week of ${short(first)} – ${short(last)} ${last.getFullYear()}`;
}

function summaryLine(report: Report): string {
  return `Tracked ${duration(report.trackedMs)} · active ${duration(report.trackedMs - report.idleMs)} · idle ${duration(report.idleMs)}`;
}

function focusLines(report: Report): string[] {
  const stretch = report.longestFocus;
  return [
    `Switches between focus and distraction: ${report.switches}`,
    `Longest focused stretch: ${stretch ? `${duration(stretch.ms)} (${report.kind === 'week' ? `${weekday(stretch.start)}, ` : ''}${span(stretch.start, stretch.end)})` : 'none'}`,
  ];
}

/** Idle with nothing known on screen: older data, or no window in front. */
const idleName = (detail: string) => (detail === 'idle' ? 'unknown' : detail);

// ---------------------------------------------------------------- terminal text

function bar(share: number, width = 20): string {
  return '█'.repeat(Math.round(share * width));
}

function section(lines: string[], heading: string, body: string[], empty = 'None.'): void {
  lines.push('', heading, ...(body.length ? body : [`  ${empty}`]));
}

export function renderText(report: Report): string {
  const lines = [`Activity report: ${title(report)}`, summaryLine(report)];
  if (report.trackedMs === 0) {
    lines.push('', 'Nothing was recorded in this period.');
  }

  const width = Math.max(10, ...report.totals.map((t) => t.category.length));
  section(
    lines,
    'Categories',
    report.totals.map((t) => `  ${t.category.padEnd(width)}  ${duration(t.ms).padStart(6)}  ${percent(t.share).padStart(6)}  ${bar(t.share)}`),
  );

  if (report.kind === 'day') {
    section(
      lines,
      'Timeline',
      report.timeline.map((b) => `  ${span(b.start, b.end)}  ${duration(b.end - b.start).padStart(6)}  ${b.category}${b.detail !== b.category ? ` / ${b.detail}` : ''}`),
    );
  } else {
    section(lines, 'Days', [
      `  ${'day'.padEnd(12)}${'tracked'.padStart(8)}${'focus'.padStart(8)}${'distr.'.padStart(8)}${'idle'.padStart(8)}${'switches'.padStart(10)}`,
      ...report.days.map(
        (d) =>
          `  ${weekday(d.day).padEnd(12)}${duration(d.trackedMs).padStart(8)}${duration(d.focusMs).padStart(8)}${duration(d.distractionMs).padStart(8)}${duration(d.idleMs).padStart(8)}${String(d.switches).padStart(10)}`,
      ),
    ]);
  }

  const idleWidth = Math.max(10, ...report.idleBy.map((i) => idleName(i.name).length));
  section(
    lines,
    'Idle time, by what was on screen',
    report.idleBy.slice(0, 10).map((i) => `  ${idleName(i.name).padEnd(idleWidth)}  ${duration(i.ms).padStart(6)}`),
  );

  const appWidth = Math.max(4, ...report.topApps.map((a) => a.name.length));
  section(lines, 'Top apps', report.topApps.map((a, i) => `  ${String(i + 1).padStart(2)}. ${a.name.padEnd(appWidth)}  ${duration(a.ms).padStart(6)}`));
  const siteWidth = Math.max(4, ...report.topDomains.map((d) => d.name.length));
  section(lines, 'Top domains', report.topDomains.map((d, i) => `  ${String(i + 1).padStart(2)}. ${d.name.padEnd(siteWidth)}  ${duration(d.ms).padStart(6)}`), 'None (needs the Chrome extension).');

  section(
    lines,
    'Gaming sessions',
    report.gaming.map((g) => `  ${report.kind === 'week' ? `${weekday(g.start)}  ` : ''}${span(g.start, g.end)}  ${duration(g.ms).padStart(6)}  ${g.game}`),
  );

  section(
    lines,
    'Claude Code sessions',
    report.claude.map((c) =>
      c.start !== null && c.end !== null
        ? `  ${span(c.start, c.end)}  span ${duration(c.spanMs).padStart(6)}  active ${duration(c.activeMs).padStart(6)}  ${c.title ? `${c.title} (${c.project})` : c.project}`
        : `  ${c.project}: ${c.sessions} session${c.sessions === 1 ? '' : 's'}, span ${duration(c.spanMs)}, active ${duration(c.activeMs)}`,
    ),
  );

  const multi = report.multitasking;
  section(
    lines,
    'Background listening (multitasking)',
    multi.listeningMs === 0
      ? []
      : [
          `  Sound playing ${duration(multi.listeningMs)}: ${duration(multi.whileActiveMs)} while doing something else, ${duration(multi.whileIdleMs)} while the PC was idle`,
          ...multi.bySource.slice(0, 5).flatMap((s) => [
            `    ${s.name.padEnd(20)}  ${duration(s.ms).padStart(6)}`,
            ...(s.titles ?? []).slice(0, 3).map((t) => `      ${duration(t.ms).padStart(6)}  ${t.name}`),
          ]),
          ...(multi.pairs.length ? ['  Most often together:'] : []),
          ...multi.pairs.slice(0, 5).map((p) => `    ${p.doing} + ${p.listening}${p.listeningTitle ? ` (${p.listeningTitle})` : ''}  ${duration(p.ms)}`),
        ],
  );
  const screens = report.otherScreens;
  if (screens?.top.length) {
    const name = (i: { name: string; title: string | null }) => (i.title && i.title.toLowerCase() !== i.name.toLowerCase() ? `${i.name}: ${i.title}` : i.name).slice(0, 70);
    section(lines, 'On your other screens', [
      ...screens.byScreen.map((s) => `  Screen ${s.screen}  ${duration(s.ms).padStart(6)}  ${s.top.slice(0, 3).map((i) => `${i.name} ${duration(i.ms)}`).join(', ')}`),
      ...(screens.pairs.length ? ['  Most often side by side:'] : []),
      ...screens.pairs.slice(0, 5).map((p) => `    ${p.doing} + ${p.visible}  ${duration(p.ms)}`),
      ...(screens.whileIdle.length ? ['  Up while the PC sat idle (reading, or away):'] : []),
      ...screens.whileIdle.slice(0, 5).map((i) => `    ${name(i)}  ${duration(i.ms)}`),
    ]);
  }
  if (multi.phone?.ms) {
    section(lines, 'Phone while at the PC (multitasking)', [
      `  On the phone ${duration(multi.phone.ms)}: ${duration(multi.phone.whileActiveMs)} while active on the PC, ${duration(multi.phone.whilePcIdleMs)} while it sat idle`,
      ...multi.phone.pairs.slice(0, 5).map((p) => `    ${p.doing} + ${p.listening}  ${duration(p.ms)}`),
    ]);
  }
  if (report.kind === 'day') {
    section(lines, 'You logged', report.entries.map((e) => `  ${span(e.start, e.end)}  ${duration(e.end - e.start).padStart(6)}  ${e.label}${e.category ? ` (${e.category})` : ''}`));
  }

  section(lines, 'Focus', focusLines(report).map((line) => `  ${line}`));
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- markdown

/** Escape characters that would break a Markdown table cell. */
const cell = (text: string) => text.replaceAll('|', '\\|');

function table(header: string[], rows: string[][]): string[] {
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)];
}

export function renderMarkdown(report: Report): string {
  const out = [`# Activity report: ${title(report)}`, '', summaryLine(report)];
  const add = (heading: string, body: string[], empty = '_None._') => out.push('', `## ${heading}`, '', ...(body.length ? body : [empty]));

  add('Categories', report.totals.length ? table(['Category', 'Time', 'Share'], report.totals.map((t) => [t.category, duration(t.ms), percent(t.share)])) : []);

  if (report.kind === 'day') {
    add(
      'Timeline',
      report.timeline.length
        ? table(['Time', 'Duration', 'Category', 'Detail'], report.timeline.map((b) => [span(b.start, b.end), duration(b.end - b.start), b.category, b.detail === b.category ? '' : b.detail]))
        : [],
    );
  } else {
    add(
      'Days',
      table(
        ['Day', 'Tracked', 'Focus', 'Distraction', 'Idle', 'Switches'],
        report.days.map((d) => [weekday(d.day), duration(d.trackedMs), duration(d.focusMs), duration(d.distractionMs), duration(d.idleMs), String(d.switches)]),
      ),
    );
  }

  add(
    'Idle time, by what was on screen',
    report.idleBy.length ? table(['On screen', 'Idle'], report.idleBy.slice(0, 10).map((i) => [idleName(i.name), duration(i.ms)])) : [],
  );
  add('Top apps', report.topApps.length ? table(['#', 'App', 'Time'], report.topApps.map((a, i) => [String(i + 1), a.name, duration(a.ms)])) : []);
  add('Top domains', report.topDomains.length ? table(['#', 'Domain', 'Time'], report.topDomains.map((d, i) => [String(i + 1), d.name, duration(d.ms)])) : []);
  add(
    'Gaming sessions',
    report.gaming.length
      ? table(['When', 'Game', 'Played'], report.gaming.map((g) => [`${report.kind === 'week' ? `${weekday(g.start)} ` : ''}${span(g.start, g.end)}`, g.game, duration(g.ms)]))
      : [],
  );
  add(
    'Claude Code sessions',
    report.claude.length
      ? report.kind === 'day'
        ? table(['Time', 'Chat', 'Project', 'Span', 'Active'], report.claude.map((c) => [span(c.start ?? 0, c.end ?? 0), c.title ?? '', c.project, duration(c.spanMs), duration(c.activeMs)]))
        : table(['Project', 'Sessions', 'Span', 'Active'], report.claude.map((c) => [c.project, String(c.sessions), duration(c.spanMs), duration(c.activeMs)]))
      : [],
  );
  const multi = report.multitasking;
  add(
    'Background listening (multitasking)',
    multi.listeningMs === 0
      ? []
      : [
          `Sound playing ${duration(multi.listeningMs)}: ${duration(multi.whileActiveMs)} while doing something else, ${duration(multi.whileIdleMs)} while the PC was idle.`,
          '',
          ...table(['Listening to', 'What played', 'Time'], multi.bySource.slice(0, 10).map((s) => [s.name, (s.titles ?? []).slice(0, 3).map((t) => `${t.name} (${duration(t.ms)})`).join(', '), duration(s.ms)])),
          ...(multi.pairs.length ? ['', ...table(['Doing', 'Listening to', 'Together'], multi.pairs.map((p) => [p.doing, p.listeningTitle ? `${p.listening}: ${p.listeningTitle}` : p.listening, duration(p.ms)]))] : []),
        ],
  );
  const screens = report.otherScreens;
  if (screens?.top.length) {
    add('On your other screens', [
      ...table(['Screen', 'Up', 'Mostly'], screens.byScreen.map((s) => [String(s.screen), duration(s.ms), s.top.slice(0, 3).map((i) => `${i.name} ${duration(i.ms)}`).join(', ')])),
      ...(screens.pairs.length ? ['', ...table(['Doing', 'Beside it', 'Together'], screens.pairs.map((p) => [p.doing, p.visible, duration(p.ms)]))] : []),
      ...(screens.whileIdle.length ? ['', ...table(['Up while idle', 'Time'], screens.whileIdle.map((i) => [i.title ? `${i.name}: ${i.title}` : i.name, duration(i.ms)]))] : []),
    ]);
  }
  if (multi.phone?.ms) {
    add('Phone while at the PC (multitasking)', [
      `On the phone ${duration(multi.phone.ms)}: ${duration(multi.phone.whileActiveMs)} while active on the PC, ${duration(multi.phone.whilePcIdleMs)} while it sat idle.`,
      ...(multi.phone.pairs.length ? ['', ...table(['On the PC', 'On the phone', 'Together'], multi.phone.pairs.map((p) => [p.doing, p.listening, duration(p.ms)]))] : []),
    ]);
  }
  if (report.kind === 'day') {
    add('You logged', report.entries.length ? table(['Time', 'Duration', 'What'], report.entries.map((e) => [span(e.start, e.end), duration(e.end - e.start), e.label + (e.category ? ` (${e.category})` : '')])) : []);
  }
  add('Focus', focusLines(report).map((line) => `- ${line}`));
  return `${out.join('\n')}\n`;
}
