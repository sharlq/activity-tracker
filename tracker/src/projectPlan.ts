// A plan for a project, as one JSON document: what Claude writes for `project create`
// (a new project with its sub-tasks and daily targets) and `project plan` (new targets for
// an existing one). Checked in full before anything is saved.
import { parseLocalDate } from './dates.ts';
import type { Subtask } from './projects.ts';
import { remainingOf } from './projects.ts';

export interface PlannedSubtask {
  /** An existing sub-task to re-plan (`project plan` only); absent for a new one. */
  id?: number;
  title: string;
  unit: string | null;
  total: number | null;
  due: string | null;
  /** New measured sub-tasks only: how many were done before tracking began. */
  alreadyDone?: number;
  /** Day → amount. For a checkbox the amount is 1. */
  targets: Record<string, number>;
}

export interface NewProjectPlan {
  name: string;
  color: string | null;
  due: string | null;
  subtasks: PlannedSubtask[];
}

export interface Replan {
  /** Sub-tasks with `id` get their targets from today on replaced; others are added. */
  subtasks: PlannedSubtask[];
  /** A new project deadline, when given. */
  due?: string | null;
}

export type Checked<T> = { ok: true; plan: T; warnings: string[] } | { ok: false; errors: string[] };

const MAX_SUBTASKS = 100;
const MAX_TARGET_DAYS = 400;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isDay = (value: unknown): value is string => typeof value === 'string' && parseLocalDate(value) !== null;
const amount = (n: number, unit: string | null): string => (unit ? `${n} ${unit}` : String(n));
const isCount =(value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

function text(value: unknown, what: string, errors: string[], max = 200): string {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${what} is missing.`);
    return '';
  }
  if (value.trim().length > max) errors.push(`${what} is longer than ${max} characters.`);
  return value.trim();
}

function optionalDay(value: unknown, what: string, errors: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (!isDay(value)) {
    errors.push(`${what} must be a date like 2026-11-28.`);
    return null;
  }
  return value;
}

interface Context {
  today: string;
  /** The project's deadline (new or current), for warnings. */
  projectDue: string | null;
  /** Existing sub-tasks by id, when re-planning. */
  existing?: Map<number, Pick<Subtask, 'title' | 'unit' | 'total' | 'done' | 'due'>>;
}

function checkSubtask(raw: unknown, label: string, ctx: Context, errors: string[], warnings: string[]): PlannedSubtask {
  if (!isObject(raw)) {
    errors.push(`${label} must be an object.`);
    return { title: '', unit: null, total: null, due: null, targets: {} };
  }

  let id: number | undefined;
  let existing: Pick<Subtask, 'title' | 'unit' | 'total' | 'done' | 'due'> | undefined;
  if (raw.id !== undefined) {
    if (!ctx.existing) errors.push(`${label}: "id" only works when re-planning an existing project.`);
    else if (!isCount(raw.id) || !ctx.existing.has(raw.id)) errors.push(`${label}: there's no sub-task ${String(raw.id)} in this project.`);
    else {
      id = raw.id;
      existing = ctx.existing.get(raw.id);
    }
  }

  const title = existing && raw.title === undefined ? existing.title : text(raw.title, `${label}'s title`, errors);
  const name = title ? `"${title}"` : label;

  let total: number | null = existing ? existing.total : null;
  if (raw.total !== undefined && raw.total !== null) {
    if (!isCount(raw.total)) errors.push(`${name}: total must be a whole number above 0.`);
    else total = raw.total;
  }
  // Re-planning: what the plan leaves out stays as it is.
  let unit: string | null = existing ? existing.unit : null;
  if (raw.unit !== undefined && raw.unit !== null) {
    unit = text(raw.unit, `${name}'s unit`, errors, 30) || null;
    if (total === null) errors.push(`${name}: a unit needs a total (how many ${unit ?? 'of them'}).`);
  }
  if (total !== null && unit === null && !existing) warnings.push(`${name} has a total but no unit; it will show as just numbers.`);
  if (existing && existing.total !== null && total === null) errors.push(`${name}: a measured sub-task can't become a checkbox.`);

  let alreadyDone = 0;
  if (raw.done !== undefined && raw.done !== null) {
    if (existing) errors.push(`${name}: "done" is only for new sub-tasks; report progress with the progress command instead.`);
    else if (total === null) errors.push(`${name}: "done" needs a total (it's a count of what's already finished).`);
    else if (typeof raw.done !== 'number' || !Number.isInteger(raw.done) || raw.done < 0 || raw.done > total) errors.push(`${name}: "done" must be a whole number from 0 to ${total}.`);
    else alreadyDone = raw.done;
  }

  const due = existing && raw.due === undefined ? existing.due : optionalDay(raw.due, `${name}'s due date`, errors);
  if (due && due < ctx.today) warnings.push(`${name}'s due date ${due} has already passed.`);
  if (due && ctx.projectDue && due > ctx.projectDue) warnings.push(`${name} is due ${due}, after the project's deadline ${ctx.projectDue}.`);

  const targets: Record<string, number> = {};
  if (raw.targets !== undefined && raw.targets !== null) {
    if (!isObject(raw.targets)) errors.push(`${name}: targets must map dates to amounts, like {"2026-11-11": 15}.`);
    else {
      const entries = Object.entries(raw.targets);
      if (entries.length > MAX_TARGET_DAYS) errors.push(`${name}: more than ${MAX_TARGET_DAYS} days of targets.`);
      let sum = 0;
      let late = 0;
      for (const [day, value] of entries) {
        if (!isDay(day)) errors.push(`${name}: "${day}" isn't a date like 2026-11-11.`);
        else if (day < ctx.today) errors.push(`${name}: can't plan ${day}, it's in the past.`);
        else if (!isCount(value)) errors.push(`${name}: the target for ${day} must be a whole number above 0.`);
        else if (total === null && value !== 1) errors.push(`${name} is a checkbox, so its target for ${day} must be 1.`);
        else {
          targets[day] = value;
          sum += value;
          const limit = due ?? ctx.projectDue;
          if (limit && day > limit) late++;
        }
      }
      const left = remainingOf({ total, done: existing?.done ?? alreadyDone });
      if (total === null && Object.keys(targets).length > 1) errors.push(`${name} is a checkbox, so it can only be planned for one day.`);
      else if (sum > left) errors.push(`${name}: the targets add up to ${sum}, but only ${amount(left, unit)} left.`);
      if (late > 0) warnings.push(`${name}: ${late} planned day(s) fall after its due date.`);
      if (sum < left && total !== null && entries.length > 0) warnings.push(`${name}: the plan covers ${sum} of the ${amount(left, unit)} left.`);
    }
  }

  const subtask: PlannedSubtask = { title, unit, total, due, targets };
  if (id !== undefined) subtask.id = id;
  if (alreadyDone > 0) subtask.alreadyDone = alreadyDone;
  return subtask;
}

function checkSubtasks(raw: unknown, ctx: Context, errors: string[], warnings: string[], required: boolean): PlannedSubtask[] {
  if (raw === undefined && !required) return [];
  if (!Array.isArray(raw)) {
    errors.push('"subtasks" must be a list.');
    return [];
  }
  if (raw.length > MAX_SUBTASKS) errors.push(`More than ${MAX_SUBTASKS} sub-tasks.`);
  const subtasks = raw.map((s, i) => checkSubtask(s, `Sub-task ${i + 1}`, ctx, errors, warnings));
  const ids = subtasks.flatMap((s) => (s.id === undefined ? [] : [s.id]));
  if (new Set(ids).size !== ids.length) errors.push('The same sub-task id appears twice.');
  return subtasks;
}

/** Checks a plan for a new project. */
export function checkNewProject(raw: unknown, today: string): Checked<NewProjectPlan> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['The plan must be a JSON object.'] };

  const name = text(raw.name, 'The project name', errors, 100);
  const due = optionalDay(raw.due, 'The project deadline', errors);
  if (due && due < today) warnings.push(`The deadline ${due} has already passed.`);
  let color: string | null = null;
  if (raw.color !== undefined && raw.color !== null) {
    if (typeof raw.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw.color)) errors.push('The colour must look like #4f8cff.');
    else color = raw.color;
  }
  const subtasks = checkSubtasks(raw.subtasks, { today, projectDue: due }, errors, warnings, false);
  if (subtasks.length === 0 && errors.length === 0) warnings.push('The project has no sub-tasks yet.');

  return errors.length > 0 ? { ok: false, errors } : { ok: true, plan: { name, color, due, subtasks }, warnings };
}

/** Checks a new plan for an existing project's sub-tasks. */
export function checkReplan(
  raw: unknown,
  today: string,
  project: { due: string | null; subtasks: Pick<Subtask, 'id' | 'title' | 'unit' | 'total' | 'done' | 'due'>[] },
): Checked<Replan> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['The plan must be a JSON object.'] };

  const plan: Replan = { subtasks: [] };
  let projectDue = project.due;
  if (raw.due !== undefined) {
    plan.due = optionalDay(raw.due, 'The project deadline', errors);
    projectDue = plan.due;
  }
  const existing = new Map(project.subtasks.map((s) => [s.id, s]));
  plan.subtasks = checkSubtasks(raw.subtasks, { today, projectDue, existing }, errors, warnings, true);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, plan, warnings };
}
