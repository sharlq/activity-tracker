// Bits every command-line module shares: options, dates, ids, and opening the journal.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.ts';
import { parseLocalDate } from './dates.ts';
import { Journal } from './journal.ts';
import { dayKey } from './planner.ts';
import { Store } from './store.ts';

/** A mistake in how a command was typed: shown as is, without a stack trace. */
export class UsageError extends Error {}

export const dbPath = () => join(dataDir(), 'data.db');
export function openJournal(): Journal {
  mkdirSync(dataDir(), { recursive: true });
  // The Store creates the events table on a brand-new install.
  if (!existsSync(dbPath())) new Store(dbPath()).close();
  return new Journal(dbPath());
}

export function parseDay(text: string | undefined, now = Date.now()): string {
  if (text === undefined || text === 'today') return dayKey(now);
  if (text === 'yesterday' || text === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + (text === 'tomorrow' ? 1 : -1));
    return dayKey(d.getTime());
  }
  if (parseLocalDate(text) === null) throw new UsageError(`"${text}" is not a date. Use YYYY-MM-DD, today, yesterday, or tomorrow.`);
  return text;
}

/** Pulls `--name value` options out of the arguments; what's left are positionals. */
export function options(args: string[], names: string[], flags: string[] = []): { values: Record<string, string>; flags: Set<string>; rest: string[] } {
  const values: Record<string, string> = {};
  const set = new Set<string>();
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const name = arg.startsWith('--') ? arg.slice(2) : null;
    if (name !== null && flags.includes(name)) set.add(name);
    else if (name !== null && names.includes(name)) {
      const value = args[++i];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
      values[name] = value;
    } else if (name !== null) throw new UsageError(`Unknown option ${arg}`);
    else rest.push(arg);
  }
  return { values, flags: set, rest };
}

export function id(text: string | undefined): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError('Give the id number shown in the list');
  return n;
}

