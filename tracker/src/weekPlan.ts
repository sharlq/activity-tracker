// A proposed plan for a week, as one JSON document: what Claude writes for `propose`.
// It holds aims for the week, and for each day its aims and time blocks, each with a line
// on why it's there. Nothing in it touches your days until you look it over in the window
// (Proposed plan) and apply the days you take. Checked in full before it's saved.
import { parseLocalDate } from './dates.ts';
import type { PlanBlock } from './journal.ts';
import type { Checked } from './projectPlan.ts';

export interface ProposedBlock {
  /** "HH:MM". An end at or before the start runs past midnight. */
  start: string;
  end: string;
  label: string;
  category: string | null;
  /** Why the block is there, in a line. */
  why: string | null;
}

export interface ProposedAim {
  text: string;
  /** The week aim it serves: 1 for the first, or null when it stands on its own. */
  aim: number | null;
}

export interface ProposedDay {
  day: string;
  aims: ProposedAim[];
  blocks: ProposedBlock[];
}

export interface WeekAimPlan {
  text: string;
  /** How the week gets there, in a line. */
  how: string | null;
}

export interface WeekProposal {
  /** The week's Monday. */
  week: string;
  /** The reasoning behind the shape of the week. */
  note: string | null;
  /** Short facts it was built around ("Job 07:00–16:00, Sun–Thu"). */
  basedOn: string[];
  aims: WeekAimPlan[];
  /** Only the days it proposes something for, Monday first. */
  days: ProposedDay[];
}

export type ProposalStatus = 'waiting' | 'applied' | 'discarded' | 'replaced';

/** What you took from a proposal: the days, minus the blocks and aims you switched off. */
export interface ApplyChoice {
  days: string[];
  /** `<day>#<index>` of a block in that day's list. */
  dropBlocks: string[];
  /** `<day>#<index>` of an aim in that day's list. */
  dropAims: string[];
  /** Week aim numbers, from 1. Day aims serving one go with it. */
  dropWeekAims: number[];
}

export interface Proposal extends WeekProposal {
  id: number;
  status: ProposalStatus;
  createdAt: number;
  decidedAt: number | null;
  choice: ApplyChoice | null;
}

export const MAX_WEEK_AIMS = 5;
export const MAX_DAY_AIMS = 3;
const MAX_BLOCKS = 20;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The Monday of the week holding `day`. */
export function mondayOfDay(day: string): string {
  const d = new Date(parseLocalDate(day) as number);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return keyOf(d.getTime());
}

export function addDays(day: string, n: number): string {
  const d = new Date(parseLocalDate(day) as number);
  d.setDate(d.getDate() + n);
  return keyOf(d.getTime());
}

function keyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clockMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** A proposed block's times on its day, as ms; an end at or before the start runs into the next day. */
export function blockTimes(day: string, start: string, end: string): { start: number; end: number } {
  const at = (key: string, minutes: number) => {
    const d = new Date(parseLocalDate(key) as number);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return d.getTime();
  };
  const from = clockMinutes(start) as number;
  const until = clockMinutes(end) as number;
  return { start: at(day, from), end: until <= from ? at(addDays(day, 1), until) : at(day, until) };
}

function text(value: unknown, what: string, errors: string[], max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${what} is missing.`);
    return '';
  }
  if (value.trim().length > max) errors.push(`${what} is longer than ${max} characters.`);
  return value.trim();
}

function optionalText(value: unknown, what: string, errors: string[], max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, what, errors, max);
}

/** Checks a proposal for a week. `today` keeps it from planning days already gone. */
export function checkProposal(raw: unknown, today: string): Checked<WeekProposal> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ['The proposal must be a JSON object.'] };

  let week = '';
  if (typeof raw.week !== 'string' || parseLocalDate(raw.week) === null) errors.push('"week" must be the week\'s Monday, like 2026-11-23.');
  else if (mondayOfDay(raw.week) !== raw.week) errors.push(`"week" must be a Monday: the week of ${raw.week} starts on ${mondayOfDay(raw.week)}.`);
  else week = raw.week;
  if (week && addDays(week, 6) < today) errors.push(`The week of ${week} is already over.`);

  const note = optionalText(raw.note, 'The note', errors, 1000);

  const basedOn: string[] = [];
  if (raw.basedOn !== undefined) {
    if (!Array.isArray(raw.basedOn)) errors.push('"basedOn" must be a list of short facts.');
    else for (const [i, b] of raw.basedOn.entries()) basedOn.push(text(b, `basedOn ${i + 1}`, errors, 60));
    if (basedOn.length > 8) errors.push('"basedOn" takes up to 8 facts.');
  }

  const aims: WeekAimPlan[] = [];
  if (!Array.isArray(raw.aims) || raw.aims.length === 0) errors.push('"aims" must list the week\'s aims (1 to 5).');
  else {
    if (raw.aims.length > MAX_WEEK_AIMS) errors.push(`A week takes up to ${MAX_WEEK_AIMS} aims.`);
    for (const [i, a] of raw.aims.entries()) {
      if (!isObject(a)) {
        errors.push(`Week aim ${i + 1} must be an object with "text".`);
        continue;
      }
      aims.push({ text: text(a.text, `Week aim ${i + 1}`, errors, 120), how: optionalText(a.how, `How for week aim ${i + 1}`, errors, 300) });
    }
  }

  const days: ProposedDay[] = [];
  if (!isObject(raw.days) || Object.keys(raw.days).length === 0) errors.push('"days" must map each planned day (YYYY-MM-DD) to its aims and blocks.');
  else {
    for (const [day, value] of Object.entries(raw.days).sort(([a], [b]) => a.localeCompare(b))) {
      if (parseLocalDate(day) === null) {
        errors.push(`"${day}" is not a date like 2026-11-23.`);
        continue;
      }
      if (week && (day < week || day > addDays(week, 6))) errors.push(`${day} isn't in the week of ${week}.`);
      if (day < today) errors.push(`${day} has already passed.`);
      if (!isObject(value)) {
        errors.push(`${day} must be an object with "aims" and "blocks".`);
        continue;
      }
      const dayAims: ProposedAim[] = [];
      if (value.aims !== undefined) {
        if (!Array.isArray(value.aims)) errors.push(`${day}: "aims" must be a list.`);
        else {
          if (value.aims.length > MAX_DAY_AIMS) errors.push(`${day}: a day takes up to ${MAX_DAY_AIMS} aims.`);
          for (const [i, a] of value.aims.entries()) {
            const entry = typeof a === 'string' ? { text: a } : a;
            if (!isObject(entry)) {
              errors.push(`${day}: aim ${i + 1} must be text or an object with "text".`);
              continue;
            }
            let aim: number | null = null;
            if (entry.aim !== undefined && entry.aim !== null) {
              if (typeof entry.aim !== 'number' || !Number.isInteger(entry.aim) || entry.aim < 1 || entry.aim > aims.length) {
                errors.push(`${day}: aim ${i + 1} points at week aim ${String(entry.aim)}, but there are ${aims.length}.`);
              } else aim = entry.aim;
            }
            dayAims.push({ text: text(entry.text, `${day}: aim ${i + 1}`, errors, 200), aim });
          }
        }
      }
      const blocks: ProposedBlock[] = [];
      if (value.blocks !== undefined) {
        if (!Array.isArray(value.blocks)) errors.push(`${day}: "blocks" must be a list.`);
        else {
          if (value.blocks.length > MAX_BLOCKS) errors.push(`${day}: up to ${MAX_BLOCKS} blocks a day.`);
          for (const [i, b] of value.blocks.entries()) {
            const where = `${day}: block ${i + 1}`;
            if (!isObject(b)) {
              errors.push(`${where} must be an object.`);
              continue;
            }
            const start = typeof b.start === 'string' ? b.start.trim() : '';
            const end = typeof b.end === 'string' ? b.end.trim() : '';
            if (clockMinutes(start) === null || clockMinutes(end) === null) {
              errors.push(`${where} needs "start" and "end" times like 17:00.`);
              continue;
            }
            if (start === end) errors.push(`${where} starts and ends at ${start}.`);
            blocks.push({
              start: start.padStart(5, '0'),
              end: end.padStart(5, '0'),
              label: text(b.label, `${where}'s label`, errors, 200),
              category: optionalText(b.category, `${where}'s category`, errors, 40),
              why: optionalText(b.why, `${where}'s why`, errors, 300),
            });
          }
          const timed = blocks.map((b, i) => ({ i, ...blockTimes(day, b.start, b.end) })).sort((a, b) => a.start - b.start);
          for (let k = 1; k < timed.length; k++) {
            const a = timed[k - 1] as (typeof timed)[number];
            const b = timed[k] as (typeof timed)[number];
            if (b.start < a.end) errors.push(`${day}: "${blocks[a.i]?.label}" and "${blocks[b.i]?.label}" overlap.`);
          }
          blocks.sort((a, b) => blockTimes(day, a.start, a.end).start - blockTimes(day, b.start, b.end).start);
        }
      }
      if (dayAims.length === 0 && blocks.length === 0) warnings.push(`${day} has no aims or blocks.`);
      if (dayAims.length === 0 && blocks.length > 0) warnings.push(`${day} has blocks but no aims.`);
      days.push({ day, aims: dayAims, blocks });
    }
  }

  for (const [i] of aims.entries()) {
    if (!days.some((d) => d.aims.some((a) => a.aim === i + 1))) warnings.push(`No day aim serves week aim ${i + 1}.`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, plan: { week, note, basedOn, aims, days }, warnings };
}

/** How a day's proposal compares with what's planned for it now. */
export interface DayComparison {
  /** Per proposed block: the times of the block it moves, when one with the same label sits elsewhere. */
  was: (string | null)[];
  /** Per proposed block: it's already planned exactly so. */
  same: boolean[];
  /** Blocks planned now that the proposal doesn't keep. */
  removed: PlanBlock[];
}

const clockOf = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function compareDay(day: string, current: readonly PlanBlock[], proposed: readonly ProposedBlock[]): DayComparison {
  const used = new Set<number>();
  const times = proposed.map((b) => blockTimes(day, b.start, b.end));
  const same = proposed.map((b, i) => {
    const t = times[i] as { start: number; end: number };
    const hit = current.find((c) => !used.has(c.id) && sameLabel(c.label, b.label) && c.start === t.start && c.end === t.end);
    if (hit) used.add(hit.id);
    return Boolean(hit);
  });
  const was = proposed.map((b, i) => {
    if (same[i]) return null;
    const hit = current.find((c) => !used.has(c.id) && sameLabel(c.label, b.label));
    if (!hit) return null;
    used.add(hit.id);
    return `${clockOf(hit.start)}–${clockOf(hit.end)}`;
  });
  return { was, same, removed: current.filter((c) => !used.has(c.id)) };
}

/** Checks a choice from the window against the proposal it's for. */
export function checkChoice(raw: unknown, proposal: WeekProposal): ApplyChoice | string {
  if (!isObject(raw)) return 'The choice must be an object.';
  const list = (value: unknown): string[] | null => (Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null);
  const days = list(raw.days);
  if (!days || days.length === 0) return 'Take at least one day.';
  const known = new Set(proposal.days.map((d) => d.day));
  const unknown = days.find((d) => !known.has(d));
  if (unknown) return `${unknown} isn't in this proposal.`;
  const dropBlocks = list(raw.dropBlocks ?? []);
  const dropAims = list(raw.dropAims ?? []);
  if (!dropBlocks || !dropAims) return 'dropBlocks and dropAims must be lists like "2026-11-23#0".';
  const dropWeekAims = raw.dropWeekAims ?? [];
  if (!Array.isArray(dropWeekAims) || dropWeekAims.some((n) => typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > proposal.aims.length)) {
    return `dropWeekAims must be week aim numbers from 1 to ${proposal.aims.length}.`;
  }
  return { days: [...new Set(days)], dropBlocks, dropAims, dropWeekAims: dropWeekAims as number[] };
}
