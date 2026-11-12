// raqib projects | project | sub | progress | targets
//
// Projects from the command line: the longer things you're working on, their sub-tasks,
// what you did on them each day, and their plan. `project create` and `project plan`
// take a whole plan as one JSON file, so Claude can lay out a project in one step.
import { readFileSync } from 'node:fs';
import { id, openJournal, options, parseDay, UsageError } from './cliShared.ts';
import type { Journal } from './journal.ts';
import type { Checked } from './projectPlan.ts';
import { checkNewProject, checkReplan } from './projectPlan.ts';
import type { ProjectOverview, ProjectStatus, SubtaskOverview } from './projects.ts';
import { daysBetween } from './projects.ts';

export const PROJECTS_USAGE = `  raqib projects [--all] [--date D] [--json]
                                      Your projects with progress bars (--all includes finished ones)
  raqib project add "name" [--due D] [--color #4f8cff]
  raqib project show <id> [--date D] [--json]
                                      Everything: sub-tasks, pace, plan, ahead or behind
  raqib project rename <id> "name" | due <id> D|none | pause|resume|done|rm <id>
  raqib project note <id> "what you did" [--date D]
  raqib project skip <id> [--date D]  "Nothing today" on a project
  raqib project create --file plan.json [--dry-run]
                                      Create a project with its sub-tasks and daily targets
  raqib project plan <id> --file plan.json [--dry-run]
                                      Re-plan from today on (past days are kept)
  raqib sub add <project id> "title" [--total 120 --unit slides] [--done 40] [--due D]
                                      Add a sub-task (no total: a checkbox; --done: already finished before)
  raqib sub edit <id> [--title "..."] [--total N] [--unit U] [--due D|none]
  raqib sub done|undo <id> [--date D] | sub rm <id>
  raqib progress <sub id> +15|-3|=12 [--date D]
                                      Add what you did that day (=12 sets the day's amount)
  raqib targets [date] [--json]       The day's planned targets across your projects`;

const neglectAfter = (journal: Journal): number => journal.neglectAfterDays();

export function bar(fraction: number, width = 16): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
const amount = (n: number, unit: string | null) => (unit ? `${n} ${unit}` : String(n));
const shortDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function sinceText(lastWorked: string | null, today: string): string {
  if (lastWorked === null) return 'never worked on yet';
  const days = daysBetween(lastWorked, today);
  return days <= 0 ? 'last worked on today' : days === 1 ? 'last worked on yesterday' : `last worked ${days} days ago`;
}

function subtaskLine(s: SubtaskOverview): string {
  const head = `    #${s.id}  ${s.title}`;
  if (s.total === null) return `${head}  [${s.done >= 1 ? 'x' : ' '}]${s.due ? `  due ${s.due}` : ''}`;
  const parts = [`${bar(s.fraction, 12)}  ${s.done} / ${amount(s.total, s.unit)}`];
  if (s.due) parts.push(`due ${s.due}`);
  return `${head}  ${parts.join('  ')}`;
}

function todayLine(p: ProjectOverview, day: string): string {
  const did = p.subtasks.filter((s) => s.doneToday !== 0).map((s) => (s.total === null ? `ticked "${s.title}"` : `${s.doneToday > 0 ? '+' : ''}${amount(s.doneToday, s.unit)}`));
  const parts: string[] = [];
  if (did.length) parts.push(did.join(', '));
  if (p.today?.note) parts.push(`"${p.today.note}"`);
  if (p.today?.skipped) parts.push('nothing (skipped)');
  return `    ${day}: ${parts.length ? parts.join(' · ') : 'not answered yet'}`;
}

function projectHeader(p: ProjectOverview): string {
  const status = p.status === 'active' ? '' : `  (${p.status})`;
  return `#${p.id}  ${p.name}${status}  ${bar(p.fraction)}  ${percent(p.fraction)}${p.due ? `  due ${p.due}` : ''}`;
}

function projectLines(p: ProjectOverview, day: string): string[] {
  const out = [projectHeader(p)];
  if (p.subtasks.length === 0) out.push('    No sub-tasks yet.');
  for (const s of p.subtasks) out.push(subtaskLine(s));
  out.push(todayLine(p, day));
  const notes = [sinceText(p.lastWorked, day)];
  if (p.neglectedDays !== null) notes.unshift(`⚠ not touched in ${p.neglectedDays} days`);
  out.push(`    ${notes.join(' · ')}`);
  return out;
}

function detailLines(p: ProjectOverview, day: string): string[] {
  const out = projectLines(p, day);
  if (p.fraction < 1 && p.projectedFinish) {
    const late = p.due && p.projectedFinish > p.due;
    out.push(`    At the last week's pace you'd finish ${shortDate(p.projectedFinish)}${p.due ? (late ? ', after the deadline' : ', before the deadline') : ''}.`);
  }
  for (const s of p.subtasks) {
    if (s.remaining === 0) continue;
    const bits: string[] = [];
    if (s.total === null) {
      if (s.pace) bits.push(s.pace.daysLeft > 0 ? `not done yet, ${s.pace.daysLeft} day(s) to go` : 'not done, and its due date has passed');
    } else if (s.pace?.perDay) bits.push(`${amount(s.pace.remaining, s.unit)} left, ${s.pace.daysLeft} day(s) to go → about ${amount(s.pace.perDay, s.unit)} a day`);
    else if (s.pace && s.pace.daysLeft <= 0) bits.push('its due date has passed');
    if (s.plan) {
      const a = s.plan.ahead;
      bits.push(a === 0 ? 'on plan' : a > 0 ? `${amount(a, s.unit)} ahead of plan` : `${amount(-a, s.unit)} behind plan`);
    }
    if (bits.length) out.push(`    ${s.title}: ${bits.join('; ')}`);
  }
  const planned = p.subtasks.filter((s) => s.plan);
  if (planned.length) {
    out.push('', '  Plan');
    const marks = { met: '✓', partly: '~', missed: '✗', pending: ' ' } as const;
    for (const s of planned) {
      out.push(`    ${s.title}`);
      for (const d of s.plan?.days ?? []) {
        out.push(`      ${marks[d.result]} ${shortDate(d.day).padEnd(14)} ${s.total === null ? 'do it' : `${d.done} / ${d.target}`}${d.day === day ? '  ← today' : ''}`);
      }
    }
  }
  return out;
}

function readPlanFile(path: string | undefined): unknown {
  if (!path) throw new UsageError('Give the plan with --file plan.json');
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

function reportCheck<T>(checked: Checked<T>): T {
  if (!checked.ok) throw new UsageError(`The plan has problems; nothing was saved:\n${checked.errors.map((e) => `  - ${e}`).join('\n')}`);
  if (checked.warnings.length) console.log(`Warnings:\n${checked.warnings.map((w) => `  - ${w}`).join('\n')}\n`);
  return checked.plan;
}

function dueOption(text: string | undefined): string | null | undefined {
  if (text === undefined) return undefined;
  if (text === 'none') return null;
  return parseDay(text);
}

function countOption(text: string | undefined, name: string): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`--${name} must be a whole number above 0`);
  return n;
}

function show(journal: Journal, projectId: number, day: string): void {
  const view = journal.projectOverview(projectId, day, neglectAfter(journal));
  if (view) console.log(projectLines(view, day).join('\n'));
}

// Commands -------------------------------------------------------------------

function projects(args: string[]): number {
  const { values, flags } = options(args, ['date'], ['all', 'json']);
  const day = parseDay(values['date']);
  const journal = openJournal();
  try {
    const list = journal.projectOverviews(day, neglectAfter(journal)).filter((p) => flags.has('all') || p.status !== 'done');
    if (flags.has('json')) {
      console.log(JSON.stringify(list, null, 2));
      return 0;
    }
    if (list.length === 0) {
      console.log('No projects yet. Add one with: raqib project add "name"');
      return 0;
    }
    const order: ProjectStatus[] = ['active', 'paused', 'done'];
    const sorted = [...list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    console.log(sorted.map((p) => projectLines(p, day).join('\n')).join('\n\n'));
    return 0;
  } finally {
    journal.close();
  }
}

function project(args: string[]): number {
  const [action, ...rest] = args;
  const journal = openJournal();
  try {
    switch (action) {
      case 'add': {
        const { values, rest: words } = options(rest, ['due', 'color']);
        const name = words.join(' ').trim();
        if (!name) throw new UsageError('Usage: raqib project add "name" [--due YYYY-MM-DD] [--color #4f8cff]');
        if (name.length > 100) throw new UsageError('Keep the name to 100 characters');
        const color = values['color'];
        if (color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new UsageError('The colour must look like #4f8cff');
        const added = journal.addProject({ name, due: dueOption(values['due']) ?? null, color: color ?? null });
        console.log('Added:');
        show(journal, added.id, parseDay(undefined));
        return 0;
      }
      case 'show': {
        const { values, flags, rest: ids } = options(rest, ['date'], ['json']);
        const day = parseDay(values['date']);
        const view = journal.projectOverview(id(ids[0]), day, neglectAfter(journal));
        if (!view) throw new UsageError(`There is no project #${ids[0]}.`);
        console.log(flags.has('json') ? JSON.stringify(view, null, 2) : detailLines(view, day).join('\n'));
        return 0;
      }
      case 'rename': {
        const [target, ...words] = rest;
        const name = words.join(' ').trim();
        if (!name) throw new UsageError('Usage: raqib project rename <id> "new name"');
        if (!journal.updateProject(id(target), { name })) throw new UsageError(`There is no project #${target}.`);
        show(journal, id(target), parseDay(undefined));
        return 0;
      }
      case 'due': {
        const [target, when] = rest;
        if (when === undefined) throw new UsageError('Usage: raqib project due <id> YYYY-MM-DD|none');
        if (!journal.updateProject(id(target), { due: dueOption(when) ?? null })) throw new UsageError(`There is no project #${target}.`);
        show(journal, id(target), parseDay(undefined));
        return 0;
      }
      case 'pause':
      case 'resume':
      case 'done': {
        const status: ProjectStatus = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'done';
        const updated = journal.updateProject(id(rest[0]), { status });
        if (!updated) throw new UsageError(`There is no project #${rest[0]}.`);
        console.log(`#${updated.id}  ${updated.name}: ${status}.`);
        return 0;
      }
      case 'rm': {
        const existing = journal.project(id(rest[0]));
        if (!existing) throw new UsageError(`There is no project #${rest[0]}.`);
        journal.deleteProject(existing.id);
        console.log(`Removed project #${existing.id} (${existing.name}) with its sub-tasks, progress, and plan.`);
        return 0;
      }
      case 'note': {
        const { values, rest: words } = options(rest, ['date']);
        const [target, ...text] = words;
        const note = text.join(' ').trim();
        if (!note) throw new UsageError('Usage: raqib project note <id> "what you did" [--date D]');
        if (note.length > 1000) throw new UsageError('Keep the note to 1000 characters');
        const day = parseDay(values['date']);
        if (!journal.setProjectDay(id(target), day, { note })) throw new UsageError(`There is no project #${target}.`);
        show(journal, id(target), day);
        return 0;
      }
      case 'skip': {
        const { values, rest: ids } = options(rest, ['date']);
        const day = parseDay(values['date']);
        if (!journal.setProjectDay(id(ids[0]), day, { skipped: true })) throw new UsageError(`There is no project #${ids[0]}.`);
        console.log(`Saved: nothing on project #${ids[0]} on ${day}.`);
        return 0;
      }
      case 'create': {
        const { values, flags } = options(rest, ['file'], ['dry-run']);
        const today = parseDay(undefined);
        const plan = reportCheck(checkNewProject(readPlanFile(values['file']), today));
        if (flags.has('dry-run')) {
          console.log(`The plan is fine. It would create "${plan.name}" with ${plan.subtasks.length} sub-task(s) and ${plan.subtasks.reduce((n, s) => n + Object.keys(s.targets).length, 0)} planned day(s). Nothing saved.`);
          return 0;
        }
        const created = journal.createProjectFromPlan(plan, today);
        const view = journal.projectOverview(created.id, today, neglectAfter(journal));
        console.log(`Created:\n${view ? detailLines(view, today).join('\n') : ''}`);
        return 0;
      }
      case 'plan': {
        const { values, flags, rest: ids } = options(rest, ['file'], ['dry-run']);
        const projectId = id(ids[0]);
        const today = parseDay(undefined);
        const current = journal.project(projectId);
        if (!current) throw new UsageError(`There is no project #${ids[0]}.`);
        const plan = reportCheck(checkReplan(readPlanFile(values['file']), today, { due: current.due, subtasks: journal.subtasks(projectId) }));
        if (flags.has('dry-run')) {
          const added = plan.subtasks.filter((s) => s.id === undefined).length;
          console.log(`The plan is fine. It would re-plan ${plan.subtasks.length - added} sub-task(s) from ${today} on and add ${added}. Nothing saved.`);
          return 0;
        }
        journal.applyPlan(projectId, plan, today);
        const view = journal.projectOverview(projectId, today, neglectAfter(journal));
        console.log(`Re-planned:\n${view ? detailLines(view, today).join('\n') : ''}`);
        return 0;
      }
      default:
        throw new UsageError(`Usage:\n${PROJECTS_USAGE}`);
    }
  } finally {
    journal.close();
  }
}

function sub(args: string[]): number {
  const [action, ...rest] = args;
  const journal = openJournal();
  try {
    switch (action) {
      case 'add': {
        const { values, rest: words } = options(rest, ['total', 'unit', 'due', 'done']);
        const [target, ...text] = words;
        const title = text.join(' ').trim();
        if (!title) throw new UsageError('Usage: raqib sub add <project id> "title" [--total 120 --unit slides] [--due D]');
        if (title.length > 200) throw new UsageError('Keep the title to 200 characters');
        const total = countOption(values['total'], 'total') ?? null;
        if (values['unit'] !== undefined && total === null) throw new UsageError('A unit needs a total: --total 120 --unit slides');
        let alreadyDone = 0;
        if (values['done'] !== undefined) {
          alreadyDone = Number(values['done']);
          if (total === null || !Number.isInteger(alreadyDone) || alreadyDone < 0 || alreadyDone > total) throw new UsageError('--done needs a total, and must be a whole number from 0 to the total');
        }
        const added = journal.addSubtask(id(target), { title, total, unit: values['unit']?.trim() || null, due: dueOption(values['due']) ?? null, alreadyDone });
        if (!added) throw new UsageError(`There is no project #${target}.`);
        show(journal, added.projectId, parseDay(undefined));
        return 0;
      }
      case 'edit': {
        const { values, rest: ids } = options(rest, ['title', 'total', 'unit', 'due']);
        const change: { title?: string; total?: number; unit?: string | null; due?: string | null } = {};
        if (values['title'] !== undefined) change.title = values['title'].trim();
        const total = countOption(values['total'], 'total');
        if (total !== undefined) change.total = total;
        if (values['unit'] !== undefined) change.unit = values['unit'].trim() || null;
        const due = dueOption(values['due']);
        if (due !== undefined) change.due = due;
        if (Object.keys(change).length === 0) throw new UsageError('Usage: raqib sub edit <id> [--title "..."] [--total N] [--unit U] [--due D|none]');
        const updated = journal.updateSubtask(id(ids[0]), change);
        if (!updated) throw new UsageError(`There is no sub-task #${ids[0]}.`);
        show(journal, updated.projectId, parseDay(undefined));
        return 0;
      }
      case 'done':
      case 'undo': {
        const { values, rest: ids } = options(rest, ['date']);
        const current = journal.subtask(id(ids[0]));
        if (!current) throw new UsageError(`There is no sub-task #${ids[0]}.`);
        if (current.total !== null) throw new UsageError(`"${current.title}" is counted in ${current.unit ?? 'numbers'}: use raqib progress ${current.id} +N`);
        const day = parseDay(values['date']);
        journal.setSubtaskDone(current.id, action === 'done', day);
        show(journal, current.projectId, day);
        return 0;
      }
      case 'rm': {
        const current = journal.subtask(id(rest[0]));
        if (!current) throw new UsageError(`There is no sub-task #${rest[0]}.`);
        journal.deleteSubtask(current.id);
        console.log(`Removed sub-task #${current.id} (${current.title}) with its progress and plan.`);
        return 0;
      }
      default:
        throw new UsageError('Usage: raqib sub add <project id> "title" | sub edit <id> ... | sub done|undo <id> | sub rm <id>');
    }
  } finally {
    journal.close();
  }
}

/** "+15" or "15" adds, "-3" takes away, "=12" sets the day's amount. */
export function parseAmount(text: string | undefined): { set: boolean; amount: number } {
  const match = /^([+=-]?)(\d+)$/.exec(text?.trim() ?? '');
  if (!match) throw new UsageError('Give an amount like +15, -3, or =12');
  const n = Number(match[2]);
  if (match[1] === '=') return { set: true, amount: n };
  if (n === 0) throw new UsageError('+0 changes nothing');
  return { set: false, amount: match[1] === '-' ? -n : n };
}

function progress(args: string[]): number {
  const { values, rest } = options(args, ['date']);
  const subtaskId = id(rest[0]);
  const { set, amount: n } = parseAmount(rest[1]);
  const day = parseDay(values['date']);
  const journal = openJournal();
  try {
    const current = journal.subtask(subtaskId);
    if (!current) throw new UsageError(`There is no sub-task #${rest[0]}.`);
    if (current.total === null) throw new UsageError(`"${current.title}" is a checkbox: use raqib sub done ${current.id}`);
    const updated = set ? journal.setProgress(subtaskId, day, n) : journal.addProgress(subtaskId, day, n);
    if (!updated) throw new UsageError(`That would take "${current.title}" below zero (it's at ${current.done}).`);
    show(journal, updated.projectId, day);
    return 0;
  } finally {
    journal.close();
  }
}

function targets(args: string[]): number {
  const { flags, rest } = options(args, [], ['json']);
  const day = parseDay(rest[0]);
  const journal = openJournal();
  try {
    const list = journal
      .projectOverviews(day, neglectAfter(journal), 'active')
      .flatMap((p) => p.subtasks.filter((s) => s.todayTarget !== null).map((s) => ({ project: p.name, projectId: p.id, subtaskId: s.id, title: s.title, unit: s.unit, checkbox: s.total === null, target: s.todayTarget as number, done: s.total === null ? s.done : s.doneToday })));
    if (flags.has('json')) {
      console.log(JSON.stringify(list, null, 2));
      return 0;
    }
    console.log(`Targets for ${day}`);
    if (list.length === 0) console.log('  Nothing planned.');
    for (const t of list) {
      const met = t.done >= t.target;
      console.log(`  [${met ? 'x' : ' '}] ${t.project} · ${t.title}  #${t.subtaskId}  ${t.checkbox ? 'do it' : `${t.done} / ${amount(t.target, t.unit)}`}`);
    }
    return 0;
  } finally {
    journal.close();
  }
}

export const PROJECT_COMMANDS: Record<string, (args: string[]) => number> = { projects, project, sub, progress, targets };
