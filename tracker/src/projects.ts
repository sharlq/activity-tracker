// Projects: the longer things going on in your life, split into sub-tasks. A sub-task is
// either measured (120 slides, with a progress bar) or a checkbox (done or not). What you
// did is kept per day, and a plan says how much to do on which day.
//
// Everything here is pure: the journal reads the rows, these functions make sense of them.
import { domainMatches } from './browser.ts';
import { parseLocalDate } from './dates.ts';
import type { Activity, WindowInfo } from './merger.ts';

export type ProjectStatus = 'active' | 'paused' | 'done';

export interface Project {
  id: number;
  name: string;
  color: string | null;
  status: ProjectStatus;
  /** Deadline, YYYY-MM-DD, or null. */
  due: string | null;
  position: number;
  createdAt: number;
  /**
   * Words that make PC time count toward this project: a window title containing
   * one ("AWS Certified"), a site ("aws.amazon.com"), an app ("FoxitPDFReader"),
   * or an editor workspace. Empty: only what you report counts.
   */
  match: string[];
}

/** True if this window's time belongs to a project with these match words. */
export function matchesProject(window: WindowInfo, match: readonly string[]): boolean {
  const title = window.title.toLowerCase();
  const app = window.processName.toLowerCase().replace(/\.exe$/, '');
  return match.some((raw) => {
    const word = raw.trim().toLowerCase();
    if (!word) return false;
    return (
      title.includes(word) ||
      app === word.replace(/\.exe$/, '') ||
      (window.domain !== undefined && domainMatches(window.domain, word)) ||
      (window.project !== undefined && window.project.toLowerCase() === word)
    );
  });
}

/**
 * Active PC time per project in [from, to): window events matching a project's
 * words. A moment matching two projects counts for the first, in the order given.
 * Idle time never counts, even with the project's PDF in front.
 */
export function pcTimeByProject(
  events: readonly { start: number; end: number; activity: Activity }[],
  projects: readonly Pick<Project, 'id' | 'match'>[],
  from: number,
  to: number,
): Map<number, number> {
  const out = new Map<number, number>();
  const withWords = projects.filter((p) => p.match.length > 0);
  if (withWords.length === 0) return out;
  for (const e of events) {
    if (e.activity.kind !== 'window') continue;
    const ms = Math.min(e.end, to) - Math.max(e.start, from);
    if (ms <= 0) continue;
    const { kind: _kind, ...window } = e.activity;
    const owner = withWords.find((p) => matchesProject(window, p.match));
    if (owner) out.set(owner.id, (out.get(owner.id) ?? 0) + ms);
  }
  return out;
}

export interface Subtask {
  id: number;
  projectId: number;
  title: string;
  /** What's counted ('slides', 'pages'), or null for a checkbox. */
  unit: string | null;
  /** How many in all, or null for a checkbox. */
  total: number | null;
  /** How many are done so far (0 or 1 for a checkbox). */
  done: number;
  /** When a checkbox was ticked, or null. */
  doneAt: number | null;
  /** Milestone date, YYYY-MM-DD, or null. */
  due: string | null;
  position: number;
}

/** Some of a sub-task done on a day. Negative amounts correct a mistake. */
export interface Progress {
  subtaskId: number;
  day: string;
  amount: number;
}

/** Your answer for a project on a day: a note on what you did, or "nothing today". */
export interface ProjectDay {
  projectId: number;
  day: string;
  note: string | null;
  skipped: boolean;
}

/** How much of a sub-task the plan says to do on a day. */
export interface Target {
  subtaskId: number;
  day: string;
  amount: number;
}

export const isCheckbox = (subtask: Pick<Subtask, 'total'>): boolean => subtask.total === null;

/** How much there is to do in all: the total, or 1 for a checkbox. */
export const sizeOf = (subtask: Pick<Subtask, 'total'>): number => subtask.total ?? 1;

/** 0 to 1. Doing more than the total still counts as finished, not more. */
export function subtaskFraction(subtask: Pick<Subtask, 'total' | 'done'>): number {
  return Math.min(1, Math.max(0, subtask.done / sizeOf(subtask)));
}

/** The average of its sub-tasks, each counting the same whatever its size. 0 with none. */
export function projectFraction(subtasks: Pick<Subtask, 'total' | 'done'>[]): number {
  if (subtasks.length === 0) return 0;
  return subtasks.reduce((sum, s) => sum + subtaskFraction(s), 0) / subtasks.length;
}

export const remainingOf = (subtask: Pick<Subtask, 'total' | 'done'>): number => Math.max(0, sizeOf(subtask) - subtask.done);

// Day arithmetic on YYYY-MM-DD, done in UTC so daylight saving never shifts a day.

const utcDay = (day: string): number => {
  if (parseLocalDate(day) === null) throw new Error(`Not a date: ${day}`);
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export function addDays(day: string, days: number): string {
  return new Date((utcDay(day) + days) * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`: 1 for the day after, negative for before. */
export const daysBetween = (from: string, to: string): number => utcDay(to) - utcDay(from);

/** The last day you worked on a project: progress made or a note written (not a skip). */
export function lastWorkedDay(projectId: number, subtaskIds: Set<number>, progress: Progress[], days: ProjectDay[]): string | null {
  let last: string | null = null;
  const later = (day: string) => {
    if (last === null || day > last) last = day;
  };
  for (const p of progress) if (subtaskIds.has(p.subtaskId) && p.amount > 0) later(p.day);
  for (const d of days) if (d.projectId === projectId && !d.skipped && d.note) later(d.day);
  return last;
}

/**
 * How many days an active project has gone without work, when that's at least
 * `afterDays`; null when it's fine (or paused, or finished). A project never worked on
 * counts from the day it was created.
 */
export function neglectedFor(project: Pick<Project, 'status'>, lastWorked: string | null, createdDay: string, today: string, afterDays: number): number | null {
  if (project.status !== 'active') return null;
  const since = daysBetween(lastWorked ?? createdDay, today);
  return since >= afterDays ? since : null;
}

/** What's left and how much a day it takes to finish by the due date (today included). */
export interface Pace {
  remaining: number;
  /** Days from today to the due date, both included; 0 or less when it's past. */
  daysLeft: number;
  /** Rounded up; null when the due date has passed or nothing is left. */
  perDay: number | null;
}

export function paceTo(subtask: Pick<Subtask, 'total' | 'done'>, due: string, today: string): Pace {
  const remaining = remainingOf(subtask);
  const daysLeft = daysBetween(today, due) + 1;
  const perDay = remaining > 0 && daysLeft > 0 ? Math.ceil(remaining / daysLeft) : null;
  return { remaining, daysLeft, perDay };
}

/**
 * When you'd finish at the pace of the last `windowDays` days (today included), or null
 * when nothing moved in that time. Today if nothing is left.
 */
export function projectedFinish(remaining: number, progress: Progress[], today: string, windowDays = 7): string | null {
  if (remaining <= 1e-9) return today;
  const from = addDays(today, -(windowDays - 1));
  const done = progress.filter((p) => p.day >= from && p.day <= today).reduce((sum, p) => sum + p.amount, 0);
  if (done <= 0) return null;
  return addDays(today, Math.ceil(remaining / (done / windowDays)));
}

export type DayResult = 'met' | 'partly' | 'missed' | 'pending';

export interface PlannedDay {
  day: string;
  target: number;
  done: number;
  /** 'pending' for today (until it's met) and the days ahead. */
  result: DayResult;
}

export interface PlanStatus {
  days: PlannedDay[];
  /**
   * Done against what the plan expected by now: positive is ahead, negative behind.
   * Today's target only counts as far as you've done it, so the evening never shows
   * you behind for a day that isn't over.
   */
  ahead: number;
}

/** One sub-task's plan against what you actually did. */
export function planStatus(targets: Target[], progress: Progress[], today: string): PlanStatus {
  const doneOn = new Map<string, number>();
  for (const p of progress) doneOn.set(p.day, (doneOn.get(p.day) ?? 0) + p.amount);

  const sorted = [...targets].sort((a, b) => a.day.localeCompare(b.day));
  const days: PlannedDay[] = sorted.map((t) => {
    const done = Math.max(0, doneOn.get(t.day) ?? 0);
    let result: DayResult;
    if (done >= t.amount) result = 'met';
    else if (t.day >= today) result = 'pending';
    else result = done > 0 ? 'partly' : 'missed';
    return { day: t.day, target: t.amount, done, result };
  });

  const start = sorted[0]?.day;
  if (start === undefined) return { days, ahead: 0 };
  let expected = 0;
  for (const t of sorted) {
    if (t.day < today) expected += t.amount;
    else if (t.day === today) expected += Math.min(t.amount, Math.max(0, doneOn.get(today) ?? 0));
  }
  let done = 0;
  for (const p of progress) if (p.day >= start && p.day <= today) done += p.amount;
  return { days, ahead: done - expected };
}

// Everything about one project, put together for the page, the commands, and Claude.

export interface SubtaskOverview extends Subtask {
  fraction: number;
  remaining: number;
  /** Toward the sub-task's own due date, or the project's. Null without one. */
  pace: Pace | null;
  todayTarget: number | null;
  doneToday: number;
  /** Null when there's no plan for it. */
  plan: PlanStatus | null;
}

export interface ProjectOverview extends Project {
  fraction: number;
  subtasks: SubtaskOverview[];
  lastWorked: string | null;
  /** Days without work, when it's past the warning threshold; else null. */
  neglectedDays: number | null;
  /** At the last week's pace, across measured and checkbox sub-tasks alike. Null if nothing moved. */
  projectedFinish: string | null;
  today: ProjectDay | null;
}

export function overview(
  project: Project,
  subtasks: Subtask[],
  progress: Progress[],
  targets: Target[],
  days: ProjectDay[],
  today: string,
  neglectAfterDays: number,
): ProjectOverview {
  const ids = new Set(subtasks.map((s) => s.id));
  const subs = subtasks
    .slice()
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((s): SubtaskOverview => {
      const own = progress.filter((p) => p.subtaskId === s.id);
      const plan = targets.filter((t) => t.subtaskId === s.id);
      const due = s.due ?? project.due;
      return {
        ...s,
        fraction: subtaskFraction(s),
        remaining: remainingOf(s),
        pace: due ? paceTo(s, due, today) : null,
        todayTarget: plan.find((t) => t.day === today)?.amount ?? null,
        doneToday: own.filter((p) => p.day === today).reduce((sum, p) => sum + p.amount, 0),
        plan: plan.length > 0 ? planStatus(plan, own, today) : null,
      };
    });

  // Finish projection in "fractions of the project", so slides and checkboxes mix fairly.
  const share = new Map(subtasks.map((s) => [s.id, 1 / (sizeOf(s) * Math.max(1, subtasks.length))]));
  const scaled = progress.filter((p) => ids.has(p.subtaskId)).map((p) => ({ ...p, amount: p.amount * (share.get(p.subtaskId) ?? 0) }));
  const fraction = projectFraction(subtasks);
  const createdDay = new Date(project.createdAt).toLocaleDateString('en-CA');
  const lastWorked = lastWorkedDay(project.id, ids, progress, days);

  return {
    ...project,
    fraction,
    subtasks: subs,
    lastWorked,
    neglectedDays: neglectedFor(project, lastWorked, createdDay, today, neglectAfterDays),
    projectedFinish: subtasks.length === 0 ? null : projectedFinish(1 - fraction, scaled, today),
    today: days.find((d) => d.projectId === project.id && d.day === today) ?? null,
  };
}

/** You've said something about a project that day: progress, a note, or "nothing today". */
export function answered(p: Pick<ProjectOverview, 'today' | 'subtasks'>): boolean {
  return Boolean(p.today?.note || p.today?.skipped || p.subtasks.some((s) => s.doneToday !== 0));
}

/** Active projects you haven't answered for that day. */
export const unanswered = (projects: ProjectOverview[]): ProjectOverview[] => projects.filter((p) => p.status === 'active' && !answered(p));

/** What a project did in a week, for the weekly review. */
export interface ProjectWeek {
  id: number;
  name: string;
  color: string | null;
  status: ProjectStatus;
  fraction: number;
  /** Net amount per sub-task that moved (checkboxes: 1 when ticked that week). */
  moved: { subtaskId: number; title: string; unit: string | null; checkbox: boolean; amount: number }[];
  /** Days with progress or a note. */
  daysWorked: number;
  /** Days marked "nothing today". */
  daysSkipped: number;
  /** Planned target days that week and how many were met (past days and today only). */
  targetDays: number;
  targetsMet: number;
  /** Active PC time that week from its match words (filled in by the window's week page). */
  pcMs?: number;
}

export function projectWeek(view: ProjectOverview, progress: Progress[], days: ProjectDay[], targets: Target[], from: string, to: string, today: string): ProjectWeek {
  const ids = new Map(view.subtasks.map((s) => [s.id, s]));
  const inWeek = (day: string) => day >= from && day <= to;
  const own = progress.filter((p) => ids.has(p.subtaskId) && inWeek(p.day));
  const sums = new Map<number, number>();
  for (const p of own) sums.set(p.subtaskId, (sums.get(p.subtaskId) ?? 0) + p.amount);
  const worked = new Set(own.filter((p) => p.amount > 0).map((p) => p.day));
  for (const d of days) if (d.projectId === view.id && inWeek(d.day) && d.note && !d.skipped) worked.add(d.day);
  const skipped = days.filter((d) => d.projectId === view.id && inWeek(d.day) && d.skipped && !worked.has(d.day)).length;
  const due = targets.filter((t) => ids.has(t.subtaskId) && inWeek(t.day) && t.day <= today);
  const met = due.filter((t) => own.filter((p) => p.subtaskId === t.subtaskId && p.day === t.day).reduce((n, p) => n + p.amount, 0) >= t.amount).length;
  return {
    id: view.id,
    name: view.name,
    color: view.color,
    status: view.status,
    fraction: view.fraction,
    moved: [...sums]
      .filter(([, amount]) => amount !== 0)
      .map(([subtaskId, amount]) => {
        const s = ids.get(subtaskId) as SubtaskOverview;
        return { subtaskId, title: s.title, unit: s.unit, checkbox: s.total === null, amount };
      }),
    daysWorked: worked.size,
    daysSkipped: skipped,
    targetDays: due.length,
    targetsMet: met,
  };
}
