// The window's project routes under /v1/ui/: projects, sub-tasks, what you did each day,
// and the plan. ui.ts has already checked the cookie and header before these run.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, send } from './api.ts';
import { parseLocalDate } from './dates.ts';
import type { Journal, ProjectChange, SubtaskChange } from './journal.ts';
import type { ProjectStatus } from './projects.ts';

type Body = Record<string, unknown>;

function day(value: unknown): string {
  if (typeof value !== 'string' || parseLocalDate(value) === null) throw new HttpError(400, 'day must look like 2026-11-05');
  return value;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > max) throw new HttpError(400, `${name} must be text of up to ${max} characters`);
  return value.trim();
}

/** undefined leaves it alone, null or '' clears it. */
function clearable<T>(value: unknown, read: (v: unknown) => T): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return read(value);
}

function count(value: unknown, name: string, { min = 1, max = 1_000_000 } = {}): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new HttpError(400, `${name} must be a whole number from ${min}`);
  return value;
}

function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new HttpError(400, 'colour must look like #4f8cff');
  return value;
}

function status(value: unknown): ProjectStatus {
  if (value !== 'active' && value !== 'paused' && value !== 'done') throw new HttpError(400, 'status must be active, paused, or done');
  return value;
}

function projectChange(body: Body): ProjectChange {
  const change: ProjectChange = {};
  if (body['name'] !== undefined) change.name = text(body['name'], 'Name', 100);
  const c = clearable(body['color'], color);
  if (c !== undefined) change.color = c;
  if (body['status'] !== undefined) change.status = status(body['status']);
  const due = clearable(body['due'], day);
  if (due !== undefined) change.due = due;
  return change;
}

function subtaskChange(body: Body): SubtaskChange {
  const change: SubtaskChange = {};
  if (body['title'] !== undefined) change.title = text(body['title'], 'Title', 200);
  const total = clearable(body['total'], (v) => count(v, 'Total'));
  if (total !== undefined) change.total = total;
  const unit = clearable(body['unit'], (v) => text(v, 'Unit', 30));
  if (unit !== undefined) change.unit = unit;
  const due = clearable(body['due'], day);
  if (due !== undefined) change.due = due;
  return change;
}

/** Handles a project route, or returns false when the route isn't one of these. */
export async function projectRoutes(
  journal: Journal,
  method: string,
  route: string,
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  today: string,
): Promise<boolean> {
  let m: RegExpExecArray | null;
  const on = url.searchParams.get('date') ?? today;
  if (parseLocalDate(on) === null) throw new HttpError(400, 'date must look like 2026-11-05');
  const neglect = journal.neglectAfterDays();
  const overview = (id: number) => {
    const view = journal.projectOverview(id, on, neglect);
    if (!view) throw new HttpError(404, 'no such project');
    return view;
  };

  if (route === '/projects') {
    if (method === 'GET') {
      send(response, 200, { today: on, neglectAfterDays: neglect, projects: journal.projectOverviews(on, neglect) });
      return true;
    }
    if (method === 'POST') {
      const body = (await readJson(request)) as Body;
      const project = journal.addProject({ name: text(body['name'], 'Name', 100), color: clearable(body['color'], color) ?? null, due: clearable(body['due'], day) ?? null });
      send(response, 201, overview(project.id));
      return true;
    }
  }

  if (method === 'PUT' && route === '/projects/order') {
    const body = (await readJson(request)) as Body;
    const ids = body['ids'];
    if (!Array.isArray(ids) || !ids.every((i) => Number.isInteger(i) && i > 0)) throw new HttpError(400, 'ids must be a list of project ids');
    journal.reorderProjects(ids as number[]);
    send(response, 204);
    return true;
  }

  if ((m = /^\/projects\/(\d+)$/.exec(route))) {
    const id = Number(m[1]);
    if (method === 'GET') {
      send(response, 200, overview(id));
      return true;
    }
    if (method === 'PATCH') {
      if (!journal.updateProject(id, projectChange((await readJson(request)) as Body))) throw new HttpError(404, 'no such project');
      send(response, 200, overview(id));
      return true;
    }
    if (method === 'DELETE') {
      send(response, journal.deleteProject(id) ? 204 : 404);
      return true;
    }
  }

  // Day by day, newest first: what moved, and the note or skip. The last 90 days.
  if ((m = /^\/projects\/(\d+)\/history$/.exec(route)) && method === 'GET') {
    const id = Number(m[1]);
    if (!journal.project(id)) throw new HttpError(404, 'no such project');
    const from = new Date(Date.parse(`${on}T12:00:00`) - 89 * 86_400_000).toLocaleDateString('en-CA');
    const days = new Map<string, { day: string; progress: { subtaskId: number; amount: number }[]; note: string | null; skipped: boolean }>();
    const at = (d: string) => days.get(d) ?? days.set(d, { day: d, progress: [], note: null, skipped: false }).get(d)!;
    for (const p of journal.progressBetween(from, on, id)) {
      const entry = at(p.day);
      const same = entry.progress.find((x) => x.subtaskId === p.subtaskId);
      if (same) same.amount += p.amount;
      else entry.progress.push({ subtaskId: p.subtaskId, amount: p.amount });
    }
    for (const d of journal.projectDaysBetween(from, on, id)) Object.assign(at(d.day), { note: d.note, skipped: d.skipped });
    send(response, 200, [...days.values()].sort((a, b) => b.day.localeCompare(a.day)));
    return true;
  }

  if ((m = /^\/projects\/(\d+)\/subtasks$/.exec(route)) && method === 'POST') {
    const id = Number(m[1]);
    const body = (await readJson(request)) as Body;
    const total = clearable(body['total'], (v) => count(v, 'Total')) ?? null;
    const unit = clearable(body['unit'], (v) => text(v, 'Unit', 30)) ?? null;
    if (unit !== null && total === null) throw new HttpError(400, 'A unit needs a total, like 120 slides');
    if (!journal.addSubtask(id, { title: text(body['title'], 'Title', 200), total, unit, due: clearable(body['due'], day) ?? null })) throw new HttpError(404, 'no such project');
    send(response, 201, overview(id));
    return true;
  }

  // What you did on a project that day: a note, or "nothing today".
  if ((m = /^\/projects\/(\d+)\/days\/(\d{4}-\d{2}-\d{2})$/.exec(route)) && method === 'PUT') {
    const id = Number(m[1]);
    const body = (await readJson(request)) as Body;
    const change: { note?: string | null; skipped?: boolean } = {};
    const note = clearable(body['note'], (v) => text(v, 'Note', 1000));
    if (note !== undefined) change.note = note;
    if (body['skipped'] !== undefined) {
      if (typeof body['skipped'] !== 'boolean') throw new HttpError(400, 'skipped must be true or false');
      change.skipped = body['skipped'];
    }
    if (!journal.setProjectDay(id, day(m[2]), change)) throw new HttpError(404, 'no such project');
    send(response, 200, overview(id));
    return true;
  }

  if ((m = /^\/subtasks\/(\d+)$/.exec(route))) {
    const id = Number(m[1]);
    const current = journal.subtask(id);
    if (!current) throw new HttpError(404, 'no such sub-task');
    if (method === 'PATCH') {
      const body = (await readJson(request)) as Body;
      const change = subtaskChange(body);
      if (Object.keys(change).length && !journal.updateSubtask(id, change)) throw new HttpError(400, "A sub-task with progress can't become a checkbox");
      if (body['done'] !== undefined) {
        if (typeof body['done'] !== 'boolean') throw new HttpError(400, 'done must be true or false');
        if (!journal.setSubtaskDone(id, body['done'], day(body['day'] ?? on))) throw new HttpError(400, 'Only a checkbox can be ticked; count the others');
      }
      send(response, 200, overview(current.projectId));
      return true;
    }
    if (method === 'DELETE') {
      journal.deleteSubtask(id);
      send(response, 204);
      return true;
    }
  }

  // Progress on a measured sub-task: PUT sets the day's amount, POST adds to it.
  if ((m = /^\/subtasks\/(\d+)\/progress$/.exec(route)) && (method === 'PUT' || method === 'POST')) {
    const id = Number(m[1]);
    const body = (await readJson(request)) as Body;
    const current = journal.subtask(id);
    if (!current) throw new HttpError(404, 'no such sub-task');
    if (current.total === null) throw new HttpError(400, 'This one is a checkbox: tick it instead');
    const amount = count(body['amount'], 'Amount', { min: method === 'PUT' ? 0 : -1_000_000 });
    const when = day(body['day'] ?? on);
    const updated = method === 'PUT' ? journal.setProgress(id, when, amount) : journal.addProgress(id, when, amount);
    if (!updated) throw new HttpError(400, "That would take it below zero");
    send(response, 200, overview(current.projectId));
    return true;
  }

  // One day of the plan: PUT /subtasks/:id/targets/:day {amount}; 0 removes it.
  if ((m = /^\/subtasks\/(\d+)\/targets\/(\d{4}-\d{2}-\d{2})$/.exec(route)) && method === 'PUT') {
    const id = Number(m[1]);
    const current = journal.subtask(id);
    if (!current) throw new HttpError(404, 'no such sub-task');
    const body = (await readJson(request)) as Body;
    const amount = count(body['amount'], 'Amount', { min: 0, max: current.total === null ? 1 : 1_000_000 });
    journal.setTarget(id, day(m[2]), amount);
    send(response, 200, overview(current.projectId));
    return true;
  }

  return false;
}
