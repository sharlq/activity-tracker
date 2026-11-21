// Reads workouts exported from another app (Caliber first) into رقيب's workouts and sets.
//
// The exact export format isn't known yet, so this reads a generic one: a CSV (or JSON)
// with a row per set. Headers are matched loosely through COLUMNS below, which is the
// one place to fit a real export to. Each workout gets an id from the file (or from its
// date, time, and name), so importing the same file again adds nothing twice.
import { parseLocalDate } from './dates.ts';
import { LB_TO_KG } from './exercise.ts';
import { copiedRuns, median } from './progression.ts';
import type { Journal, NewSet, NewWorkout, WorkoutKind } from './journal.ts';
import { WORKOUT_KINDS } from './journal.ts';
import { dayKey } from './planner.ts';
import { historyFor } from './machineSwap.ts';

/** Header names each field may go by, compared lowercased with only letters and digits. */
export const COLUMNS = {
  date: ['date', 'day', 'workoutdate', 'startdate', 'starttime', 'start', 'datetime', 'performedat', 'completedat', 'timestamp', 'time'],
  workout: ['workout', 'workoutname', 'workouttitle', 'session', 'sessionname', 'routine', 'routinename', 'title'],
  workoutId: ['workoutid', 'sessionid', 'workoutuuid', 'sessionuuid'],
  kind: ['type', 'workouttype', 'activity', 'activitytype'],
  exercise: ['exercise', 'exercisename', 'exercisetitle', 'movement', 'lift', 'name'],
  setNo: ['set', 'setnumber', 'setno', 'setorder', 'setindex', 'setnum'],
  reps: ['reps', 'rep', 'repetitions', 'repcount', 'numberofreps'],
  weight: ['weight', 'weightkg', 'weightkgs', 'weightlb', 'weightlbs', 'load', 'kg', 'lb', 'lbs'],
  unit: ['unit', 'units', 'weightunit', 'weightunits'],
  rpe: ['rpe'],
  seconds: ['seconds', 'setseconds', 'durationseconds', 'setduration', 'timeseconds'],
  distance: ['distance', 'distancem', 'distancemeters', 'distancekm', 'distancemi', 'distancemiles'],
  minutes: ['duration', 'durationmin', 'durationminutes', 'minutes', 'workoutduration', 'totalduration', 'elapsed', 'elapsedtime'],
  calories: ['calories', 'kcal', 'activecalories', 'energy', 'caloriesburned'],
  note: ['notes', 'note', 'comment', 'comments', 'workoutnotes'],
} as const;
type Field = keyof typeof COLUMNS;

/**
 * Exports whose layout is known exactly. A file whose headers include all of `headers`
 * is read with `columns` (field → header, compared like COLUMNS) instead of guessing.
 */
export interface Profile {
  name: string;
  source: string;
  headers: string[];
  columns: Partial<Record<Field, string>>;
  /** Weights in the file: Caliber writes pounds, even for kg users (85 kg → 187.393). */
  units?: 'kg' | 'lb';
  /**
   * The pounds were kg to begin with, so they go back by ÷ 2.20462 to the nearest 0.5 kg
   * (187.393 → 85, not 85.0 off by a rounding).
   */
  fromKg?: boolean;
  /** A workout's duration column counts seconds, not minutes. */
  minutesIn?: 'seconds';
  /** Put before each workout's "date:title" id, to keep two exports' ids apart. */
  idPrefix: string;
}

export const PROFILES: Profile[] = [
  {
    // strength_workouts.csv: "Date","Title","Exercise","Set #","Reps","Weight","Time", a row per set.
    // Time is seconds, for timed holds (a dead hang); it's empty otherwise.
    name: 'Caliber strength workouts',
    source: 'caliber',
    headers: ['date', 'title', 'exercise', 'set', 'reps', 'weight', 'time'],
    columns: { date: 'date', workout: 'title', exercise: 'exercise', setNo: 'set', reps: 'reps', weight: 'weight', seconds: 'time' },
    units: 'lb',
    fromKg: true,
    idPrefix: '',
  },
  {
    // cardio_activities.csv: "Date","Title","Distance","Time","Calories","Level","Speed", a row per
    // session (Soccer, HIIT, Boxing). Time is seconds. Distance's unit isn't known yet.
    name: 'Caliber cardio activities',
    source: 'caliber',
    headers: ['date', 'title', 'distance', 'time', 'calories', 'level', 'speed'],
    columns: { date: 'date', workout: 'title', kind: 'title', minutes: 'time', calories: 'calories' },
    minutesIn: 'seconds',
    idPrefix: 'cardio:',
  },
];

/** Longer than this, a workout is more likely a typo (108000 s for 1800) and isn't imported as is. */
export const MAX_WORKOUT_MINUTES = 6 * 60;

/** A set heavier than this many times the exercise's usual (median) weight is likely a typo. */
export const OUTLIER_TIMES = 3;
/** On an exercise usually done at bodyweight (median 0), added load from here up looks like your bodyweight typed in. */
export const BODYWEIGHT_SLIP_KG = 20;
export const KG_PER_LB = 2.20462;

/** Pounds that were kg, back to kg to the nearest 0.5. */
export const kgFromLb = (lb: number) => Math.round((lb / KG_PER_LB) * 2) / 2;

export interface ImportedWorkout {
  workout: NewWorkout;
  /** Exercises in the order first seen, each with its sets. */
  exercises: { name: string; sets: NewSet[] }[];
}

export interface ImportResult {
  workouts: ImportedWorkout[];
  /** Rows that couldn't be read, with why (the first few). */
  skipped: { row: number; why: string }[];
  skippedCount: number;
  /** Rows held back because they look wrong (a 30-hour workout), all of them. */
  flagged: { row: number; day: string; name: string; why: string }[];
  /** Sets imported but flagged as likely typos (left out of the plan until checked). */
  flaggedSets: { day: string; exercise: string; reps: number | null; weight: number; why: string }[];
  /** Exercises with sessions that look copied forward by the old app (3+ identical in a row). */
  copied: { exercise: string; sessions: number; days: string[] }[];
  /** The known layout the file was read as, or null for a guess from the headers. */
  profile: string | null;
  /** Which header each field was read from. */
  columns: Partial<Record<Field, string>>;
  /** How weights were read: from the header, a unit column, the option, or assumed. */
  unit: 'kg' | 'lb' | 'per row';
  warnings: string[];
}

const key = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

// ------------------------------------------------------------------ reading the file

/** A CSV into rows of cells: quotes, doubled quotes, CRLF, a BOM, and ; or tab delimiters. */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '');
  const firstLine = body.slice(0, body.search(/\r?\n|$/));
  const delimiter = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      (row = []), (cell = '');
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

/**
 * JSON into flat rows: a list of set rows, or workouts holding exercises holding sets
 * (any of `workouts`, `exercises`, `sets` nested), with the parents' fields carried down.
 */
export function flattenJson(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const nestKeys = ['workouts', 'sessions', 'data', 'exercises', 'movements', 'sets'];
  const walk = (value: unknown, inherited: Record<string, unknown>, level: string | null) => {
    if (Array.isArray(value)) return value.forEach((v) => walk(v, inherited, level));
    if (typeof value !== 'object' || value === null) return;
    const obj = value as Record<string, unknown>;
    const own: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (nestKeys.includes(k.toLowerCase()) || (typeof v === 'object' && v !== null)) continue;
      // "name" means the workout at the workout level and the exercise at the exercise level.
      const renamed = key(k) === 'name' && level ? `${level}name` : key(k) === 'id' && level ? `${level}id` : k;
      own[renamed] = v;
    }
    const merged = { ...inherited, ...own };
    const child = Object.entries(obj).find(([k, v]) => nestKeys.includes(k.toLowerCase()) && Array.isArray(v));
    if (!child) return void out.push(merged);
    const childKey = child[0].toLowerCase();
    walk(child[1], merged, childKey === 'sets' ? 'set' : childKey === 'exercises' || childKey === 'movements' ? 'exercise' : 'workout');
  };
  walk(data, {}, null);
  return out;
}

function rowsOf(text: string, file: string): { headers: string[]; rows: Record<string, string>[] } {
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (file.toLowerCase().endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const flat = flattenJson(JSON.parse(trimmed));
    const headers = [...new Set(flat.flatMap((r) => Object.keys(r)))];
    return { headers, rows: flat.map((r) => Object.fromEntries(headers.map((h) => [h, r[h] === undefined || r[h] === null ? '' : String(r[h])]))) };
  }
  const [head, ...body] = parseCsv(text);
  if (!head) return { headers: [], rows: [] };
  const headers = head.map((h) => h.trim());
  return { headers, rows: body.map((cells) => Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]))) };
}

/** Which header each field comes from: an exact alias first, then one containing it. */
export function matchColumns(headers: readonly string[]): Partial<Record<Field, string>> {
  const found: Partial<Record<Field, string>> = {};
  const used = new Set<string>();
  const fields = Object.keys(COLUMNS) as Field[];
  for (const loose of [false, true]) {
    for (const field of fields) {
      if (found[field]) continue;
      for (const alias of COLUMNS[field]) {
        const header = headers.find((h) => !used.has(h) && (loose ? alias.length >= 4 && key(h).includes(alias) : key(h) === alias));
        if (header) {
          found[field] = header;
          used.add(header);
          break;
        }
      }
    }
  }
  return found;
}

// ------------------------------------------------------------------ reading values

const numberOf = (text: string | undefined): number | null => {
  if (!text) return null;
  const n = Number(text.replace(/[^\d.,-]/g, '').replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(n) ? null : n;
};

/** "2026-11-14", "2026-11-14T18:30:00Z", "11/14/2026 6:30 PM", "14/11/2026", "Nov 14, 2026". */
export function readDate(text: string, order: 'mdy' | 'dmy' = 'mdy'): { day: string; start: number | null; ambiguous: boolean } | null {
  const t = text.trim();
  if (!t) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso && parseLocalDate(t) !== null) return { day: t, start: null, ambiguous: false };
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?)?$/i.exec(t);
  if (slash) {
    const [, a, b, y, hh, mm, ampm] = slash;
    let [month, date] = order === 'mdy' ? [Number(a), Number(b)] : [Number(b), Number(a)];
    const ambiguous = Number(a) <= 12 && Number(b) <= 12 && a !== b;
    if (month > 12) [month, date] = [date, month];
    const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    let hour = hh ? Number(hh) % 12 + (ampm?.toLowerCase() === 'pm' ? 12 : 0) : 0;
    if (hh && !ampm) hour = Number(hh);
    const d = new Date(year, month - 1, date, hour, Number(mm ?? 0));
    if (d.getMonth() !== month - 1) return null;
    return { day: dayKey(d.getTime()), start: hh ? d.getTime() : null, ambiguous };
  }
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) return null;
  const hasTime = /\d:\d{2}/.test(t);
  return { day: dayKey(ms), start: hasTime ? ms : null, ambiguous: false };
}

/** Minutes from "55", "55 min", "1:05:00", "65:30", or "3300 s". */
export function readMinutes(text: string | undefined, header = ''): number | null {
  if (!text?.trim()) return null;
  const t = text.trim().toLowerCase();
  const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (clock) return clock[3] !== undefined ? Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3]) / 60 : Number(clock[1]) + Number(clock[2]) / 60;
  const n = numberOf(t);
  if (n === null) return null;
  if (/\d\s*(s|sec|secs|seconds)$/.test(t) || /sec/.test(key(header))) return n / 60;
  if (/\d\s*(h|hr|hrs|hours)$/.test(t)) return n * 60;
  return n;
}

export function kindOf(text: string | undefined, hasSets: boolean): WorkoutKind {
  const t = (text ?? '').toLowerCase();
  const found =
    WORKOUT_KINDS.find((k) => t.includes(k)) ??
    (/(lift|weight|resist|gym)/.test(t) ? 'strength'
      : /(jog)/.test(t) ? 'run'
        : /(bike|cycl)/.test(t) ? 'cycle'
          : /(soccer|football|futsal|basket|tennis|padel|squash|volley|box|mma|martial|judo|karate)/.test(t) ? 'sport'
            : null);
  return found ?? (hasSets || !t ? 'strength' : 'other');
}

/** The known layout these headers match, with its columns as the file names them. */
export function profileFor(headers: readonly string[]): { profile: Profile; columns: Partial<Record<Field, string>> } | null {
  const keys = headers.map(key);
  const profile = PROFILES.find((p) => p.headers.every((h) => keys.includes(h)));
  if (!profile) return null;
  const columns: Partial<Record<Field, string>> = {};
  for (const [field, k] of Object.entries(profile.columns) as [Field, string][]) columns[field] = headers[keys.indexOf(k)] as string;
  return { profile, columns };
}

// ------------------------------------------------------------------ putting it together

export interface ImportOptions {
  file?: string;
  /** The app it came from; a known layout names its own. */
  source?: string;
  units?: 'kg' | 'lb';
  dateOrder?: 'mdy' | 'dmy';
}

export function importWorkouts(text: string, { file = '', source: sourceOption, units, dateOrder = 'mdy' }: ImportOptions = {}): ImportResult {
  const { headers, rows } = rowsOf(text, file);
  const known = profileFor(headers);
  const profile = known?.profile ?? null;
  const columns = known?.columns ?? matchColumns(headers);
  const source = sourceOption ?? profile?.source ?? 'caliber';
  const warnings: string[] = [];
  const skipped: { row: number; why: string }[] = [];
  const flagged: ImportResult['flagged'] = [];
  let skippedCount = 0;
  const skip = (row: number, why: string) => {
    skippedCount++;
    if (skipped.length < 5) skipped.push({ row, why });
  };
  if (!columns.date) warnings.push(`No date column found. Columns in the file: ${headers.join(', ') || 'none'}`);
  if (!columns.exercise && !columns.workout) warnings.push('No exercise or workout column found.');

  const weightHeader = columns.weight ? key(columns.weight) : '';
  const headerUnit = /lb/.test(weightHeader) ? 'lb' : /kg/.test(weightHeader) ? 'kg' : null;
  const unit: ImportResult['unit'] = units ?? headerUnit ?? profile?.units ?? (columns.unit ? 'per row' : 'kg');
  if (!units && !headerUnit && !profile?.units && !columns.unit && columns.weight) warnings.push('The file doesn\'t say whether weights are kg or lb: read as kg. Pass --units lb if they are pounds.');
  const minutesHint = profile?.minutesIn === 'seconds' ? 'seconds' : (columns.minutes ?? '');

  const groups = new Map<string, ImportedWorkout & { ambiguous: boolean; firstRow: number }>();
  const cell = (row: Record<string, string>, field: Field) => (columns[field] ? row[columns[field] as string] : undefined)?.trim() ?? '';
  let distanceIgnored = false;
  rows.forEach((row, index) => {
    const line = index + 2; // The header is line 1.
    const when = columns.date ? readDate(cell(row, 'date'), dateOrder) : null;
    if (!when) return skip(line, columns.date ? `can't read the date "${cell(row, 'date')}"` : 'no date');
    const name = (cell(row, 'workout') || cell(row, 'kind') || 'Workout').replace(/\s+/g, ' ').slice(0, 200);
    // The app's own id when the file has one; else the day, the start time if known, and the name.
    const externalId = cell(row, 'workoutId') || `${profile?.idPrefix ?? ''}${when.day}${when.start !== null ? `T${clockOf(when.start)}` : ''}:${name}`;
    let group = groups.get(externalId);
    if (!group) {
      group = {
        workout: {
          day: when.day,
          start: when.start,
          name,
          kind: columns.exercise && !columns.kind ? 'strength' : kindOf(cell(row, 'kind') || name, Boolean(columns.exercise)),
          minutes: readMinutes(cell(row, 'minutes'), minutesHint),
          calories: numberOf(cell(row, 'calories')),
          note: cell(row, 'note').slice(0, 2000) || null,
          source,
          externalId,
        },
        exercises: [],
        ambiguous: false,
        firstRow: line,
      };
      groups.set(externalId, group);
    }
    group.ambiguous ||= when.ambiguous;
    group.workout.minutes ??= readMinutes(cell(row, 'minutes'), minutesHint);
    group.workout.calories ??= numberOf(cell(row, 'calories'));

    const exercise = cell(row, 'exercise').replace(/\s+/g, ' ').slice(0, 200);
    if (!exercise) {
      if (numberOf(cell(row, 'distance'))) distanceIgnored = true;
      return; // A workout-only row (a run, a match) with no sets.
    }
    const reps = numberOf(cell(row, 'reps'));
    let weight = numberOf(cell(row, 'weight'));
    const rowUnit = unit === 'per row' ? (/lb/i.test(cell(row, 'unit')) ? 'lb' : 'kg') : unit;
    if (weight !== null && rowUnit === 'lb') weight = profile?.fromKg && !units ? kgFromLb(weight) : Math.round((weight * LB_TO_KG) * 10) / 10;
    let distance = numberOf(cell(row, 'distance'));
    const distanceHeader = columns.distance ? key(columns.distance) : '';
    if (distance !== null && /km$/.test(distanceHeader)) distance *= 1000;
    if (distance !== null && /mi(les)?$/.test(distanceHeader)) distance *= 1609.344;
    const secondsCell = cell(row, 'seconds');
    const seconds = secondsCell ? (readMinutes(secondsCell, 'seconds') ?? 0) * 60 : null;
    if (reps === null && !weight && seconds === null && distance === null) return skip(line, `no reps, weight, time, or distance for ${exercise}`);
    const set: NewSet = { reps: reps === null ? null : Math.round(reps), weight: weight === 0 ? null : weight, rpe: numberOf(cell(row, 'rpe')), seconds: seconds === null ? null : Math.round(seconds * 10) / 10, distance };
    let entry = group.exercises.find((e) => e.name.toLowerCase() === exercise.toLowerCase());
    if (!entry) group.exercises.push((entry = { name: exercise, sets: [] }));
    entry.sets.push(set);
  });

  const workouts: ImportedWorkout[] = [];
  for (const { ambiguous: _a, firstRow, ...w } of groups.values()) {
    const minutes = w.workout.minutes;
    if (minutes !== null && minutes > MAX_WORKOUT_MINUTES) {
      flagged.push({ row: firstRow, day: w.workout.day, name: w.workout.name, why: `${Math.round(minutes / 60)} hours long: a typo? Not imported; log it by hand with the right time.` });
      continue;
    }
    workouts.push(w);
  }
  if ([...groups.values()].some((w) => w.ambiguous)) {
    warnings.push(`Some dates could be read either way (like 03/04): read as ${dateOrder === 'mdy' ? 'month/day' : 'day/month'}. Pass --dates ${dateOrder === 'mdy' ? 'dmy' : 'mdy'} if that's wrong.`);
  }
  if (distanceIgnored) warnings.push('Some sessions have a distance, which isn\'t imported yet (its unit isn\'t known).');
  // The old app's stand-ins for a machine it didn't have go by the machine's name (machineSwap.ts).
  for (const w of workouts) {
    for (const e of w.exercises) {
      const to = historyFor(e.name);
      if (!to) continue;
      e.name = to.name;
      for (const s of e.sets) {
        if (to.flag) s.flag ??= to.flag;
        if (s.weight !== null) s.weight *= to.weightTimes;
      }
    }
  }
  const flaggedSets = flagOutliers(workouts);
  const copied = findCopied(workouts);
  if (copied.length) warnings.push(`${copied.reduce((n, c) => n + c.sessions, 0)} session(s) of ${copied.length} exercise(s) are the same as the session before, 3+ times in a row: maybe copied forward by the old app. They're imported, but don't count toward stall flags.`);
  return { workouts, skipped, skippedCount, flagged, flaggedSets, copied, profile: profile?.name ?? null, columns, unit, warnings };
}

/** Flags sets far heavier than the exercise's usual weight in the file. */
export function flagOutliers(workouts: readonly ImportedWorkout[]): ImportResult['flaggedSets'] {
  const weights = new Map<string, number[]>();
  for (const w of workouts) for (const e of w.exercises) for (const s of e.sets) if (s.reps !== null || s.weight !== null) weights.set(e.name.toLowerCase(), [...(weights.get(e.name.toLowerCase()) ?? []), s.weight ?? 0]);
  const out: ImportResult['flaggedSets'] = [];
  for (const w of workouts) {
    for (const e of w.exercises) {
      const usual = median(weights.get(e.name.toLowerCase()) ?? []) ?? 0;
      for (const s of e.sets) {
        if (s.weight === null) continue;
        const why = usual > 0 && s.weight > usual * OUTLIER_TIMES
          ? `${s.weight} kg is over ${OUTLIER_TIMES}× the usual ${usual} kg: a typo?`
          : usual === 0 && s.weight >= BODYWEIGHT_SLIP_KG ? `${s.weight} kg added on an exercise usually done at bodyweight: was it your bodyweight?` : null;
        if (why) {
          s.flag = 'outlier';
          out.push({ day: w.workout.day, exercise: e.name, reps: s.reps, weight: s.weight, why });
        }
      }
    }
  }
  return out;
}

/** Per exercise, sessions identical to the one before 3+ times in a row. */
export function findCopied(workouts: readonly ImportedWorkout[]): ImportResult['copied'] {
  const byExercise = new Map<string, { name: string; sessions: { day: string; weight: number; reps: number[] }[] }>();
  const ordered = [...workouts].sort((a, b) => a.workout.day.localeCompare(b.workout.day));
  for (const w of ordered) {
    for (const e of w.exercises) {
      const sets = e.sets.filter((s) => s.reps !== null && !s.flag);
      if (!sets.length) continue;
      const weight = Math.max(...sets.map((s) => s.weight ?? 0));
      const entry = byExercise.get(e.name.toLowerCase()) ?? { name: e.name, sessions: [] };
      entry.sessions.push({ day: w.workout.day, weight, reps: sets.filter((s) => (s.weight ?? 0) === weight).map((s) => s.reps as number) });
      byExercise.set(e.name.toLowerCase(), entry);
    }
  }
  return [...byExercise.values()].flatMap(({ name, sessions }) => {
    const copies = [...copiedRuns(sessions)];
    return copies.length ? [{ exercise: name, sessions: copies.length, days: copies.map((i) => (sessions[i] as { day: string }).day) }] : [];
  });
}

/** Which exercises in the file are in the plan (by name or alias), and which are history only. */
export function planMatch(names: readonly string[], plan: readonly { name: string; aliases: string[] }[]): { planned: Map<string, string>; unplanned: string[] } {
  const known = new Map(plan.flatMap((p) => [p.name, ...p.aliases].map((n) => [n.toLowerCase(), p.name] as const)));
  const planned = new Map<string, string>();
  const unplanned: string[] = [];
  for (const n of new Set(names)) {
    const p = known.get(n.toLowerCase());
    if (p) planned.set(n, p);
    else unplanned.push(n);
  }
  return { planned, unplanned };
}

const clockOf = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

/** Whether an imported workout already saved holds just what the file says. */
export function sameAsSaved(saved: { minutes: number | null; calories: number | null; name: string; kind: string; sets: (NewSet & { exercise: string })[] }, imported: ImportedWorkout): boolean {
  const flat = imported.exercises.flatMap((e) => e.sets.map((s) => ({ ...s, exercise: e.name })));
  const fields = (s: NewSet & { exercise: string }) => [s.exercise.toLowerCase(), s.reps, s.weight, s.rpe, s.seconds, s.distance, s.flag === 'kept' ? 'outlier' : (s.flag ?? '')].join('|');
  return (
    saved.minutes === imported.workout.minutes &&
    saved.calories === imported.workout.calories &&
    saved.name === imported.workout.name &&
    saved.kind === imported.workout.kind &&
    saved.sets.length === flat.length &&
    saved.sets.every((s, i) => fields(s) === fields(flat[i] as NewSet & { exercise: string }))
  );
}

export interface ImportPlan {
  fresh: ImportedWorkout[];
  /** Already imported, but the file now says something else: their sets are replaced. */
  changed: (ImportedWorkout & { replaces: number })[];
  unchanged: number;
}

/** Holds the file up against what earlier imports saved. Nothing is written. */
export function planImport(journal: Pick<Journal, 'importedWorkout'>, workouts: readonly ImportedWorkout[]): ImportPlan {
  const plan: ImportPlan = { fresh: [], changed: [], unchanged: 0 };
  for (const w of workouts) {
    const saved = w.workout.externalId ? journal.importedWorkout(w.workout.source, w.workout.externalId) : null;
    if (!saved) plan.fresh.push(w);
    else if (sameAsSaved(saved, w)) plan.unchanged++;
    else plan.changed.push({ ...w, replaces: saved.id });
  }
  return plan;
}
