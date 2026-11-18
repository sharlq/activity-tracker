// رقيب's own records, next to the events in the same database: background audio,
// what you log for the gaps in your day, daily tasks, reminders, and settings.
//
// Its own connection, so the tracker's event writes and these never share a
// transaction. WAL mode lets both write the same file one after the other.
import Database from 'better-sqlite3';
import type { ReminderSchedule } from './planner.ts';
import { DEFAULT_SETTINGS, mergeSettings, parseSchedule } from './planner.ts';
import type { NewProjectPlan, PlannedSubtask, Replan } from './projectPlan.ts';
import type { Progress, Project, ProjectDay, ProjectOverview, ProjectStatus, Subtask, Target } from './projects.ts';
import { overview } from './projects.ts';
import type { ScreenSource } from './screens.ts';
import { migrate } from './store.ts';
import type { BodyGoal, CheckpointDay, PlanDay, PlanExercise, TrainingSet, WeighIn } from './trainingTypes.ts';
export type { BodyGoal, CheckpointDay, PlanDay, PlanExercise, TrainingSet, TrainingSource, WeighIn } from './trainingTypes.ts';

export interface AudioSource {
  processName: string;
  exePath: string | null;
  /** What's playing, when the app shows it (Spotify's window title, a tab's title). */
  title: string | null;
  /** For browser tabs reported by the extension. */
  domain: string | null;
}

export interface AudioEvent {
  id: number;
  start: number;
  end: number;
  source: AudioSource;
}

/** The window on top of one of the screens that didn't have the focus. */
export interface ScreenEvent {
  id: number;
  start: number;
  end: number;
  source: ScreenSource;
}

export interface Entry {
  id: number;
  start: number;
  end: number;
  label: string;
  category: string | null;
}

export interface Task {
  id: number;
  /** Local date, YYYY-MM-DD. */
  day: string;
  text: string;
  /** When it was ticked off, or null. */
  doneAt: number | null;
}

export type CheckinPart = 'morning' | 'evening';

/** How you felt, 1 (low) to 5 (great), once in the morning and once in the evening. */
export interface Checkin {
  day: string;
  part: CheckinPart;
  mood: number | null;
  energy: number | null;
  note: string | null;
  at: number;
}

export type GoalResult = 'met' | 'partly' | 'missed';

/** Something you want to get done that day, looked back on in the evening. */
export interface Goal {
  id: number;
  day: string;
  text: string;
  result: GoalResult | null;
}

/** A stretch of the day you planned: "09:00–11:00 Study for the exam (study)". */
export interface PlanBlock {
  id: number;
  /** The day it's planned for, YYYY-MM-DD. It starts on that day, and may run past midnight. */
  day: string;
  start: number;
  end: number;
  label: string;
  category: string | null;
}

/** What you wrote looking back on a week. `week` is its Monday. */
export interface Review {
  week: string;
  wentWell: string | null;
  toChange: string | null;
  updatedAt: number;
}

export interface Reminder {
  id: number;
  text: string;
  schedule: ReminderSchedule;
  enabled: boolean;
  lastFiredAt: number | null;
  createdAt: number;
}

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Something you ate. Calories and grams are optional: log what you know. */
export interface FoodEntry {
  id: number;
  day: string;
  meal: Meal;
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  at: number;
}
export type NewFood = Omit<FoodEntry, 'id' | 'at'>;


type FoodRow = {
  id: number;
  day: string;
  meal: Meal;
  name: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  created_ms: number;
};
const foodFromRow = (r: FoodRow): FoodEntry => ({
  id: r.id,
  day: r.day,
  meal: r.meal,
  name: r.name,
  calories: r.calories,
  protein: r.protein_g,
  carbs: r.carbs_g,
  fat: r.fat_g,
  at: r.created_ms,
});
type WeighInRow = { day: string; weight_kg: number; body_fat_pct: number | null; waist_cm: number | null; note: string | null; updated_ms: number };
const weighInFromRow = (r: WeighInRow): WeighIn => ({ day: r.day, weight: r.weight_kg, bodyFat: r.body_fat_pct, waist: r.waist_cm, note: r.note, at: r.updated_ms });

export const WORKOUT_KINDS = ['strength', 'run', 'walk', 'cycle', 'swim', 'sport', 'other'] as const;
export type WorkoutKind = (typeof WORKOUT_KINDS)[number];

/** One set: reps at a weight, or a timed or distance set. Anything unknown is null. */
export interface WorkoutSet {
  id: number;
  exercise: string;
  /** Exercises keep the order they were done in. */
  position: number;
  setNo: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  seconds: number | null;
  distance: number | null;
  /** 'outlier' when it looks like a typo (left out of the plan until checked); 'kept' once checked and right. */
  flag?: string | null;
}
export type NewSet = Omit<WorkoutSet, 'id' | 'exercise' | 'position' | 'setNo'>;

export interface Workout {
  id: number;
  day: string;
  start: number | null;
  name: string;
  kind: WorkoutKind;
  minutes: number | null;
  calories: number | null;
  note: string | null;
  /** 'manual', or the app it came from ('caliber'). */
  source: string;
  externalId: string | null;
  /** The plan day it was done as (Upper A), when logged from the plan. */
  planDayId?: number | null;
  sets: WorkoutSet[];
}
export type NewWorkout = Omit<Workout, 'id' | 'sets'>;
export type WorkoutChange = Partial<Pick<Workout, 'name' | 'kind' | 'minutes' | 'calories' | 'note' | 'start'>>;

/** An exercise's record: the heaviest set, and the last time it was done. */
export interface ExerciseHistory {
  exercise: string;
  best: { weight: number; reps: number | null; day: string } | null;
  lastDay: string;
  lastSets: NewSet[];
  times: number;
}

// Training plan -------------------------------------------------------------


export type PlanExerciseChange = Partial<Omit<PlanExercise, 'id' | 'goals'>>;




type PlanExerciseRow = {
  id: number; day_id: number; position: number; name: string; aliases: string; sets: number; rep_min: number; rep_max: number;
  step_kg: number; later_slot: number; per_hand: number; per_side: number; bodyweight: number; note: string | null; active: number;
};

type WorkoutRow = {
  id: number;
  day: string;
  start_ms: number | null;
  name: string;
  kind: WorkoutKind;
  minutes: number | null;
  calories: number | null;
  note: string | null;
  source: string;
  external_id: string | null;
  plan_day_id?: number | null;
};
type SetRow = {
  id: number;
  workout_id: number;
  position: number;
  exercise: string;
  set_no: number;
  reps: number | null;
  weight_kg: number | null;
  rpe: number | null;
  seconds: number | null;
  distance_m: number | null;
  flag?: string | null;
};
const setFromRow = (r: SetRow): WorkoutSet => ({
  id: r.id,
  exercise: r.exercise,
  position: r.position,
  setNo: r.set_no,
  reps: r.reps,
  weight: r.weight_kg,
  rpe: r.rpe,
  seconds: r.seconds,
  distance: r.distance_m,
  flag: r.flag ?? null,
});
const plainSet = (s: WorkoutSet): NewSet => ({ reps: s.reps, weight: s.weight, rpe: s.rpe, seconds: s.seconds, distance: s.distance });

type AudioRow = {
  id: number;
  start_ms: number;
  end_ms: number;
  process_name: string;
  exe_path: string | null;
  title: string | null;
  domain: string | null;
};
type ScreenRow = {
  id: number;
  start_ms: number;
  end_ms: number;
  screen: number;
  process_name: string;
  exe_path: string | null;
  title: string | null;
  domain: string | null;
};
type EntryRow = { id: number; start_ms: number; end_ms: number; label: string; category: string | null };
type TaskRow = { id: number; day: string; text: string; done_ms: number | null };
type ReminderRow = {
  id: number;
  text: string;
  schedule: string;
  enabled: number;
  last_fired_ms: number | null;
  created_ms: number;
};

export const audioFromRow = (row: AudioRow): AudioEvent => ({
  id: row.id,
  start: row.start_ms,
  end: row.end_ms,
  source: { processName: row.process_name, exePath: row.exe_path, title: row.title, domain: row.domain },
});
export const screenFromRow = (row: ScreenRow): ScreenEvent => ({
  id: row.id,
  start: row.start_ms,
  end: row.end_ms,
  source: { screen: row.screen, processName: row.process_name, exePath: row.exe_path, title: row.title, domain: row.domain },
});
export const entryFromRow = (row: EntryRow): Entry => ({
  id: row.id,
  start: row.start_ms,
  end: row.end_ms,
  label: row.label,
  category: row.category,
});
type ProjectRow = {
  id: number;
  name: string;
  color: string | null;
  status: ProjectStatus;
  due_day: string | null;
  position: number;
  created_ms: number;
  /** JSON list of match words; absent before the column existed. */
  match_words?: string | null;
};
type SubtaskRow = {
  id: number;
  project_id: number;
  title: string;
  unit: string | null;
  total: number | null;
  done_amount: number;
  done_ms: number | null;
  due_day: string | null;
  position: number;
};
const projectFromRow = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  color: r.color,
  status: r.status,
  due: r.due_day,
  position: r.position,
  createdAt: r.created_ms,
  match: matchWords(r.match_words),
});
function matchWords(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const list = JSON.parse(json) as unknown;
    return Array.isArray(list) ? list.filter((w): w is string => typeof w === 'string' && w.trim() !== '') : [];
  } catch {
    return [];
  }
}
const subtaskFromRow = (r: SubtaskRow): Subtask => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  unit: r.unit,
  total: r.total,
  done: r.done_amount,
  doneAt: r.done_ms,
  due: r.due_day,
  position: r.position,
});
const SUBTASK_SELECT = `SELECT s.*, s.base + COALESCE((SELECT SUM(amount) FROM progress p WHERE p.subtask_id = s.id), 0) AS done_amount FROM subtasks s`;

/** A change to a project. Fields left undefined stay as they are. */
export interface ProjectChange {
  name?: string;
  color?: string | null;
  status?: ProjectStatus;
  due?: string | null;
  /** Words that make PC time count toward it; [] clears them. */
  match?: string[];
}

/** A change to a sub-task. Fields left undefined stay as they are. */
export interface SubtaskChange {
  title?: string;
  /** Changing these turns a checkbox into a measured sub-task; both null turns it back. */
  unit?: string | null;
  total?: number | null;
  due?: string | null;
}

type PlanRow = { id: number; day: string; start_ms: number; end_ms: number; label: string; category: string | null };
const planFromRow = (r: PlanRow): PlanBlock => ({ id: r.id, day: r.day, start: r.start_ms, end: r.end_ms, label: r.label, category: r.category });

const taskFromRow = (row: TaskRow): Task => ({ id: row.id, day: row.day, text: row.text, doneAt: row.done_ms });
const reminderFromRow = (row: ReminderRow): Reminder => ({
  id: row.id,
  text: row.text,
  schedule: parseSchedule(JSON.parse(row.schedule)),
  enabled: row.enabled === 1,
  lastFiredAt: row.last_fired_ms,
  createdAt: row.created_ms,
});

export class Journal {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('secure_delete = ON');
    migrate(this.db);
  }

  // Background audio -------------------------------------------------------

  startAudio(source: AudioSource, start: number, end: number): number {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO audio_events (start_ms, end_ms, process_name, exe_path, title, domain) VALUES (?, ?, ?, ?, ?, ?)')
      .run(start, end, source.processName, source.exePath, source.title, source.domain);
    return Number(lastInsertRowid);
  }

  extendAudio(id: number, end: number): void {
    this.db.prepare('UPDATE audio_events SET end_ms = ? WHERE id = ? AND end_ms <= ?').run(end, id, end);
  }

  audioBetween(from: number, to: number): AudioEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM audio_events WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms, id')
      .all(to, from) as AudioRow[];
    return rows.map(audioFromRow).map((e) => ({ ...e, start: Math.max(e.start, from), end: Math.min(e.end, to) }));
  }

  // Other screens ----------------------------------------------------------

  startScreen(source: ScreenSource, start: number, end: number): number {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO screen_events (start_ms, end_ms, screen, process_name, exe_path, title, domain) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(start, end, source.screen, source.processName, source.exePath, source.title, source.domain);
    return Number(lastInsertRowid);
  }

  extendScreen(id: number, end: number): void {
    this.db.prepare('UPDATE screen_events SET end_ms = ? WHERE id = ? AND end_ms <= ?').run(end, id, end);
  }

  screensBetween(from: number, to: number): ScreenEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM screen_events WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms, id')
      .all(to, from) as ScreenRow[];
    return rows.map(screenFromRow).map((e) => ({ ...e, start: Math.max(e.start, from), end: Math.min(e.end, to) }));
  }

  // Entries you log for gaps -----------------------------------------------

  entriesBetween(from: number, to: number): Entry[] {
    const rows = this.db
      .prepare('SELECT * FROM entries WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms, id')
      .all(to, from) as EntryRow[];
    return rows.map(entryFromRow);
  }

  addEntry(entry: Omit<Entry, 'id'>, now = Date.now()): Entry {
    // The same answer sent twice (a double click, a retried request) is saved once.
    const same = this.db
      .prepare('SELECT id, category FROM entries WHERE start_ms = ? AND end_ms = ? AND label = ? LIMIT 1')
      .get(entry.start, entry.end, entry.label) as { id: number; category: string | null } | undefined;
    if (same) return { ...entry, id: same.id, category: same.category };
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO entries (start_ms, end_ms, label, category, created_ms) VALUES (?, ?, ?, ?, ?)')
      .run(entry.start, entry.end, entry.label, entry.category, now);
    return { ...entry, id: Number(lastInsertRowid) };
  }

  updateEntry(id: number, entry: Omit<Entry, 'id'>): boolean {
    return (
      this.db
        .prepare('UPDATE entries SET start_ms = ?, end_ms = ?, label = ?, category = ? WHERE id = ?')
        .run(entry.start, entry.end, entry.label, entry.category, id).changes > 0
    );
  }

  deleteEntry(id: number): boolean {
    return this.db.prepare('DELETE FROM entries WHERE id = ?').run(id).changes > 0;
  }

  // Tasks ------------------------------------------------------------------

  tasks(day: string): Task[] {
    return (this.db.prepare('SELECT * FROM tasks WHERE day = ? ORDER BY id').all(day) as TaskRow[]).map(taskFromRow);
  }

  addTask(day: string, text: string, now = Date.now()): Task {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO tasks (day, text, done_ms, created_ms) VALUES (?, ?, NULL, ?)')
      .run(day, text, now);
    return { id: Number(lastInsertRowid), day, text, doneAt: null };
  }

  updateTask(id: number, change: { text?: string; done?: boolean }, now = Date.now()): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!row) return null;
    const text = change.text ?? row.text;
    const done = change.done === undefined ? row.done_ms : change.done ? (row.done_ms ?? now) : null;
    this.db.prepare('UPDATE tasks SET text = ?, done_ms = ? WHERE id = ?').run(text, done, id);
    return { id, day: row.day, text, doneAt: done };
  }

  deleteTask(id: number): boolean {
    return this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
  }

  /** Copies the unfinished tasks of one day to another, skipping any already there. */
  carryOver(fromDay: string, toDay: string, now = Date.now()): Task[] {
    return this.db.transaction(() => {
      const existing = new Set(this.tasks(toDay).map((t) => t.text));
      const added: Task[] = [];
      for (const task of this.tasks(fromDay)) {
        if (task.doneAt !== null || existing.has(task.text)) continue;
        added.push(this.addTask(toDay, task.text, now));
        existing.add(task.text);
      }
      return added;
    })();
  }

  // Check-ins: mood and energy -----------------------------------------------

  checkins(day: string): Checkin[] {
    return this.checkinsBetween(day, day);
  }

  /** Every check-in from one day to another, both included, oldest first. */
  checkinsBetween(fromDay: string, toDay: string): Checkin[] {
    const rows = this.db
      .prepare("SELECT * FROM checkins WHERE day >= ? AND day <= ? ORDER BY day, CASE part WHEN 'morning' THEN 0 ELSE 1 END")
      .all(fromDay, toDay) as { day: string; part: CheckinPart; mood: number | null; energy: number | null; note: string | null; at_ms: number }[];
    return rows.map((r) => ({ day: r.day, part: r.part, mood: r.mood, energy: r.energy, note: r.note, at: r.at_ms }));
  }

  /** Saves the morning or evening check-in. Fields left undefined keep what's there. */
  setCheckin(day: string, part: CheckinPart, change: { mood?: number | null; energy?: number | null; note?: string | null }, now = Date.now()): Checkin {
    const current = this.checkins(day).find((c) => c.part === part);
    const next: Checkin = {
      day,
      part,
      mood: change.mood === undefined ? (current?.mood ?? null) : change.mood,
      energy: change.energy === undefined ? (current?.energy ?? null) : change.energy,
      note: change.note === undefined ? (current?.note ?? null) : change.note,
      at: now,
    };
    this.db
      .prepare(
        `INSERT INTO checkins (day, part, mood, energy, note, at_ms) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (day, part) DO UPDATE SET mood = excluded.mood, energy = excluded.energy, note = excluded.note, at_ms = excluded.at_ms`,
      )
      .run(day, part, next.mood, next.energy, next.note, now);
    return next;
  }

  // Goals ------------------------------------------------------------------

  goals(day: string): Goal[] {
    return this.goalsBetween(day, day);
  }

  goalsBetween(fromDay: string, toDay: string): Goal[] {
    const rows = this.db.prepare('SELECT * FROM goals WHERE day >= ? AND day <= ? ORDER BY day, id').all(fromDay, toDay) as {
      id: number;
      day: string;
      text: string;
      result: GoalResult | null;
    }[];
    return rows.map((r) => ({ id: r.id, day: r.day, text: r.text, result: r.result }));
  }

  addGoal(day: string, text: string, now = Date.now()): Goal {
    const { lastInsertRowid } = this.db.prepare('INSERT INTO goals (day, text, result, created_ms) VALUES (?, ?, NULL, ?)').run(day, text, now);
    return { id: Number(lastInsertRowid), day, text, result: null };
  }

  updateGoal(id: number, change: { text?: string; result?: GoalResult | null }): Goal | null {
    const row = this.db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as { id: number; day: string; text: string; result: GoalResult | null } | undefined;
    if (!row) return null;
    const text = change.text ?? row.text;
    const result = change.result === undefined ? row.result : change.result;
    this.db.prepare('UPDATE goals SET text = ?, result = ? WHERE id = ?').run(text, result, id);
    return { id, day: row.day, text, result };
  }

  deleteGoal(id: number): boolean {
    return this.db.prepare('DELETE FROM goals WHERE id = ?').run(id).changes > 0;
  }

  // The day's plan -----------------------------------------------------------

  planBlocks(day: string): PlanBlock[] {
    return this.planBlocksBetween(day, day);
  }

  /** Every planned block from one day to another, both included, in time order. */
  planBlocksBetween(fromDay: string, toDay: string): PlanBlock[] {
    const rows = this.db.prepare('SELECT * FROM plan_blocks WHERE day >= ? AND day <= ? ORDER BY start_ms, id').all(fromDay, toDay) as PlanRow[];
    return rows.map(planFromRow);
  }

  planBlock(id: number): PlanBlock | null {
    const row = this.db.prepare('SELECT * FROM plan_blocks WHERE id = ?').get(id) as PlanRow | undefined;
    return row ? planFromRow(row) : null;
  }

  addPlanBlock(block: Omit<PlanBlock, 'id'>, now = Date.now()): PlanBlock {
    // The same block sent twice (a double click, a retried request) is saved once.
    const same = this.db
      .prepare('SELECT * FROM plan_blocks WHERE day = ? AND start_ms = ? AND end_ms = ? AND label = ? LIMIT 1')
      .get(block.day, block.start, block.end, block.label) as PlanRow | undefined;
    if (same) return planFromRow(same);
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO plan_blocks (day, start_ms, end_ms, label, category, created_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .run(block.day, block.start, block.end, block.label, block.category, now);
    return { ...block, id: Number(lastInsertRowid) };
  }

  /** Changes a block's time, label, or category. Its day stays. */
  updatePlanBlock(id: number, change: { start?: number; end?: number; label?: string; category?: string | null }): PlanBlock | null {
    const current = this.planBlock(id);
    if (!current) return null;
    const next: PlanBlock = {
      ...current,
      start: change.start ?? current.start,
      end: change.end ?? current.end,
      label: change.label ?? current.label,
      category: change.category === undefined ? current.category : change.category,
    };
    if (next.end <= next.start) return null;
    this.db
      .prepare('UPDATE plan_blocks SET start_ms = ?, end_ms = ?, label = ?, category = ? WHERE id = ?')
      .run(next.start, next.end, next.label, next.category, id);
    return next;
  }

  deletePlanBlock(id: number): boolean {
    return this.db.prepare('DELETE FROM plan_blocks WHERE id = ?').run(id).changes > 0;
  }

  /**
   * Copies one day's plan to another at the same clock times, skipping blocks already
   * there. `shift` moves a time from the first day to the second (DST-safe in the caller).
   */
  copyPlan(fromDay: string, toDay: string, shift: (ms: number) => number, now = Date.now()): PlanBlock[] {
    return this.db.transaction(() => {
      const existing = new Set(this.planBlocks(toDay).map((b) => `${b.start}|${b.label}`));
      const added: PlanBlock[] = [];
      for (const b of this.planBlocks(fromDay)) {
        const start = shift(b.start);
        if (existing.has(`${start}|${b.label}`)) continue;
        added.push(this.addPlanBlock({ day: toDay, start, end: shift(b.end), label: b.label, category: b.category }, now));
      }
      return added;
    })();
  }

  // Weekly reviews -----------------------------------------------------------

  review(week: string): Review | null {
    const row = this.db.prepare('SELECT * FROM reviews WHERE week = ?').get(week) as
      | { week: string; went_well: string | null; to_change: string | null; updated_ms: number }
      | undefined;
    return row ? { week: row.week, wentWell: row.went_well, toChange: row.to_change, updatedAt: row.updated_ms } : null;
  }

  setReview(week: string, change: { wentWell?: string | null; toChange?: string | null }, now = Date.now()): Review {
    const current = this.review(week);
    const next: Review = {
      week,
      wentWell: change.wentWell === undefined ? (current?.wentWell ?? null) : change.wentWell,
      toChange: change.toChange === undefined ? (current?.toChange ?? null) : change.toChange,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO reviews (week, went_well, to_change, updated_ms) VALUES (?, ?, ?, ?)
         ON CONFLICT (week) DO UPDATE SET went_well = excluded.went_well, to_change = excluded.to_change, updated_ms = excluded.updated_ms`,
      )
      .run(week, next.wentWell, next.toChange, now);
    return next;
  }

  // Projects -----------------------------------------------------------------

  /** Every project, in their order. Pass a status to see only those. */
  projects(status?: ProjectStatus): Project[] {
    const rows = (
      status
        ? this.db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY position, id').all(status)
        : this.db.prepare('SELECT * FROM projects ORDER BY position, id').all()
    ) as ProjectRow[];
    return rows.map(projectFromRow);
  }

  project(id: number): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    return row ? projectFromRow(row) : null;
  }

  addProject(project: { name: string; color?: string | null; due?: string | null }, now = Date.now()): Project {
    const position = (this.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM projects').get() as { next: number }).next;
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO projects (name, color, status, due_day, position, created_ms) VALUES (?, ?, 'active', ?, ?, ?)")
      .run(project.name, project.color ?? null, project.due ?? null, position, now);
    return { id: Number(lastInsertRowid), name: project.name, color: project.color ?? null, status: 'active', due: project.due ?? null, position, createdAt: now, match: [] };
  }

  updateProject(id: number, change: ProjectChange): Project | null {
    const current = this.project(id);
    if (!current) return null;
    const next: Project = {
      ...current,
      name: change.name ?? current.name,
      color: change.color === undefined ? current.color : change.color,
      status: change.status ?? current.status,
      due: change.due === undefined ? current.due : change.due,
      match: change.match === undefined ? current.match : change.match,
    };
    this.db
      .prepare('UPDATE projects SET name = ?, color = ?, status = ?, due_day = ?, match_words = ? WHERE id = ?')
      .run(next.name, next.color, next.status, next.due, next.match.length ? JSON.stringify(next.match) : null, id);
    return next;
  }

  /** Deletes a project with its sub-tasks, progress, notes, and plan. */
  deleteProject(id: number): boolean {
    return this.db.transaction(() => {
      for (const s of this.subtasks(id)) this.deleteSubtask(s.id);
      this.db.prepare('DELETE FROM project_days WHERE project_id = ?').run(id);
      return this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
    })();
  }

  /** Puts projects in this order; ids not listed keep their place after these. */
  reorderProjects(ids: number[]): void {
    this.db.transaction(() => {
      const rest = this.projects().filter((p) => !ids.includes(p.id)).map((p) => p.id);
      const update = this.db.prepare('UPDATE projects SET position = ? WHERE id = ?');
      [...ids, ...rest].forEach((id, i) => update.run(i + 1, id));
    })();
  }

  // Sub-tasks ----------------------------------------------------------------

  subtasks(projectId: number): Subtask[] {
    return (this.db.prepare(`${SUBTASK_SELECT} WHERE s.project_id = ? ORDER BY s.position, s.id`).all(projectId) as SubtaskRow[]).map(subtaskFromRow);
  }

  subtask(id: number): Subtask | null {
    const row = this.db.prepare(`${SUBTASK_SELECT} WHERE s.id = ?`).get(id) as SubtaskRow | undefined;
    return row ? subtaskFromRow(row) : null;
  }

  /**
   * Null when the project doesn't exist. Without a total it's a checkbox. `alreadyDone` is
   * what was finished before tracking began (slide 266 of 876): it counts toward the bar
   * but not toward any day's work.
   */
  addSubtask(projectId: number, subtask: { title: string; unit?: string | null; total?: number | null; due?: string | null; alreadyDone?: number }, now = Date.now()): Subtask | null {
    if (!this.project(projectId)) return null;
    const total = subtask.total ?? null;
    const unit = total === null ? null : (subtask.unit ?? null);
    const base = total === null ? 0 : Math.max(0, Math.min(total, Math.trunc(subtask.alreadyDone ?? 0)));
    const position = (this.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM subtasks WHERE project_id = ?').get(projectId) as { next: number }).next;
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO subtasks (project_id, title, unit, total, base, done_ms, due_day, position, created_ms) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)')
      .run(projectId, subtask.title, unit, total, base, subtask.due ?? null, position, now);
    return { id: Number(lastInsertRowid), projectId, title: subtask.title, unit, total, done: base, doneAt: null, due: subtask.due ?? null, position };
  }

  updateSubtask(id: number, change: SubtaskChange): Subtask | null {
    const current = this.subtask(id);
    if (!current) return null;
    const total = change.total === undefined ? current.total : change.total;
    // A measured sub-task with progress can't become a checkbox: its count would mean nothing.
    if (current.total !== null && total === null && current.done !== 0) return null;
    const unit = total === null ? null : change.unit === undefined ? current.unit : change.unit;
    const title = change.title ?? current.title;
    const due = change.due === undefined ? current.due : change.due;
    this.db.prepare('UPDATE subtasks SET title = ?, unit = ?, total = ?, due_day = ? WHERE id = ?').run(title, unit, total, due, id);
    return this.subtask(id);
  }

  /** Deletes a sub-task with its progress and plan. */
  deleteSubtask(id: number): boolean {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM progress WHERE subtask_id = ?').run(id);
      this.db.prepare('DELETE FROM targets WHERE subtask_id = ?').run(id);
      return this.db.prepare('DELETE FROM subtasks WHERE id = ?').run(id).changes > 0;
    })();
  }

  // Progress -----------------------------------------------------------------

  /**
   * Adds what you did on a measured sub-task that day (negative to correct a mistake).
   * Null if the sub-task is missing, is a checkbox, or the count would drop below zero.
   */
  addProgress(subtaskId: number, day: string, amount: number, now = Date.now()): Subtask | null {
    return this.db.transaction(() => {
      const current = this.subtask(subtaskId);
      if (!current || current.total === null || !Number.isInteger(amount) || amount === 0 || current.done + amount < 0) return null;
      this.db.prepare('INSERT INTO progress (subtask_id, day, amount, created_ms) VALUES (?, ?, ?, ?)').run(subtaskId, day, amount, now);
      return { ...current, done: current.done + amount };
    })();
  }

  /**
   * Sets what you did on a measured sub-task on one day to exactly `amount` (the evening
   * log's box), replacing that day's earlier reports. Null as for addProgress.
   */
  setProgress(subtaskId: number, day: string, amount: number, now = Date.now()): Subtask | null {
    return this.db.transaction(() => {
      const current = this.subtask(subtaskId);
      if (!current || current.total === null || !Number.isInteger(amount)) return null;
      const before = (this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS sum FROM progress WHERE subtask_id = ? AND day = ?').get(subtaskId, day) as { sum: number }).sum;
      if (current.done - before + amount < 0) return null;
      this.db.prepare('DELETE FROM progress WHERE subtask_id = ? AND day = ?').run(subtaskId, day);
      if (amount !== 0) this.db.prepare('INSERT INTO progress (subtask_id, day, amount, created_ms) VALUES (?, ?, ?, ?)').run(subtaskId, day, amount, now);
      return { ...current, done: current.done - before + amount };
    })();
  }

  /** Ticks a checkbox sub-task off on a day, or un-ticks it. Null if missing or measured. */
  setSubtaskDone(subtaskId: number, done: boolean, day: string, now = Date.now()): Subtask | null {
    return this.db.transaction(() => {
      const current = this.subtask(subtaskId);
      if (!current || current.total !== null) return null;
      if (done === current.done >= 1) return current;
      // A checkbox's history is the day it was ticked; un-ticking clears it.
      this.db.prepare('DELETE FROM progress WHERE subtask_id = ?').run(subtaskId);
      this.db.prepare('UPDATE subtasks SET base = 0, done_ms = ? WHERE id = ?').run(done ? now : null, subtaskId);
      if (done) this.db.prepare('INSERT INTO progress (subtask_id, day, amount, created_ms) VALUES (?, ?, 1, ?)').run(subtaskId, day, now);
      return { ...current, done: done ? 1 : 0, doneAt: done ? now : null };
    })();
  }

  /** Progress between two days, both included, for one project or all of them. */
  progressBetween(fromDay: string, toDay: string, projectId?: number): (Progress & { projectId: number })[] {
    const rows = this.db
      .prepare(
        `SELECT p.subtask_id, p.day, p.amount, s.project_id FROM progress p JOIN subtasks s ON s.id = p.subtask_id
         WHERE p.day >= ? AND p.day <= ? ${projectId === undefined ? '' : 'AND s.project_id = ?'} ORDER BY p.day, p.id`,
      )
      .all(...(projectId === undefined ? [fromDay, toDay] : [fromDay, toDay, projectId])) as { subtask_id: number; day: string; amount: number; project_id: number }[];
    return rows.map((r) => ({ subtaskId: r.subtask_id, day: r.day, amount: r.amount, projectId: r.project_id }));
  }

  // The daily answer per project -----------------------------------------------

  projectDaysBetween(fromDay: string, toDay: string, projectId?: number): ProjectDay[] {
    const rows = this.db
      .prepare(`SELECT * FROM project_days WHERE day >= ? AND day <= ? ${projectId === undefined ? '' : 'AND project_id = ?'} ORDER BY day, project_id`)
      .all(...(projectId === undefined ? [fromDay, toDay] : [fromDay, toDay, projectId])) as { project_id: number; day: string; note: string | null; skipped: number }[];
    return rows.map((r) => ({ projectId: r.project_id, day: r.day, note: r.note, skipped: r.skipped === 1 }));
  }

  /**
   * Saves what you did on a project that day, or "nothing today". Fields left undefined
   * keep what's there; writing a note clears a skip. Null if the project doesn't exist.
   */
  setProjectDay(projectId: number, day: string, change: { note?: string | null; skipped?: boolean }, now = Date.now()): ProjectDay | null {
    if (!this.project(projectId)) return null;
    const current = this.projectDaysBetween(day, day, projectId)[0];
    const note = change.note === undefined ? (current?.note ?? null) : change.note?.trim() || null;
    const skipped = change.skipped ?? (change.note ? false : (current?.skipped ?? false));
    this.db
      .prepare(
        `INSERT INTO project_days (project_id, day, note, skipped, updated_ms) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (project_id, day) DO UPDATE SET note = excluded.note, skipped = excluded.skipped, updated_ms = excluded.updated_ms`,
      )
      .run(projectId, day, note, skipped ? 1 : 0, now);
    return { projectId, day, note, skipped };
  }

  // The plan -------------------------------------------------------------------

  targets(subtaskId: number): Target[] {
    return (this.db.prepare('SELECT * FROM targets WHERE subtask_id = ? ORDER BY day').all(subtaskId) as { subtask_id: number; day: string; amount: number }[]).map((r) => ({
      subtaskId: r.subtask_id,
      day: r.day,
      amount: r.amount,
    }));
  }

  /** Every target between two days, both included, with its project. */
  targetsBetween(fromDay: string, toDay: string, projectId?: number): (Target & { projectId: number })[] {
    const rows = this.db
      .prepare(
        `SELECT t.subtask_id, t.day, t.amount, s.project_id FROM targets t JOIN subtasks s ON s.id = t.subtask_id
         WHERE t.day >= ? AND t.day <= ? ${projectId === undefined ? '' : 'AND s.project_id = ?'} ORDER BY t.day, s.project_id, s.position`,
      )
      .all(...(projectId === undefined ? [fromDay, toDay] : [fromDay, toDay, projectId])) as { subtask_id: number; day: string; amount: number; project_id: number }[];
    return rows.map((r) => ({ subtaskId: r.subtask_id, day: r.day, amount: r.amount, projectId: r.project_id }));
  }

  /** Sets one day's target for a sub-task; 0 removes it. False if the sub-task is missing. */
  setTarget(subtaskId: number, day: string, amount: number): boolean {
    if (!this.subtask(subtaskId)) return false;
    if (amount <= 0) this.db.prepare('DELETE FROM targets WHERE subtask_id = ? AND day = ?').run(subtaskId, day);
    else
      this.db
        .prepare('INSERT INTO targets (subtask_id, day, amount) VALUES (?, ?, ?) ON CONFLICT (subtask_id, day) DO UPDATE SET amount = excluded.amount')
        .run(subtaskId, day, amount);
    return true;
  }

  /** How many days without work before an active project is flagged (Settings; default 3). */
  neglectAfterDays(): number {
    try {
      return mergeSettings(DEFAULT_SETTINGS, this.get('settings') ?? {}).projects.neglectAfterDays;
    } catch {
      return DEFAULT_SETTINGS.projects.neglectAfterDays;
    }
  }

  /** Replaces a sub-task's targets from `fromDay` on; earlier days stay as they were. */
  setTargets(subtaskId: number, fromDay: string, targets: Record<string, number>): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM targets WHERE subtask_id = ? AND day >= ?').run(subtaskId, fromDay);
      const insert = this.db.prepare('INSERT INTO targets (subtask_id, day, amount) VALUES (?, ?, ?)');
      for (const [day, amount] of Object.entries(targets)) if (day >= fromDay && amount > 0) insert.run(subtaskId, day, amount);
    })();
  }

  /** Creates a checked plan (see projectPlan.ts) in one go: all of it, or nothing. */
  createProjectFromPlan(plan: NewProjectPlan, today: string, now = Date.now()): Project {
    return this.db.transaction(() => {
      const project = this.addProject({ name: plan.name, color: plan.color, due: plan.due }, now);
      for (const s of plan.subtasks) this.addPlannedSubtask(project.id, s, today, now);
      return project;
    })();
  }

  /**
   * Applies a checked re-plan: sub-tasks with an id get their details updated and their
   * targets from today on replaced; the others are added. Progress is never touched.
   */
  applyPlan(projectId: number, plan: Replan, today: string, now = Date.now()): boolean {
    return this.db.transaction(() => {
      if (!this.project(projectId)) return false;
      if (plan.due !== undefined) this.updateProject(projectId, { due: plan.due });
      for (const s of plan.subtasks) {
        if (s.id === undefined) {
          this.addPlannedSubtask(projectId, s, today, now);
          continue;
        }
        if (this.subtask(s.id)?.projectId !== projectId) throw new Error(`Sub-task ${s.id} isn't in project ${projectId}`);
        this.updateSubtask(s.id, { title: s.title, unit: s.unit, total: s.total, due: s.due });
        this.setTargets(s.id, today, s.targets);
      }
      return true;
    })();
  }

  private addPlannedSubtask(projectId: number, s: PlannedSubtask, today: string, now: number): void {
    const added = this.addSubtask(projectId, { title: s.title, unit: s.unit, total: s.total, due: s.due, alreadyDone: s.alreadyDone ?? 0 }, now);
    if (added) this.setTargets(added.id, today, s.targets);
  }

  /**
   * Everything about a project as of `today`: progress, pace, plan, and whether it's
   * been neglected. History older than `historyDays` isn't read.
   */
  projectOverview(id: number, today: string, neglectAfterDays: number, historyDays = 120): ProjectOverview | null {
    const project = this.project(id);
    if (!project) return null;
    const from = new Date(Date.parse(`${today}T12:00:00`) - historyDays * 86_400_000).toLocaleDateString('en-CA');
    return overview(
      project,
      this.subtasks(id),
      this.progressBetween(from, today, id),
      this.targetsBetween('0000-01-01', '9999-12-31', id),
      this.projectDaysBetween(from, today, id),
      today,
      neglectAfterDays,
    );
  }

  projectOverviews(today: string, neglectAfterDays: number, status?: ProjectStatus): ProjectOverview[] {
    return this.projects(status).flatMap((p) => this.projectOverview(p.id, today, neglectAfterDays) ?? []);
  }

  // Reminders --------------------------------------------------------------

  reminders(): Reminder[] {
    return (this.db.prepare('SELECT * FROM reminders ORDER BY id').all() as ReminderRow[]).map(reminderFromRow);
  }

  reminder(id: number): Reminder | null {
    const row = this.db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as ReminderRow | undefined;
    return row ? reminderFromRow(row) : null;
  }

  /** A new reminder starts counting from now, so it never fires for a time already past. */
  addReminder(text: string, schedule: ReminderSchedule, enabled = true, now = Date.now()): Reminder {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO reminders (text, schedule, enabled, last_fired_ms, created_ms) VALUES (?, ?, ?, NULL, ?)')
      .run(text, JSON.stringify(schedule), enabled ? 1 : 0, now);
    return { id: Number(lastInsertRowid), text, schedule, enabled, lastFiredAt: null, createdAt: now };
  }

  /** Changing the schedule or switching it back on also starts counting from now. */
  updateReminder(id: number, change: { text?: string; schedule?: ReminderSchedule; enabled?: boolean }, now = Date.now()): Reminder | null {
    const current = this.reminder(id);
    if (!current) return null;
    const restart = change.schedule !== undefined || (change.enabled === true && !current.enabled);
    const next = {
      text: change.text ?? current.text,
      schedule: change.schedule ?? current.schedule,
      enabled: change.enabled ?? current.enabled,
      lastFiredAt: restart ? now : current.lastFiredAt,
    };
    this.db
      .prepare('UPDATE reminders SET text = ?, schedule = ?, enabled = ?, last_fired_ms = ? WHERE id = ?')
      .run(next.text, JSON.stringify(next.schedule), next.enabled ? 1 : 0, next.lastFiredAt, id);
    return { ...current, ...next };
  }

  deleteReminder(id: number): boolean {
    return this.db.prepare('DELETE FROM reminders WHERE id = ?').run(id).changes > 0;
  }

  markFired(id: number, at: number): void {
    this.db.prepare('UPDATE reminders SET last_fired_ms = ? WHERE id = ?').run(at, id);
  }

  // Health -----------------------------------------------------------------

  foods(day: string): FoodEntry[] {
    return (this.db.prepare('SELECT * FROM food_entries WHERE day = ? ORDER BY created_ms, id').all(day) as FoodRow[]).map(foodFromRow);
  }

  /** Calories and protein per day, for days with anything logged. */
  foodTotalsBetween(from: string, to: string): { day: string; calories: number; protein: number; items: number }[] {
    return this.db
      .prepare(
        `SELECT day, COALESCE(SUM(calories), 0) AS calories, COALESCE(SUM(protein_g), 0) AS protein, COUNT(*) AS items
         FROM food_entries WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day`,
      )
      .all(from, to) as { day: string; calories: number; protein: number; items: number }[];
  }

  /** What you've eaten lately, newest first, one per name: to log again with a click. */
  recentFoods(limit = 12): Omit<FoodEntry, 'id' | 'day' | 'at'>[] {
    const rows = this.db
      .prepare(
        `SELECT f.* FROM food_entries f
         JOIN (SELECT LOWER(name) AS k, MAX(id) AS id FROM food_entries GROUP BY LOWER(name)) latest ON latest.id = f.id
         ORDER BY f.created_ms DESC, f.id DESC LIMIT ?`,
      )
      .all(limit) as FoodRow[];
    return rows.map(foodFromRow).map(({ id: _id, day: _day, at: _at, ...rest }) => rest);
  }

  addFood(food: NewFood, now = Date.now()): FoodEntry {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO food_entries (day, meal, name, calories, protein_g, carbs_g, fat_g, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(food.day, food.meal, food.name, food.calories, food.protein, food.carbs, food.fat, now);
    return { id: Number(lastInsertRowid), ...food, at: now };
  }

  deleteFood(id: number): boolean {
    return this.db.prepare('DELETE FROM food_entries WHERE id = ?').run(id).changes > 0;
  }

  weighIns(from: string, to: string): WeighIn[] {
    return (this.db.prepare('SELECT * FROM weigh_ins WHERE day BETWEEN ? AND ? ORDER BY day').all(from, to) as WeighInRow[]).map(weighInFromRow);
  }

  /** One a day: weighing again the same day replaces it. */
  setWeighIn(w: Omit<WeighIn, 'at'>, now = Date.now()): WeighIn {
    this.db
      .prepare(
        `INSERT INTO weigh_ins (day, weight_kg, body_fat_pct, waist_cm, note, updated_ms) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (day) DO UPDATE SET weight_kg = excluded.weight_kg, body_fat_pct = excluded.body_fat_pct,
           waist_cm = excluded.waist_cm, note = CASE WHEN ? THEN excluded.note ELSE note END, updated_ms = excluded.updated_ms`,
      )
      .run(w.day, w.weight, w.bodyFat, w.waist, w.note ?? null, now, w.note === undefined ? 0 : 1);
    return weighInFromRow(this.db.prepare('SELECT * FROM weigh_ins WHERE day = ?').get(w.day) as WeighInRow);
  }

  deleteWeighIn(day: string): boolean {
    return this.db.prepare('DELETE FROM weigh_ins WHERE day = ?').run(day).changes > 0;
  }

  // Exercise ---------------------------------------------------------------

  private withSets(rows: WorkoutRow[]): Workout[] {
    if (!rows.length) return [];
    const sets = this.db
      .prepare(`SELECT * FROM workout_sets WHERE workout_id IN (${rows.map(() => '?').join()}) ORDER BY position, set_no, id`)
      .all(...rows.map((r) => r.id)) as SetRow[];
    return rows.map((r) => ({
      id: r.id,
      day: r.day,
      start: r.start_ms,
      name: r.name,
      kind: r.kind,
      minutes: r.minutes,
      calories: r.calories,
      note: r.note,
      source: r.source,
      externalId: r.external_id,
      planDayId: r.plan_day_id ?? null,
      sets: sets.filter((s) => s.workout_id === r.id).map(setFromRow),
    }));
  }

  workouts(day: string): Workout[] {
    return this.withSets(this.db.prepare('SELECT * FROM workouts WHERE day = ? ORDER BY COALESCE(start_ms, created_ms), id').all(day) as WorkoutRow[]);
  }

  workout(id: number): Workout | null {
    return this.withSets(this.db.prepare('SELECT * FROM workouts WHERE id = ?').all(id) as WorkoutRow[])[0] ?? null;
  }

  hasWorkout(source: string, externalId: string): boolean {
    return this.db.prepare('SELECT 1 FROM workouts WHERE source = ? AND external_id = ?').get(source, externalId) !== undefined;
  }

  addWorkout(w: NewWorkout, now = Date.now()): Workout {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO workouts (day, start_ms, name, kind, minutes, calories, note, source, external_id, plan_day_id, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(w.day, w.start, w.name, w.kind, w.minutes, w.calories, w.note, w.source, w.externalId, w.planDayId ?? null, now);
    return { id: Number(lastInsertRowid), ...w, planDayId: w.planDayId ?? null, sets: [] };
  }

  updateWorkout(id: number, change: WorkoutChange): Workout | null {
    const current = this.workout(id);
    if (!current) return null;
    const next = { ...current, ...change };
    this.db
      .prepare('UPDATE workouts SET name = ?, kind = ?, minutes = ?, calories = ?, note = ?, start_ms = ? WHERE id = ?')
      .run(next.name, next.kind, next.minutes, next.calories, next.note, next.start, id);
    return this.workout(id);
  }

  deleteWorkout(id: number): boolean {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM workout_sets WHERE workout_id = ?').run(id);
      this.db.prepare('DELETE FROM exercise_logs WHERE workout_id = ?').run(id);
      return this.db.prepare('DELETE FROM workouts WHERE id = ?').run(id).changes > 0;
    })();
  }

  /** Adds sets of one exercise to a workout, after any sets of it already there. */
  addSets(workoutId: number, exercise: string, sets: readonly NewSet[]): Workout | null {
    if (!this.workout(workoutId)) return null;
    this.db.transaction(() => {
      const same = this.db
        .prepare('SELECT MIN(position) AS position, MAX(set_no) AS setNo, MIN(exercise) AS name FROM workout_sets WHERE workout_id = ? AND exercise = ? COLLATE NOCASE')
        .get(workoutId, exercise) as { position: number | null; setNo: number | null; name: string | null };
      // More of an exercise already in the workout keeps the name it has there.
      if (same.name) exercise = same.name;
      const position = same.position ?? ((this.db.prepare('SELECT MAX(position) AS p FROM workout_sets WHERE workout_id = ?').get(workoutId) as { p: number | null }).p ?? 0) + 1;
      const insert = this.db.prepare(
        'INSERT INTO workout_sets (workout_id, position, exercise, set_no, reps, weight_kg, rpe, seconds, distance_m, flag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      sets.forEach((s, i) => insert.run(workoutId, position, exercise, (same.setNo ?? 0) + i + 1, s.reps, s.weight, s.rpe, s.seconds, s.distance, s.flag ?? null));
    })();
    return this.workout(workoutId);
  }

  /** Removes one set; the workout it was in, or null. */
  deleteSet(id: number): Workout | null {
    const row = this.db.prepare('SELECT workout_id FROM workout_sets WHERE id = ?').get(id) as { workout_id: number } | undefined;
    if (!row) return null;
    this.db.prepare('DELETE FROM workout_sets WHERE id = ?').run(id);
    return this.workout(row.workout_id);
  }

  /** The workout an earlier import saved under this id. */
  importedWorkout(source: string, externalId: string): Workout | null {
    return this.withSets(this.db.prepare('SELECT * FROM workouts WHERE source = ? AND external_id = ?').all(source, externalId) as WorkoutRow[])[0] ?? null;
  }

  /**
   * Saves imported workouts in one go: new ones are added, and one already imported
   * (`replaces`) takes the file's name, kind, minutes, calories, and sets. Its note stays
   * unless the file has one.
   */
  saveImported(list: readonly { workout: NewWorkout; exercises: { name: string; sets: NewSet[] }[]; replaces?: number | null }[], now = Date.now()): { added: number; updated: number } {
    return this.db.transaction(() => {
      let added = 0;
      let updated = 0;
      for (const { workout, exercises, replaces } of list) {
        let id: number;
        if (replaces) {
          this.db.prepare('DELETE FROM workout_sets WHERE workout_id = ?').run(replaces);
          this.db
            .prepare('UPDATE workouts SET name = ?, kind = ?, minutes = ?, calories = ?, start_ms = ?, note = COALESCE(?, note) WHERE id = ?')
            .run(workout.name, workout.kind, workout.minutes, workout.calories, workout.start, workout.note, replaces);
          id = replaces;
          updated++;
        } else {
          id = this.addWorkout(workout, now).id;
          added++;
        }
        for (const e of exercises) this.addSets(id, e.name, e.sets);
      }
      return { added, updated };
    })();
  }

  /** Sessions, minutes, and volume (reps × kg) per day, for days with a workout. */
  workoutTotalsBetween(from: string, to: string): { day: string; sessions: number; minutes: number; volume: number }[] {
    return this.db
      .prepare(
        `SELECT w.day, COUNT(*) AS sessions, COALESCE(SUM(w.minutes), 0) AS minutes,
           COALESCE(SUM((SELECT SUM(reps * weight_kg) FROM workout_sets s WHERE s.workout_id = w.id)), 0) AS volume
         FROM workouts w WHERE w.day BETWEEN ? AND ? GROUP BY w.day ORDER BY w.day`,
      )
      .all(from, to) as { day: string; sessions: number; minutes: number; volume: number }[];
  }

  /** Exercises done lately, most recent first, as last spelled. */
  recentExercises(limit = 12): string[] {
    return (
      this.db
        .prepare(
          `SELECT s.exercise, MAX(w.day || printf('%012d', s.id)) AS k FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
           GROUP BY LOWER(s.exercise) ORDER BY k DESC LIMIT ?`,
        )
        .all(limit) as { exercise: string }[]
    ).map((r) => r.exercise);
  }

  exerciseHistory(names: readonly string[]): ExerciseHistory[] {
    return names.flatMap((name) => {
      const rows = this.db
        .prepare(
          `SELECT s.*, w.day FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
           WHERE s.exercise = ? COLLATE NOCASE ORDER BY w.day, s.workout_id, s.set_no`,
        )
        .all(name) as (SetRow & { day: string })[];
      const last = rows.at(-1);
      if (!last) return [];
      let best: ExerciseHistory['best'] = null;
      for (const r of rows) {
        if (r.weight_kg !== null && (!best || r.weight_kg > best.weight || (r.weight_kg === best.weight && (r.reps ?? 0) > (best.reps ?? 0)))) {
          best = { weight: r.weight_kg, reps: r.reps, day: r.day };
        }
      }
      return [{
        exercise: last.exercise,
        best,
        lastDay: last.day,
        lastSets: rows.filter((r) => r.workout_id === last.workout_id).map((r) => plainSet(setFromRow(r))),
        times: new Set(rows.map((r) => r.workout_id)).size,
      }];
    });
  }

  // Training plan ----------------------------------------------------------

  planDays(): PlanDay[] {
    return this.db.prepare('SELECT id, name, position, note FROM plan_days ORDER BY position, id').all() as PlanDay[];
  }

  planExercises({ all = false } = {}): PlanExercise[] {
    const rows = this.db.prepare(`SELECT * FROM plan_exercises ${all ? '' : 'WHERE active = 1'} ORDER BY day_id, position, id`).all() as PlanExerciseRow[];
    const goals = this.db.prepare('SELECT plan_exercise_id AS id, day, weight_kg AS weight FROM exercise_goals ORDER BY day').all() as { id: number; day: string; weight: number }[];
    return rows.map((r) => {
      let aliases: string[] = [];
      try {
        const parsed = JSON.parse(r.aliases) as unknown;
        if (Array.isArray(parsed)) aliases = parsed.filter((a): a is string => typeof a === 'string');
      } catch {
        // A broken list is no aliases.
      }
      return {
        id: r.id, dayId: r.day_id, position: r.position, name: r.name, aliases, sets: r.sets, repMin: r.rep_min, repMax: r.rep_max, step: r.step_kg,
        laterSlot: r.later_slot === 1, perHand: r.per_hand === 1, perSide: r.per_side === 1, bodyweight: r.bodyweight === 1, note: r.note, active: r.active === 1,
        goals: goals.filter((g) => g.id === r.id).map(({ day, weight }) => ({ day, weight })),
      };
    });
  }

  planExercise(id: number): PlanExercise | null {
    return this.planExercises({ all: true }).find((e) => e.id === id) ?? null;
  }

  addPlanExercise(e: Omit<PlanExercise, 'id' | 'position' | 'active' | 'goals'> & { goals?: { day: string; weight: number }[] }, now = Date.now()): PlanExercise {
    return this.db.transaction(() => {
      const position = ((this.db.prepare('SELECT MAX(position) AS p FROM plan_exercises WHERE day_id = ?').get(e.dayId) as { p: number | null }).p ?? 0) + 1;
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO plan_exercises (day_id, position, name, aliases, sets, rep_min, rep_max, step_kg, later_slot, per_hand, per_side, bodyweight, note, active, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
        .run(e.dayId, position, e.name, JSON.stringify(e.aliases), e.sets, e.repMin, e.repMax, e.step, e.laterSlot ? 1 : 0, e.perHand ? 1 : 0, e.perSide ? 1 : 0, e.bodyweight ? 1 : 0, e.note, now);
      const id = Number(lastInsertRowid);
      for (const g of e.goals ?? []) this.setExerciseGoal(id, g.day, g.weight);
      return this.planExercise(id) as PlanExercise;
    })();
  }

  updatePlanExercise(id: number, change: PlanExerciseChange): PlanExercise | null {
    const current = this.planExercise(id);
    if (!current) return null;
    const e = { ...current, ...change };
    this.db
      .prepare('UPDATE plan_exercises SET day_id = ?, position = ?, name = ?, aliases = ?, sets = ?, rep_min = ?, rep_max = ?, step_kg = ?, later_slot = ?, per_hand = ?, per_side = ?, bodyweight = ?, note = ?, active = ? WHERE id = ?')
      .run(e.dayId, e.position, e.name, JSON.stringify(e.aliases), e.sets, e.repMin, e.repMax, e.step, e.laterSlot ? 1 : 0, e.perHand ? 1 : 0, e.perSide ? 1 : 0, e.bodyweight ? 1 : 0, e.note, e.active ? 1 : 0, id);
    return this.planExercise(id);
  }

  /** A goal weight at a checkpoint; null removes it. */
  setExerciseGoal(id: number, day: string, weight: number | null): void {
    if (weight === null) this.db.prepare('DELETE FROM exercise_goals WHERE plan_exercise_id = ? AND day = ?').run(id, day);
    else this.db.prepare('INSERT INTO exercise_goals (plan_exercise_id, day, weight_kg) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET weight_kg = excluded.weight_kg').run(id, day, weight);
  }

  checkpoints(): CheckpointDay[] {
    return this.db.prepare('SELECT day, label FROM checkpoints ORDER BY day').all() as CheckpointDay[];
  }

  setCheckpoint(day: string, label: string): void {
    this.db.prepare('INSERT INTO checkpoints (day, label) VALUES (?, ?) ON CONFLICT DO UPDATE SET label = excluded.label').run(day, label);
  }

  bodyGoals(): BodyGoal[] {
    return this.db.prepare('SELECT day, weight_kg AS weight, lean_kg AS lean FROM body_goals ORDER BY day').all() as BodyGoal[];
  }

  setBodyGoal(goal: BodyGoal): void {
    this.db.prepare('INSERT INTO body_goals (day, weight_kg, lean_kg) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET weight_kg = excluded.weight_kg, lean_kg = excluded.lean_kg').run(goal.day, goal.weight, goal.lean);
  }

  /** Every set done under any of these names (case aside), oldest first, with its workout. */
  trainingSets(names: readonly string[]): TrainingSet[] {
    if (!names.length) return [];
    const rows = this.db
      .prepare(
        `SELECT s.id AS setId, s.workout_id AS workoutId, w.day, w.plan_day_id AS planDayId, w.source, s.exercise, s.set_no AS setNo,
           s.reps, s.weight_kg AS weight, s.flag, COALESCE(l.form_reset, 0) AS formReset, l.note
         FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
         LEFT JOIN exercise_logs l ON l.workout_id = s.workout_id AND l.exercise = s.exercise
         WHERE LOWER(s.exercise) IN (${names.map(() => '?').join()})
         ORDER BY w.day, COALESCE(w.start_ms, w.created_ms), s.workout_id, s.position, s.set_no, s.id`,
      )
      .all(...names.map((n) => n.toLowerCase())) as (Omit<TrainingSet, 'formReset'> & { formReset: number })[];
    return rows.map((r) => ({ ...r, formReset: r.formReset === 1 }));
  }

  /** Every set of every strength workout, for the strength score (strength.ts). */
  strengthSets(): { day: string; exercise: string; weight: number | null; reps: number | null; flag: string | null }[] {
    return this.db
      .prepare(
        `SELECT w.day, s.exercise, s.weight_kg AS weight, s.reps, s.flag FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
         WHERE w.kind = 'strength' ORDER BY w.day, s.id`,
      )
      .all() as { day: string; exercise: string; weight: number | null; reps: number | null; flag: string | null }[];
  }

  /** A form reset or a note on one exercise in a workout. */
  setExerciseLog(workoutId: number, exercise: string, change: { formReset?: boolean; note?: string | null }): void {
    const current = this.db.prepare('SELECT form_reset, note FROM exercise_logs WHERE workout_id = ? AND exercise = ?').get(workoutId, exercise) as { form_reset: number; note: string | null } | undefined;
    const formReset = change.formReset ?? current?.form_reset === 1;
    const note = change.note !== undefined ? change.note : (current?.note ?? null);
    this.db
      .prepare('INSERT INTO exercise_logs (workout_id, exercise, form_reset, note) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET form_reset = excluded.form_reset, note = excluded.note')
      .run(workoutId, exercise, formReset ? 1 : 0, note);
  }

  /** The workout on a day done as a plan day, if there is one. */
  planWorkout(day: string, planDayId: number): Workout | null {
    return this.withSets(this.db.prepare('SELECT * FROM workouts WHERE day = ? AND plan_day_id = ? ORDER BY id LIMIT 1').all(day, planDayId) as WorkoutRow[])[0] ?? null;
  }

  /** Sets flagged as likely typos, newest first. */
  flaggedSets(): (WorkoutSet & { day: string; workoutId: number })[] {
    const rows = this.db
      .prepare("SELECT s.*, w.day FROM workout_sets s JOIN workouts w ON w.id = s.workout_id WHERE s.flag = 'outlier' ORDER BY w.day DESC, s.id")
      .all() as (SetRow & { day: string })[];
    return rows.map((r) => ({ ...setFromRow(r), day: r.day, workoutId: r.workout_id }));
  }

  /** 'kept' when a flagged set was right after all; 'outlier' flags it again. */
  setSetFlag(id: number, flag: string | null): boolean {
    return this.db.prepare('UPDATE workout_sets SET flag = ? WHERE id = ?').run(flag, id).changes > 0;
  }

  /** Days with a strength workout, and how many, between two days. */
  strengthDays(from: string, to: string): { day: string; sessions: number }[] {
    return this.db
      .prepare(`SELECT day, COUNT(*) AS sessions FROM workouts WHERE kind = 'strength' AND day BETWEEN ? AND ? AND EXISTS (SELECT 1 FROM workout_sets s WHERE s.workout_id = workouts.id) GROUP BY day ORDER BY day`)
      .all(from, to) as { day: string; sessions: number }[];
  }

  firstWorkoutDay(): string | null {
    return (this.db.prepare("SELECT MIN(day) AS d FROM workouts WHERE kind = 'strength'").get() as { d: string | null }).d;
  }

  // Settings and small bits of state ----------------------------------------

  get(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  close(): void {
    this.db.close();
  }
}
