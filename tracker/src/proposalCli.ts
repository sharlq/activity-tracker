// raqib propose | proposals | aims | aim
//
// A proposed plan for a week goes in from a JSON file (weekPlan.ts has its shape) and waits
// in the window's Proposed plan page, where you take the days, blocks, and aims you want.
// Nothing on your days changes until you apply it there. The week's aims you took are
// listed and marked here.
import { readFileSync } from 'node:fs';
import { id, openJournal, options, parseDay, UsageError } from './cliShared.ts';
import type { GoalResult, WeekAim } from './journal.ts';
import type { Proposal } from './weekPlan.ts';
import { addDays, checkProposal, mondayOfDay } from './weekPlan.ts';

export const PROPOSAL_USAGE = `  raqib propose --file week.json [--dry-run]
                                      Propose a week's plan: aims for the week, and each day's aims and blocks.
                                      It waits in the window (Proposed plan) until you apply the days you take
  raqib proposals                     Proposals so far: waiting, applied, or discarded
  raqib aims [date]                   The aims for the week holding that date (also: aim met|partly|missed|clear|rm <id>)`;

function readFile(path: string | undefined): unknown {
  if (!path) throw new UsageError('Give the proposal with --file week.json');
  let text: string;
  try {
    text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  } catch {
    throw new UsageError(`Can't read ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${path} isn't valid JSON: ${(error as Error).message}`);
  }
}

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const STATUS: Record<Proposal['status'], string> = { waiting: 'waiting for you', applied: 'applied', discarded: 'discarded', replaced: 'replaced by a newer one' };
const MARK: Record<string, string> = { met: '✓', partly: '~', missed: '✗' };

function aimLine(a: WeekAim): string {
  return `  #${a.id} ${a.result ? MARK[a.result] : '·'} ${a.text}${a.how ? `\n       ${a.how}` : ''}`;
}

function propose(args: string[]): number {
  const { values, flags } = options(args, ['file'], ['dry-run']);
  const today = parseDay(undefined);
  const checked = checkProposal(readFile(values['file']), today);
  if (!checked.ok) throw new UsageError(`The proposal has problems; nothing was saved:\n${checked.errors.map((e) => `  - ${e}`).join('\n')}`);
  if (checked.warnings.length) console.log(`Warnings:\n${checked.warnings.map((w) => `  - ${w}`).join('\n')}\n`);
  const plan = checked.plan;
  const blocks = plan.days.reduce((n, d) => n + d.blocks.length, 0);
  const aims = plan.days.reduce((n, d) => n + d.aims.length, 0);
  const summary = `the week of ${plan.week}: ${plan.aims.length} week aim(s), ${plan.days.length} day(s), ${blocks} block(s), ${aims} day aim(s)`;
  if (flags.has('dry-run')) {
    console.log(`The proposal is fine: ${summary}. Nothing saved.`);
    return 0;
  }
  const journal = openJournal();
  try {
    const saved = journal.addProposal(plan);
    console.log(`Proposal #${saved.id} saved for ${summary}.\nIt's waiting in رقيب's window under Proposed plan. Nothing changes on those days until it's applied there.`);
    return 0;
  } finally {
    journal.close();
  }
}

function proposals(): number {
  const journal = openJournal();
  try {
    const list = journal.proposals();
    if (list.length === 0) {
      console.log('No proposals yet.');
      return 0;
    }
    for (const p of list) {
      const taken = p.choice ? `, ${p.choice.days.length} of ${p.days.length} days taken` : '';
      console.log(`#${p.id} week of ${p.week} (${shortDay(p.week)}–${shortDay(addDays(p.week, 6))}): ${STATUS[p.status]}${taken}`);
    }
    return 0;
  } finally {
    journal.close();
  }
}

function aims(args: string[]): number {
  const week = mondayOfDay(parseDay(args[0]));
  const journal = openJournal();
  try {
    const list = journal.weekAims(week);
    console.log(`Aims for the week of ${week}${list.length ? ` (${list.filter((a) => a.result === 'met').length}/${list.length} met)` : ''}`);
    if (list.length === 0) console.log('  None. They come from a proposed plan you apply in the window.');
    for (const a of list) console.log(aimLine(a));
    return 0;
  } finally {
    journal.close();
  }
}

function aim(args: string[]): number {
  const [action, target] = args;
  const journal = openJournal();
  try {
    if (action === 'rm') {
      if (!journal.deleteWeekAim(id(target))) throw new UsageError(`There is no week aim #${target}.`);
      console.log(`Removed week aim #${target}.`);
      return 0;
    }
    const results: Record<string, GoalResult | null> = { met: 'met', partly: 'partly', missed: 'missed', clear: null };
    if (action === undefined || !(action in results)) throw new UsageError('Use: aim met|partly|missed|clear|rm <id>');
    const updated = journal.updateWeekAim(id(target), { result: results[action] as GoalResult | null });
    if (!updated) throw new UsageError(`There is no week aim #${target}.`);
    console.log(aimLine(updated));
    return 0;
  } finally {
    journal.close();
  }
}

export const PROPOSAL_COMMANDS: Record<string, (args: string[]) => number> = { propose, proposals: () => proposals(), aims, aim };
