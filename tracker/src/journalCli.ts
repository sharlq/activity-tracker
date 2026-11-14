// raqib day | log | unlog | tasks | task | reminders | remind (health and exercise ones are in healthCli.ts and exerciseCli.ts)
//
// The same records the window edits, from the command line, so you (or Claude,
// in a chat) can review a day and fill it in without opening the window. Writes
// go straight to the database, whether or not the tracker is running; the
// window shows them on its next refresh.
import { existsSync } from 'node:fs';
import { loadConfig } from './config.ts';
import { parseLocalDate } from './dates.ts';
import type { BlockOutcome } from './dayPlan.ts';
import type { Checkin, CheckinPart, Entry, Goal, GoalResult, PlanBlock, Reminder, Task } from './journal.ts';
import { dbPath, id, openJournal, options, parseDay, UsageError } from './cliShared.ts';
import { EXERCISE_COMMANDS, EXERCISE_USAGE, PLAN_USAGE } from './exerciseCli.ts';
import { HEALTH_COMMANDS, HEALTH_USAGE } from './healthCli.ts';
import { PROJECT_COMMANDS, PROJECTS_USAGE } from './projectsCli.ts';
import type { ReminderSchedule } from './planner.ts';
import { dayKey, minutesOf, nextSlot, parseSchedule } from './planner.ts';
import type { Sleep } from './report/index.ts';
import { clockOf } from './report/index.ts';
import { buildDay, buildWeek, shiftByDays } from './ui.ts';

export const JOURNAL_USAGE = `  raqib day [date] [--json]            Your day: summary, timeline, gaps to log, what you logged, tasks
  raqib log 07:15-09:00 "what" [--category meal] [--date D]
                                      Log what you did (an end before the start means past midnight)
  raqib unlog <id>                    Remove something you logged
  raqib tasks [date]                  List a day's tasks
  raqib task add "text" [--date D]    Add a task (also: task done|undo|rm <id>)
  raqib checkin [morning|evening] --mood 1-5 --energy 1-5 [--note "..."] [--date D]
                                      How you feel (default: morning before 15:00, else evening)
  raqib goals [date]                  List a day's goals
  raqib goal add "text" [--date D]    Add a goal (also: goal met|partly|missed|clear|rm <id>)
  raqib plan [date]                   The day's plan, block by block, against what happened
  raqib plan add 09:00-11:00 "what" [--category study] [--date tomorrow]
                                      Plan a block (also: plan rm <id>, plan copy <from> [--to D])
  raqib sleep [date]                  The night you woke from that day: logged or estimated
  raqib week [date] [--json]          The weekly review for the week (Monday to Sunday) holding that date
  raqib reminders                     List reminders
  raqib remind add "text" --every 1h [--from 09:00 --until 22:00] [--days mon,tue]
  raqib remind add "text" --at 09:00,21:00 [--days ...]
                                      Add a reminder (also: remind on|off|rm <id>)
${PROJECTS_USAGE}
${HEALTH_USAGE}
${EXERCISE_USAGE}
${PLAN_USAGE}
  (date: YYYY-MM-DD, today, yesterday, or tomorrow; default today)`;

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const span = (a: number, b: number) => `${clock(a)}-${clock(b)}`;
function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return ms > 0 ? '<1m' : '0m';
  const h = Math.floor(minutes / 60);
  return h === 0 ? `${minutes}m` : `${h}h${String(minutes % 60).padStart(2, '0')}m`;
}

function clockTime(text: string): string {
  const match = /^(\d{1,2})[:.]?(\d{2})$/.exec(text.trim());
  const value = match ? `${match[1]?.padStart(2, '0')}:${match[2]}` : text;
  try {
    minutesOf(value);
  } catch {
    throw new UsageError(`"${text}" is not a time like 07:15`);
  }
  return value;
}

function atTime(day: string, time: string): number {
  const minutes = minutesOf(time);
  const d = new Date(parseLocalDate(day) as number);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

/** "07:15-09:00" on that day. An end before the start runs into the next day. */
export function parseSpan(text: string, day: string): { start: number; end: number } {
  const [a, b] = text.split(/[-–]/);
  if (a === undefined || b === undefined) throw new UsageError(`"${text}" is not a time span like 07:15-09:00`);
  const start = atTime(day, clockTime(a));
  let end = atTime(day, clockTime(b));
  if (end <= start) {
    const next = new Date(end);
    next.setDate(next.getDate() + 1);
    end = next.getTime();
  }
  return { start, end };
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseDays(text: string | undefined): number[] {
  if (text === undefined || text === 'every' || text === 'all') return [];
  if (text === 'weekdays') return [1, 2, 3, 4, 5];
  if (text === 'weekends') return [0, 6];
  return text.split(',').map((d) => {
    const index = DAY_NAMES.indexOf(d.trim().toLowerCase().slice(0, 3));
    if (index < 0) throw new UsageError(`"${d}" is not a weekday. Use mon,tue,... or weekdays.`);
    return index;
  });
}

function parseEvery(text: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m(?:in)?)?$/i.exec(text.trim());
  const minutes = match && text.trim() !== '' ? Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) : NaN;
  if (!Number.isInteger(minutes) || minutes <= 0) throw new UsageError(`"${text}" is not a period like 1h, 30m, or 1h30m`);
  return minutes;
}

export function describeSchedule(s: ReminderSchedule): string {
  const days = s.days.length === 0 ? 'every day' : s.days.join() === '1,2,3,4,5' ? 'weekdays' : s.days.map((d) => DAY_NAMES[d]).join(',');
  if (s.type === 'at') return `at ${s.times.join(', ')}, ${days}`;
  const every = s.minutes % 60 === 0 ? `${s.minutes / 60}h` : `${s.minutes}m`;
  return `every ${every}${s.from === '00:00' && s.until === '24:00' ? '' : ` from ${s.from} to ${s.until}`}, ${days}`;
}

const MOOD_WORDS = ['awful', 'low', 'okay', 'good', 'great'];
const ENERGY_WORDS = ['drained', 'tired', 'okay', 'good', 'full of energy'];
const goalLine = (g: Goal) =>
  `  #${g.id}  [${g.result === null ? ' ' : g.result === 'met' ? 'x' : g.result === 'partly' ? '~' : '-'}] ${g.text}${g.result ? `  (${g.result})` : ''}`;
const checkinLine = (c: Checkin) =>
  `  ${c.part.padEnd(8)} mood ${c.mood ?? '-'}/5${c.mood ? ` (${MOOD_WORDS[c.mood - 1]})` : ''} · energy ${c.energy ?? '-'}/5${c.energy ? ` (${ENERGY_WORDS[c.energy - 1]})` : ''}${c.note ? `  "${c.note}"` : ''}`;
function sleepLines(sleep: Sleep): string[] {
  const out: string[] = [];
  if (sleep.night) {
    out.push(`  ${span(sleep.night.start, sleep.night.end)}  ${duration(sleep.night.ms).padStart(6)}  ${sleep.night.source === 'logged' ? 'logged' : 'estimated from the PC (not logged)'}`);
  } else out.push('  Not known: nothing logged as sleep, and no clear night-time stretch without PC use.');
  for (const n of sleep.naps) out.push(`  ${span(n.start, n.end)}  ${duration(n.end - n.start).padStart(6)}  nap`);
  if (sleep.napMs) out.push(`  Total ${duration(sleep.totalMs)}`);
  return out;
}

const blockLine = (b: PlanBlock) => `  #${b.id}  ${span(b.start, b.end)}  ${duration(b.end - b.start).padStart(6)}  ${b.label}${b.category ? ` (${b.category})` : ''}`;
const STATUS_WORDS: Record<BlockOutcome['status'], string> = { kept: 'kept', partly: 'partly', missed: 'missed', now: 'now', upcoming: 'to come' };
function outcomeLine(o: BlockOutcome): string {
  const head = `${blockLine(o.block)}  [${STATUS_WORDS[o.status]}${o.elapsedMs ? `, ${duration(o.keptMs)} as planned` : ''}]`;
  const did = o.actual.slice(0, 3).map((a) => `${a.name} ${duration(a.ms)}`);
  if (o.unknownMs >= 60_000) did.push(`unknown ${duration(o.unknownMs)}`);
  return did.length ? `${head}\n        did: ${did.join(', ')}` : head;
}

const entryLine = (e: Entry) => `  #${e.id}  ${span(e.start, e.end)}  ${duration(e.end - e.start).padStart(6)}  ${e.label}${e.category ? ` (${e.category})` : ''}`;
const taskLine = (t: Task) => `  #${t.id}  [${t.doneAt === null ? ' ' : 'x'}] ${t.text}${t.doneAt !== null ? `  (done ${clock(t.doneAt)})` : ''}`;
const reminderLine = (r: Reminder, now: number) => {
  const next = r.enabled ? nextSlot(r.schedule, Math.max(now, r.lastFiredAt ?? 0)) : null;
  return `  #${r.id}  ${r.enabled ? 'on ' : 'off'}  ${r.text}  (${describeSchedule(r.schedule)}${next ? `; next ${dayKey(next) === dayKey(now) ? clock(next) : `${new Date(next).toLocaleDateString('en-GB', { weekday: 'short' })} ${clock(next)}`}` : ''})`;
};

async function day(args: string[]): Promise<number> {
  const { flags, rest } = options(args, [], ['json']);
  const key = parseDay(rest[0]);
  if (!existsSync(dbPath())) throw new UsageError('No data yet: start رقيب first.');
  const journal = openJournal();
  try {
    const view = await buildDay({ journal, dbPath: dbPath(), config: loadConfig() }, key, Date.now());
    if (flags.has('json')) {
      console.log(JSON.stringify(view, null, 2));
      return 0;
    }
    const r = view.report;
    const out: string[] = [];
    out.push(`رقيب: ${new Date(view.from).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`);
    out.push(`Active on the PC ${duration(view.activeMs)} (idle ${duration(r.idleMs)}) · focused ${duration(view.focusMs)} · distractions ${duration(view.distractionMs)}${view.logged.ms ? ` (${duration(view.logged.ms)} of it logged off the PC)` : ''} · switches ${r.switches}`);
    if (view.logged.phoneMs) out.push(`On the phone ${duration(view.logged.phoneMs)} (logged)${view.logged.phoneDistractionMs ? `, ${duration(view.logged.phoneDistractionMs)} of it social media or video` : ''}`);
    if (r.longestFocus) out.push(`Longest focus ${duration(r.longestFocus.ms)} (${span(r.longestFocus.start, r.longestFocus.end)})`);

    out.push('', 'Timeline (from the PC)');
    if (r.timeline.length === 0) out.push('  Nothing recorded.');
    for (const b of r.timeline) out.push(`  ${span(b.start, b.end)}  ${duration(b.end - b.start).padStart(6)}  ${b.category}${b.detail !== b.category ? ` / ${b.detail}` : ''}`);

    const m = r.multitasking;
    if (m.blocks.length) {
      out.push('', `Sound playing ${duration(m.listeningMs)} (${duration(m.whileActiveMs)} while doing something else)`);
      for (const b of m.blocks) out.push(`  ${span(b.start, b.end)}  ${duration(b.end - b.start).padStart(6)}  ${b.source}${b.title ? `: ${b.title}` : ''}`);
    }
    if (m.phone.ms) {
      out.push('', `On the phone ${duration(m.phone.ms)} (${duration(m.phone.whileActiveMs)} while active on the PC, ${duration(m.phone.whilePcIdleMs)} while the PC sat idle)`);
      for (const p of m.phone.pairs.slice(0, 5)) out.push(`  ${p.doing} + ${p.listening}  ${duration(p.ms)}`);
    }

    const o = r.otherScreens;
    if (o.stretches.length) {
      out.push('', `On your other screens (${o.screens})`);
      for (const st of o.stretches) out.push(`  ${span(st.start, st.end)}  ${duration(st.end - st.start).padStart(6)}  screen ${st.screen}  ${st.name}${st.title && st.title !== st.name ? `: ${st.title}` : ''}`);
    }

    const pc = view.planComparison;
    if (pc.blocks.length) {
      out.push('', `Plan (${pc.blocks.length} block${pc.blocks.length === 1 ? '' : 's'}${pc.share !== null ? `, ${Math.round(pc.share * 100)}% of planned time so far as planned` : ''})`);
      for (const o of pc.blocks) out.push(outcomeLine(o));
    }

    out.push('', `Gaps to log (${view.gaps.length}, ${duration(view.gapMs)})`);
    if (view.gaps.length === 0) out.push('  None: the whole day is accounted for.');
    for (const g of view.gaps) {
      const why = g.kind === 'idle' ? `PC on but untouched${g.onScreen ? `, ${g.onScreen} on screen` : ''}` : 'PC off, asleep, or locked';
      out.push(`  ${span(g.start, g.end)}  ${duration(g.ms).padStart(6)}  ${why}`);
    }

    out.push('', 'You logged');
    if (r.entries.length === 0) out.push('  Nothing yet.');
    for (const e of r.entries) out.push(entryLine(e));

    out.push('', 'Sleep (the night before this day)', ...sleepLines(view.sleep));

    out.push('', 'Mood and energy');
    if (view.checkins.length === 0) out.push('  No check-ins.');
    for (const c of view.checkins) out.push(checkinLine(c));

    out.push('', `Goals${view.goals.length ? ` (${view.goals.filter((g) => g.result === 'met').length}/${view.goals.length} met)` : ''}`);
    if (view.goals.length === 0) out.push('  None.');
    for (const g of view.goals) out.push(goalLine(g));

    out.push('', `Tasks${view.tasks.length ? ` (${view.tasks.filter((t) => t.doneAt !== null).length}/${view.tasks.length} done)` : ''}`);
    if (view.tasks.length === 0) out.push('  None.');
    for (const t of view.tasks) out.push(taskLine(t));
    console.log(out.join('\n'));
    return 0;
  } finally {
    journal.close();
  }
}

function log(args: string[]): number {
  const { values, rest } = options(args, ['category', 'date']);
  const [when, ...words] = rest;
  const label = words.join(' ').trim();
  if (!when || !label) throw new UsageError('Usage: raqib log 07:15-09:00 "what you did" [--category meal] [--date YYYY-MM-DD]');
  if (label.length > 200) throw new UsageError('Keep it to 200 characters');
  const key = parseDay(values['date']);
  const { start, end } = parseSpan(when, key);
  if (start > Date.now()) throw new UsageError('That is in the future.');
  const journal = openJournal();
  try {
    const entry = journal.addEntry({ start, end, label, category: values['category']?.trim().toLowerCase() || null });
    const overlapping = journal.entriesBetween(start, end).filter((e) => e.id !== entry.id);
    console.log(`Logged:\n${entryLine(entry)}`);
    if (overlapping.length) console.log(`Note: it overlaps what you already logged:\n${overlapping.map(entryLine).join('\n')}`);
    return 0;
  } finally {
    journal.close();
  }
}

function unlog(args: string[]): number {
  const journal = openJournal();
  try {
    const ok = journal.deleteEntry(id(args[0]));
    console.log(ok ? `Removed entry #${args[0]}.` : `There is no entry #${args[0]}.`);
    return ok ? 0 : 1;
  } finally {
    journal.close();
  }
}

function tasks(args: string[]): number {
  const key = parseDay(args[0]);
  const journal = openJournal();
  try {
    const list = journal.tasks(key);
    console.log(`Tasks for ${key}${list.length ? ` (${list.filter((t) => t.doneAt !== null).length}/${list.length} done)` : ''}`);
    console.log(list.length ? list.map(taskLine).join('\n') : '  None.');
    return 0;
  } finally {
    journal.close();
  }
}

function task(args: string[]): number {
  const [action, ...rest] = args;
  const journal = openJournal();
  try {
    if (action === 'add') {
      const { values, rest: words } = options(rest, ['date']);
      const text = words.join(' ').trim();
      if (!text) throw new UsageError('Usage: raqib task add "text" [--date YYYY-MM-DD]');
      console.log(`Added:\n${taskLine(journal.addTask(parseDay(values['date']), text))}`);
      return 0;
    }
    if (action === 'done' || action === 'undo') {
      const updated = journal.updateTask(id(rest[0]), { done: action === 'done' });
      if (!updated) throw new UsageError(`There is no task #${rest[0]}.`);
      console.log(taskLine(updated));
      return 0;
    }
    if (action === 'rm') {
      const ok = journal.deleteTask(id(rest[0]));
      console.log(ok ? `Removed task #${rest[0]}.` : `There is no task #${rest[0]}.`);
      return ok ? 0 : 1;
    }
    throw new UsageError('Usage: raqib task add "text" | task done <id> | task undo <id> | task rm <id>');
  } finally {
    journal.close();
  }
}

function reminders(): number {
  const journal = openJournal();
  try {
    const list = journal.reminders();
    console.log(list.length ? list.map((r) => reminderLine(r, Date.now())).join('\n') : 'No reminders yet.');
    return 0;
  } finally {
    journal.close();
  }
}

function remind(args: string[]): number {
  const [action, ...rest] = args;
  const journal = openJournal();
  try {
    if (action === 'add') {
      const { values, rest: words } = options(rest, ['every', 'at', 'from', 'until', 'days']);
      const text = words.join(' ').trim();
      if (!text || (values['every'] === undefined) === (values['at'] === undefined)) {
        throw new UsageError('Usage: raqib remind add "text" --every 1h [--from 09:00 --until 22:00] | --at 09:00,21:00 [--days mon,tue]');
      }
      const days = parseDays(values['days']);
      let schedule: ReminderSchedule;
      try {
        schedule =
          values['every'] !== undefined
            ? parseSchedule({ type: 'every', minutes: parseEvery(values['every']), from: values['from'] ? clockTime(values['from']) : '00:00', until: values['until'] ? (values['until'] === '24:00' ? '24:00' : clockTime(values['until'])) : '24:00', days })
            : parseSchedule({ type: 'at', times: (values['at'] as string).split(',').map(clockTime), days });
      } catch (error) {
        if (error instanceof UsageError) throw error;
        throw new UsageError((error as Error).message);
      }
      console.log(`Added:\n${reminderLine(journal.addReminder(text, schedule), Date.now())}`);
      return 0;
    }
    if (action === 'on' || action === 'off') {
      const updated = journal.updateReminder(id(rest[0]), { enabled: action === 'on' });
      if (!updated) throw new UsageError(`There is no reminder #${rest[0]}.`);
      console.log(reminderLine(updated, Date.now()));
      return 0;
    }
    if (action === 'rm') {
      const ok = journal.deleteReminder(id(rest[0]));
      console.log(ok ? `Removed reminder #${rest[0]}.` : `There is no reminder #${rest[0]}.`);
      return ok ? 0 : 1;
    }
    throw new UsageError('Usage: raqib remind add ... | remind on <id> | remind off <id> | remind rm <id>');
  } finally {
    journal.close();
  }
}

function rating(text: string | undefined, name: string): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new UsageError(`--${name} must be a whole number from 1 (low) to 5 (great)`);
  return n;
}

function checkin(args: string[]): number {
  const { values, rest } = options(args, ['mood', 'energy', 'note', 'date']);
  const part = (rest[0] ?? (new Date().getHours() < 15 ? 'morning' : 'evening')) as CheckinPart;
  if (part !== 'morning' && part !== 'evening') throw new UsageError('Usage: raqib checkin [morning|evening] --mood 1-5 --energy 1-5 [--note "..."] [--date D]');
  const mood = rating(values['mood'], 'mood');
  const energy = rating(values['energy'], 'energy');
  const note = values['note']?.trim();
  if (mood === undefined && energy === undefined && note === undefined) throw new UsageError('Give at least one of --mood, --energy, or --note');
  if (note !== undefined && note.length > 1000) throw new UsageError('Keep the note to 1000 characters');
  const journal = openJournal();
  try {
    const change: { mood?: number; energy?: number; note?: string | null } = {};
    if (mood !== undefined) change.mood = mood;
    if (energy !== undefined) change.energy = energy;
    if (note !== undefined) change.note = note || null;
    console.log(`Saved:\n${checkinLine(journal.setCheckin(parseDay(values['date']), part, change))}`);
    return 0;
  } finally {
    journal.close();
  }
}

function goals(args: string[]): number {
  const key = parseDay(args[0]);
  const journal = openJournal();
  try {
    const list = journal.goals(key);
    console.log(`Goals for ${key}${list.length ? ` (${list.filter((g) => g.result === 'met').length}/${list.length} met)` : ''}`);
    console.log(list.length ? list.map(goalLine).join('\n') : '  None.');
    return 0;
  } finally {
    journal.close();
  }
}

function goal(args: string[]): number {
  const [action, ...rest] = args;
  const journal = openJournal();
  try {
    if (action === 'add') {
      const { values, rest: words } = options(rest, ['date']);
      const text = words.join(' ').trim();
      if (!text) throw new UsageError('Usage: raqib goal add "text" [--date YYYY-MM-DD]');
      if (text.length > 200) throw new UsageError('Keep it to 200 characters');
      console.log(`Added:\n${goalLine(journal.addGoal(parseDay(values['date']), text))}`);
      return 0;
    }
    if (action === 'met' || action === 'partly' || action === 'missed' || action === 'clear') {
      const updated = journal.updateGoal(id(rest[0]), { result: action === 'clear' ? null : (action as GoalResult) });
      if (!updated) throw new UsageError(`There is no goal #${rest[0]}.`);
      console.log(goalLine(updated));
      return 0;
    }
    if (action === 'rm') {
      const ok = journal.deleteGoal(id(rest[0]));
      console.log(ok ? `Removed goal #${rest[0]}.` : `There is no goal #${rest[0]}.`);
      return ok ? 0 : 1;
    }
    throw new UsageError('Usage: raqib goal add "text" | goal met|partly|missed|clear <id> | goal rm <id>');
  } finally {
    journal.close();
  }
}

async function plan(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  const journal = openJournal();
  try {
    if (action === 'add') {
      const { values, rest: words } = options(rest, ['category', 'date']);
      const [when, ...what] = words;
      const label = what.join(' ').trim();
      if (!when || !label) throw new UsageError('Usage: raqib plan add 09:00-11:00 "what you plan" [--category study] [--date tomorrow]');
      if (label.length > 200) throw new UsageError('Keep it to 200 characters');
      const key = parseDay(values['date']);
      const { start, end } = parseSpan(when, key);
      const block = journal.addPlanBlock({ day: key, start, end, label, category: values['category']?.trim().toLowerCase() || null });
      const overlapping = journal.planBlocks(key).filter((b) => b.id !== block.id && b.start < end && b.end > start);
      console.log(`Planned for ${key}:\n${blockLine(block)}`);
      if (overlapping.length) console.log(`Note: it overlaps:\n${overlapping.map(blockLine).join('\n')}`);
      return 0;
    }
    if (action === 'rm') {
      const ok = journal.deletePlanBlock(id(rest[0]));
      console.log(ok ? `Removed block #${rest[0]}.` : `There is no block #${rest[0]}.`);
      return ok ? 0 : 1;
    }
    if (action === 'copy') {
      const { values, rest: days } = options(rest, ['to']);
      const from = parseDay(days[0] ?? 'yesterday');
      const to = parseDay(values['to']);
      const shift = Math.round(((parseLocalDate(to) as number) - (parseLocalDate(from) as number)) / 86_400_000);
      if (shift === 0) throw new UsageError('Copy a plan to a different day');
      const added = journal.copyPlan(from, to, (ms) => shiftByDays(ms, shift));
      console.log(`Copied ${added.length} block${added.length === 1 ? '' : 's'} from ${from} to ${to}${added.length ? `:\n${added.map(blockLine).join('\n')}` : '.'}`);
      return 0;
    }
    // raqib plan [date]
    const key = parseDay(action);
    if (!existsSync(dbPath())) throw new UsageError('No data yet: start رقيب first.');
    const view = await buildDay({ journal, dbPath: dbPath(), config: loadConfig() }, key, Date.now(), { claude: false });
    const pc = view.planComparison;
    if (pc.blocks.length === 0) {
      console.log(`No plan for ${key} yet. Add one: raqib plan add 09:00-11:00 "what" --date ${key}`);
      return 0;
    }
    console.log(`Plan for ${key}: ${pc.blocks.length} block${pc.blocks.length === 1 ? '' : 's'}, ${duration(pc.plannedMs)} planned`);
    if (pc.share !== null) console.log(`So far ${duration(pc.keptMs)} of ${duration(pc.elapsedMs)} went as planned (${Math.round(pc.share * 100)}%) · kept ${pc.kept}, partly ${pc.partly}, missed ${pc.missed}`);
    console.log(pc.blocks.map(outcomeLine).join('\n'));
    return 0;
  } finally {
    journal.close();
  }
}

async function sleep(args: string[]): Promise<number> {
  const key = parseDay(args[0]);
  if (!existsSync(dbPath())) throw new UsageError('No data yet: start رقيب first.');
  const journal = openJournal();
  try {
    const view = await buildDay({ journal, dbPath: dbPath(), config: loadConfig() }, key, Date.now(), { claude: false });
    console.log(`Sleep, the night before ${key}`);
    console.log(sleepLines(view.sleep).join('\n'));
    const night = view.sleep.night;
    if (night?.source === 'estimated') {
      console.log(`To confirm it: raqib log ${span(night.start, night.end)} "Sleep" --category sleep --date ${dayKey(night.start)}`);
    }
    return 0;
  } finally {
    journal.close();
  }
}

async function week(args: string[]): Promise<number> {
  const { flags, rest } = options(args, [], ['json']);
  const key = parseDay(rest[0]);
  if (!existsSync(dbPath())) throw new UsageError('No data yet: start رقيب first.');
  const journal = openJournal();
  try {
    const view = await buildWeek({ journal, dbPath: dbPath(), config: loadConfig() }, key, Date.now());
    if (flags.has('json')) {
      console.log(JSON.stringify(view, null, 2));
      return 0;
    }
    const t = view.totals;
    const avg = (a: { value: number } | null) => (a ? duration(a.value) : '-');
    const out: string[] = [`رقيب: the week of ${view.start} to ${view.end}`];
    out.push(`Focused ${avg(t.focusMs)} a day (last week ${avg(view.previous.focusMs)}) · on the PC ${avg(t.activeMs)} a day · distractions ${avg(t.distractionMs)} a day${t.phoneMs ? ` · phone ${avg(t.phoneMs)} a day (${t.phoneMs.days} day${t.phoneMs.days === 1 ? '' : 's'} logged)` : ''}`);
    out.push(
      `Sleep ${avg(t.sleepMs)} a night (last week ${avg(view.previous.sleepMs)})${t.bedtime && t.wake ? ` · bedtime ${clockOf(t.bedtime.minutes)} ±${t.bedtime.spread}m · waking ${clockOf(t.wake.minutes)} ±${t.wake.spread}m` : ''}`,
    );
    out.push(
      `Mood ${t.mood ? t.mood.value.toFixed(1) : '-'}/5 · energy ${t.energy ? t.energy.value.toFixed(1) : '-'}/5 · goals met ${t.goalsMet}/${t.goalsTotal} · tasks done ${t.tasksDone}/${t.tasksTotal} · unlogged ${duration(t.gapMs)}`,
    );
    out.push('', 'Day        Sleep    Mood  Energy  Focused  Distr.   Phone    Goals  Tasks');
    for (const d of view.days) {
      const name = new Date(parseLocalDate(d.date) as number).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit' });
      const sleepText = d.sleep.night ? `${duration(d.sleep.totalMs)}${d.sleep.night.source === 'estimated' ? '~' : ''}` : '-';
      out.push(
        `${name.padEnd(10)} ${sleepText.padEnd(8)} ${(d.mood ? d.mood.toFixed(1) : '-').padEnd(5)} ${(d.energy ? d.energy.toFixed(1) : '-').padEnd(7)} ${duration(d.focusMs).padEnd(8)} ${duration(d.distractionMs).padEnd(8)} ${(d.phoneMs ? duration(d.phoneMs) : '-').padEnd(8)} ${(d.goalsTotal ? `${d.goalsMet}/${d.goalsTotal}` : '-').padEnd(6)} ${d.tasksTotal ? `${d.tasksDone}/${d.tasksTotal}` : '-'}`,
      );
    }
    out.push('(~ sleep estimated from the PC)');
    if (view.observations.length) out.push('', 'What stood out', ...view.observations.map((o) => `  - ${o}`));
    if (view.distractions.length) out.push('', 'Biggest distractions', ...view.distractions.slice(0, 5).map((d) => `  ${duration(d.ms).padStart(6)}  ${d.name}`));
    if (view.projects.length) {
      out.push('', 'Projects this week');
      for (const p of view.projects) {
        const moved = p.moved.map((m) => (m.checkbox ? `✓ ${m.title}` : `${m.amount > 0 ? '+' : ''}${m.amount}${m.unit ? ` ${m.unit}` : ''} ${m.title}`)).join(', ');
        const bits = [`${p.daysWorked} day${p.daysWorked === 1 ? '' : 's'} worked`];
        if (p.targetDays) bits.push(`targets met ${p.targetsMet}/${p.targetDays}`);
        if (p.daysSkipped) bits.push(`${p.daysSkipped} skipped`);
        out.push(`  ${p.name}${p.status === 'active' ? '' : ` (${p.status})`}  ${Math.round(p.fraction * 100)}% · ${bits.join(' · ')}`);
        out.push(`    ${moved || (p.status === 'active' ? 'Nothing moved this week.' : 'Nothing moved.')}`);
      }
    }
    if (view.review?.wentWell || view.review?.toChange) {
      out.push('', 'Your review');
      if (view.review.wentWell) out.push(`  Went well: ${view.review.wentWell}`);
      if (view.review.toChange) out.push(`  To change: ${view.review.toChange}`);
    }
    console.log(out.join('\n'));
    return 0;
  } finally {
    journal.close();
  }
}

const COMMANDS: Record<string, (args: string[]) => number | Promise<number>> = {
  day,
  log,
  unlog,
  tasks,
  task,
  checkin,
  goals,
  goal,
  sleep,
  plan,
  week,
  reminders,
  remind,
  ...PROJECT_COMMANDS,
  ...HEALTH_COMMANDS,
  ...EXERCISE_COMMANDS,
};

export function isJournalCommand(command: string | undefined): boolean {
  return command !== undefined && command in COMMANDS;
}

export async function runJournalCommand(command: string, args: string[]): Promise<number> {
  try {
    return await (COMMANDS[command] as (args: string[]) => number | Promise<number>)(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    return 1;
  }
}
