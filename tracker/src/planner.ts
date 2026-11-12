// When رقيب should speak up: reminders, the morning page, and the evening log.
// Pure functions of the clock and stored state, so every rule can be tested.
//
// Reminders work in "slots": the moments a reminder is meant to go off today.
// A reminder fires for the latest slot that has passed since it last fired, so
// a PC that was asleep through three slots shows one reminder on waking, not
// three. Slots from yesterday are never made up.

/** "HH:MM", 00:00 to 24:00. */
export type ClockTime = string;

export type ReminderSchedule =
  /** Every `minutes`, counted from `from`, until `until`. */
  | { type: 'every'; minutes: number; from: ClockTime; until: ClockTime; days: number[] }
  /** At each listed time. */
  | { type: 'at'; times: ClockTime[]; days: number[] };

export interface PlannerSettings {
  morning: { enabled: boolean; from: ClockTime; until: ClockTime };
  evening: { enabled: boolean; at: ClockTime };
  /** Stretches without PC activity shorter than this aren't asked about. */
  gaps: { minMinutes: number };
  audio: { enabled: boolean };
  /** Record what's on top of the screens that don't have the focus. */
  screens: { enabled: boolean };
  /** When you come back after a gap: open a small window asking about it, show a notification, or stay quiet. */
  back: { mode: BackMode };
  /** A daily nudge about projects not answered yet, and when an untouched one is flagged. */
  projects: { reminder: { enabled: boolean; at: ClockTime }; neglectAfterDays: number };
  /** Your job's hours, highlighted on the day's timeline. `days`: weekdays, 0 (Sunday) to 6; empty means every day. */
  job: { enabled: boolean; from: ClockTime; until: ClockTime; days: number[] };
}

export type BackMode = 'window' | 'toast' | 'off';

export const DEFAULT_SETTINGS: PlannerSettings = {
  morning: { enabled: true, from: '08:00', until: '12:00' },
  evening: { enabled: true, at: '22:00' },
  gaps: { minMinutes: 15 },
  audio: { enabled: true },
  screens: { enabled: true },
  back: { mode: 'window' },
  // Off by default: the evening log already asks about projects. This is for days you skip it.
  projects: { reminder: { enabled: false, at: '21:00' }, neglectAfterDays: 3 },
  job: { enabled: true, from: '07:00', until: '16:00', days: [0, 1, 2, 3, 4] },
};

/** The job's hours on the day starting at `dayStart`, or null when it's off or not a job day. */
export function jobWindow(settings: PlannerSettings, dayStart: number): { start: number; end: number } | null {
  const job = settings.job;
  if (!job.enabled) return null;
  if (job.days.length > 0 && !job.days.includes(new Date(dayStart).getDay())) return null;
  return { start: atClock(dayStart, job.from), end: atClock(dayStart, job.until) };
}

// ------------------------------------------------------------------ coming back

/**
 * With the PC left on and unlocked, you may have been reading or watching, not
 * away, so a return counts only after this long. Locking it, or it sleeping or
 * being off, counts from the shortest gap setting.
 */
export const IDLE_RETURN_MS = 45 * 60_000;

export interface ReturnState {
  /** Your last input as of the last unlocked tick. */
  lastSeenInputAt: number | null;
  /** The screen was locked, or the PC asleep or off, since then. */
  wentAway: boolean;
}

export interface ReturnTick {
  lastInputAt: number;
  locked: boolean;
  /** The ticks stopped for a while: asleep, off, or the tracker wasn't running. */
  tickGap: boolean;
}

/** Notices you coming back to the PC after a gap of at least `minGapMs`. Returns the time you were away. */
export function detectReturn(state: ReturnState, tick: ReturnTick, minGapMs: number): { state: ReturnState; away: { start: number; end: number } | null } {
  const wentAway = state.wentAway || tick.locked || tick.tickGap;
  if (tick.locked) return { state: { ...state, wentAway }, away: null };
  if (state.lastSeenInputAt === null || tick.lastInputAt <= state.lastSeenInputAt) {
    return { state: { lastSeenInputAt: Math.max(state.lastSeenInputAt ?? -Infinity, tick.lastInputAt), wentAway }, away: null };
  }
  const start = state.lastSeenInputAt;
  const end = tick.lastInputAt;
  const needed = wentAway ? minGapMs : Math.max(minGapMs, IDLE_RETURN_MS);
  return { state: { lastSeenInputAt: end, wentAway: false }, away: end - start >= needed ? { start, end } : null };
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

/** Minutes after midnight, or throws for anything that isn't HH:MM. */
export function minutesOf(time: ClockTime): number {
  if (!CLOCK.test(time)) throw new Error(`"${time}" is not a time like 08:30`);
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Local YYYY-MM-DD. */
export function dayKey(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA');
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** That clock time on the day of `ms`. Uses the calendar, so DST days are right. */
export function atClock(ms: number, time: ClockTime): number {
  const d = new Date(ms);
  const minutes = minutesOf(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60).getTime();
}

function days(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error('days must be a list of weekdays, 0 (Sunday) to 6 (Saturday)');
  }
  return [...new Set(value as number[])].sort();
}

/** Validates a schedule from the UI or the database. Throws with a readable message. */
export function parseSchedule(raw: unknown): ReminderSchedule {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (value['type'] === 'every') {
    const minutes = value['minutes'];
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 7 * 24 * 60) {
      throw new Error('Repeat every: give a whole number of minutes, at least 1');
    }
    const from = typeof value['from'] === 'string' ? value['from'] : '00:00';
    const until = typeof value['until'] === 'string' ? value['until'] : '24:00';
    if (minutesOf(from) >= minutesOf(until)) throw new Error('The start time must be before the end time');
    return { type: 'every', minutes, from, until, days: days(value['days']) };
  }
  if (value['type'] === 'at') {
    const times = value['times'];
    if (!Array.isArray(times) || times.length === 0 || times.some((t) => typeof t !== 'string')) {
      throw new Error('Give at least one time');
    }
    for (const t of times as string[]) {
      if (minutesOf(t) >= 24 * 60) throw new Error('24:00 is not a time of day; use 00:00');
    }
    return { type: 'at', times: [...new Set(times as string[])].sort(), days: days(value['days']) };
  }
  throw new Error('A schedule is either "every" or "at"');
}

/** Today's slots up to and including `now`, oldest first. */
export function slotsUntil(schedule: ReminderSchedule, now: number): number[] {
  if (schedule.days.length > 0 && !schedule.days.includes(new Date(now).getDay())) return [];
  if (schedule.type === 'at') return schedule.times.map((t) => atClock(now, t)).filter((slot) => slot <= now);

  const slots: number[] = [];
  const from = minutesOf(schedule.from);
  const until = minutesOf(schedule.until);
  const day = new Date(now);
  for (let m = from; m <= until; m += schedule.minutes) {
    // Built from the calendar each time, so a DST change doesn't shift later slots.
    const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m).getTime();
    if (slot > now) break;
    slots.push(slot);
  }
  return slots;
}

/** The slot to fire for now, or null if nothing is due. */
export function dueSlot(reminder: { enabled: boolean; schedule: ReminderSchedule; lastFiredAt: number | null; createdAt: number }, now: number): number | null {
  if (!reminder.enabled) return null;
  const since = reminder.lastFiredAt ?? reminder.createdAt;
  const latest = slotsUntil(reminder.schedule, now).at(-1);
  return latest !== undefined && latest > since ? latest : null;
}

/** When the reminder goes off next, for the UI. Looks ahead up to a week. */
export function nextSlot(schedule: ReminderSchedule, after: number): number | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(after);
    const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, 23, 59, 59, 999).getTime();
    const next = slotsUntil(schedule, endOfDay).find((slot) => slot > after);
    if (next !== undefined) return next;
  }
  return null;
}

export interface PlannerState {
  /** Day keys of the last morning page and evening log shown. */
  morningShown: string | null;
  eveningShown: string | null;
  /** Day key of the last project reminder. */
  projectsReminded: string | null;
}

/**
 * The morning page opens once a day, the first time you're at the PC between
 * `from` and `until`. Someone who opens it at 10:30 still gets their summary.
 */
export function morningDue(settings: PlannerSettings, state: PlannerState, now: number, activeNow: boolean): boolean {
  if (!settings.morning.enabled || !activeNow || state.morningShown === dayKey(now)) return false;
  return now >= atClock(now, settings.morning.from) && now < atClock(now, settings.morning.until);
}

/** The evening log goes out once a day, at the set time or the first moment after it the PC is in use. */
export function eveningDue(settings: PlannerSettings, state: PlannerState, now: number, activeNow: boolean): boolean {
  if (!settings.evening.enabled || !activeNow || state.eveningShown === dayKey(now)) return false;
  return now >= atClock(now, settings.evening.at);
}

/**
 * The project reminder goes out once a day at its time, or the first moment after it the PC
 * is in use, unless the evening log has already gone out that day (it asks the same thing).
 * Whether any project still needs an answer is up to the caller.
 */
export function projectReminderDue(settings: PlannerSettings, state: PlannerState, now: number, activeNow: boolean): boolean {
  const today = dayKey(now);
  if (!settings.projects.reminder.enabled || !activeNow || state.projectsReminded === today || state.eveningShown === today) return false;
  return now >= atClock(now, settings.projects.reminder.at);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clock(value: unknown, fallback: ClockTime): ClockTime {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error('Times must look like 08:30');
  minutesOf(value);
  return value;
}

/** Validates settings from the UI; anything missing keeps its current value. */
export function mergeSettings(current: PlannerSettings, raw: unknown): PlannerSettings {
  const value = (raw ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const morning = value['morning'] ?? {};
  const evening = value['evening'] ?? {};
  const gaps = value['gaps'] ?? {};
  const audio = value['audio'] ?? {};
  const screens = value['screens'] ?? {};
  const back = value['back'] ?? {};
  const projects = value['projects'] ?? {};
  const projectReminder = (projects['reminder'] ?? {}) as Record<string, unknown>;
  const job = value['job'] ?? {};
  const mode = back['mode'] ?? current.back.mode;
  if (mode !== 'window' && mode !== 'toast' && mode !== 'off') throw new Error('When you come back: window, toast, or off');
  const merged: PlannerSettings = {
    morning: {
      enabled: bool(morning['enabled'], current.morning.enabled),
      from: clock(morning['from'], current.morning.from),
      until: clock(morning['until'], current.morning.until),
    },
    evening: { enabled: bool(evening['enabled'], current.evening.enabled), at: clock(evening['at'], current.evening.at) },
    gaps: { minMinutes: current.gaps.minMinutes },
    audio: { enabled: bool(audio['enabled'], current.audio.enabled) },
    screens: { enabled: bool(screens['enabled'], current.screens.enabled) },
    back: { mode },
    projects: {
      reminder: { enabled: bool(projectReminder['enabled'], current.projects.reminder.enabled), at: clock(projectReminder['at'], current.projects.reminder.at) },
      neglectAfterDays: current.projects.neglectAfterDays,
    },
    job: {
      enabled: bool(job['enabled'], current.job.enabled),
      from: clock(job['from'], current.job.from),
      until: clock(job['until'], current.job.until),
      days: job['days'] === undefined ? current.job.days : days(job['days']),
    },
  };
  if (minutesOf(merged.job.from) >= minutesOf(merged.job.until)) throw new Error('Job hours must start before they end');
  if (projects['neglectAfterDays'] !== undefined) {
    const n = projects['neglectAfterDays'];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 60) throw new Error('Flag a project after 1 to 60 days without work');
    merged.projects.neglectAfterDays = n;
  }
  if (minutesOf(merged.projects.reminder.at) >= 24 * 60) throw new Error('Pick a project reminder time before midnight');
  if (gaps['minMinutes'] !== undefined) {
    const m = gaps['minMinutes'];
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 240) throw new Error('Shortest gap must be 1 to 240 minutes');
    merged.gaps.minMinutes = m;
  }
  if (minutesOf(merged.morning.from) >= minutesOf(merged.morning.until)) {
    throw new Error('The morning window must start before it ends');
  }
  if (minutesOf(merged.evening.at) >= 24 * 60) throw new Error('Pick an evening time before midnight');
  return merged;
}
