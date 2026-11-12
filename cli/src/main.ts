#!/usr/bin/env node
// report [--date YYYY-MM-DD] [--week] [--md [file]]
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EventReader, categoriesFile, dataDir, loadConfig, parseLocalDate, readClaudeSessions } from '@activity-tracker/tracker/lib';
import { buildReport, loadCategories } from '@activity-tracker/tracker/report';
import { renderMarkdown, renderText } from './render.ts';

const USAGE = `Usage: report [--date YYYY-MM-DD] [--week] [--md [file]]
  report                     Today
  report --date 2026-11-05   That day
  report --week              This week, Monday to Sunday (with --date: the week containing that day)
  --md [file]                Also write the report as Markdown (default: report-<date>.md here)`;

interface Options {
  date: number;
  week: boolean;
  md: string | true | null;
}

export function parseArgs(args: string[], today: Date = new Date()): Options | string {
  const options: Options = {
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime(),
    week: false,
    md: null,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--week') options.week = true;
    else if (arg === '--date') {
      const date = parseLocalDate(args[++i] ?? '');
      if (date === null) return '--date needs a real date like 2026-11-05';
      options.date = date;
    } else if (arg === '--md') {
      const next = args[i + 1];
      options.md = next && !next.startsWith('--') ? (i++, next) : true;
    } else if (arg === '--help' || arg === '-h') return USAGE;
    else return `Unknown option "${arg}".\n${USAGE}`;
  }
  return options;
}

/** [from, to) for the day, or for its Monday-to-Sunday week. */
export function period(date: number, week: boolean): { from: number; to: number } {
  const start = new Date(date);
  if (week) start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + (week ? 7 : 1));
  return { from: start.getTime(), to: end.getTime() };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (typeof options === 'string') {
    console.log(options);
    return options === USAGE ? 0 : 1;
  }
  const { from, to } = period(options.date, options.week);
  const kind = options.week ? 'week' : 'day';

  const database = join(dataDir(), 'data.db');
  if (!existsSync(database)) {
    console.error(`No data yet: ${database} doesn't exist. Start the tracker with "npm start".`);
    return 1;
  }
  const reader = new EventReader(database);
  const events = reader.eventsBetween(from, to);
  const audio = reader.audioBetween(from, to);
  const screens = reader.screensBetween(from, to);
  const entries = reader.entriesBetween(from, to);
  reader.close();

  const { sessions } = await readClaudeSessions(undefined, from);
  const report = buildReport({
    kind,
    from,
    to,
    events,
    claudeSessions: sessions,
    categories: loadCategories(categoriesFile()),
    games: loadConfig().gaming.games,
    audio,
    screens,
    entries,
  });

  process.stdout.write(renderText(report));
  if (options.md !== null) {
    const day = new Date(from).toLocaleDateString('en-CA');
    const file = resolve(options.md === true ? `report-${kind === 'week' ? 'week-' : ''}${day}.md` : options.md);
    writeFileSync(file, renderMarkdown(report));
    console.log(`\nMarkdown written to ${file}`);
  }
  return 0;
}

// Only run when started as a program, not when tests import parseArgs.
if (process.argv[1] && resolve(process.argv[1]).replace(/\.ts$/, '.js').endsWith(join('cli', 'dist', 'main.js'))) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
