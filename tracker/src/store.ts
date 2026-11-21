// SQLite persistence. Events are append-only apart from the newest row's end,
// which is why 'setEnd' can target MAX(id) and the store needs no extra state.
import Database from 'better-sqlite3';
import type { Activity, Op, OpenEvent, WindowInfo } from './merger.ts';
import { MACHINE_SWAPS, STANDING_CALF_RAISE, machineSwapSql } from './machineSwap.ts';
import { calfWorkSql } from './calfWork.ts';
import { seedSql } from './trainingSeed.ts';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE events (
    id           INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('window', 'idle')),
    start_ms     INTEGER NOT NULL,
    end_ms       INTEGER NOT NULL,
    duration_ms  INTEGER GENERATED ALWAYS AS (end_ms - start_ms) VIRTUAL,
    process_name TEXT,
    exe_path     TEXT,
    title        TEXT,
    CHECK (end_ms >= start_ms)
  );
  CREATE INDEX idx_events_start ON events (start_ms);
  CREATE INDEX idx_events_end ON events (end_ms);
  `,
  `
  ALTER TABLE events ADD COLUMN domain TEXT;
  ALTER TABLE events ADD COLUMN url TEXT;
  CREATE INDEX idx_events_domain ON events (domain);
  `,
  `
  ALTER TABLE events ADD COLUMN project TEXT;
  ALTER TABLE events ADD COLUMN language TEXT;
  ALTER TABLE events ADD COLUMN branch TEXT;
  CREATE INDEX idx_events_project ON events (project);
  `,
  // رقيب: sound playing alongside whatever is in front, and what you log yourself.
  `
  CREATE TABLE audio_events (
    id           INTEGER PRIMARY KEY,
    start_ms     INTEGER NOT NULL,
    end_ms       INTEGER NOT NULL,
    process_name TEXT NOT NULL,
    exe_path     TEXT,
    title        TEXT,
    domain       TEXT,
    CHECK (end_ms >= start_ms)
  );
  CREATE INDEX idx_audio_start ON audio_events (start_ms);
  CREATE INDEX idx_audio_end ON audio_events (end_ms);

  CREATE TABLE entries (
    id         INTEGER PRIMARY KEY,
    start_ms   INTEGER NOT NULL,
    end_ms     INTEGER NOT NULL,
    label      TEXT NOT NULL,
    category   TEXT,
    created_ms INTEGER NOT NULL,
    CHECK (end_ms > start_ms)
  );
  CREATE INDEX idx_entries_start ON entries (start_ms);

  CREATE TABLE tasks (
    id         INTEGER PRIMARY KEY,
    day        TEXT NOT NULL,
    text       TEXT NOT NULL,
    done_ms    INTEGER,
    created_ms INTEGER NOT NULL
  );
  CREATE INDEX idx_tasks_day ON tasks (day);

  CREATE TABLE reminders (
    id            INTEGER PRIMARY KEY,
    text          TEXT NOT NULL,
    schedule      TEXT NOT NULL,
    enabled       INTEGER NOT NULL DEFAULT 1,
    last_fired_ms INTEGER,
    created_ms    INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // How you felt (morning and evening), the day's goals, and each week's review.
  `
  CREATE TABLE checkins (
    id     INTEGER PRIMARY KEY,
    day    TEXT NOT NULL,
    part   TEXT NOT NULL CHECK (part IN ('morning', 'evening')),
    mood   INTEGER CHECK (mood BETWEEN 1 AND 5),
    energy INTEGER CHECK (energy BETWEEN 1 AND 5),
    note   TEXT,
    at_ms  INTEGER NOT NULL,
    UNIQUE (day, part)
  );

  CREATE TABLE goals (
    id         INTEGER PRIMARY KEY,
    day        TEXT NOT NULL,
    text       TEXT NOT NULL,
    result     TEXT CHECK (result IN ('met', 'partly', 'missed')),
    created_ms INTEGER NOT NULL
  );
  CREATE INDEX idx_goals_day ON goals (day);

  CREATE TABLE reviews (
    week       TEXT PRIMARY KEY,
    went_well  TEXT,
    to_change  TEXT,
    updated_ms INTEGER NOT NULL
  );
  `,
  // Projects: longer things you're working on, their sub-tasks, what you did on them
  // each day, and the plan (how much to do on which day). Children are deleted in code,
  // since foreign keys aren't enforced on these connections.
  `
  CREATE TABLE projects (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT,
    status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done')),
    due_day    TEXT,
    position   INTEGER NOT NULL,
    created_ms INTEGER NOT NULL
  );

  CREATE TABLE subtasks (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects (id),
    title      TEXT NOT NULL,
    unit       TEXT,
    total      INTEGER CHECK (total > 0),
    base       INTEGER NOT NULL DEFAULT 0, -- progress folded in from purged days
    done_ms    INTEGER,
    due_day    TEXT,
    position   INTEGER NOT NULL,
    created_ms INTEGER NOT NULL
  );
  CREATE INDEX idx_subtasks_project ON subtasks (project_id);

  CREATE TABLE progress (
    id         INTEGER PRIMARY KEY,
    subtask_id INTEGER NOT NULL REFERENCES subtasks (id),
    day        TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    created_ms INTEGER NOT NULL
  );
  CREATE INDEX idx_progress_subtask ON progress (subtask_id);
  CREATE INDEX idx_progress_day ON progress (day);

  CREATE TABLE project_days (
    project_id INTEGER NOT NULL REFERENCES projects (id),
    day        TEXT NOT NULL,
    note       TEXT,
    skipped    INTEGER NOT NULL DEFAULT 0,
    updated_ms INTEGER NOT NULL,
    PRIMARY KEY (project_id, day)
  );

  CREATE TABLE targets (
    subtask_id INTEGER NOT NULL REFERENCES subtasks (id),
    day        TEXT NOT NULL,
    amount     INTEGER NOT NULL CHECK (amount > 0),
    PRIMARY KEY (subtask_id, day)
  );
  `,
  // What was on top of each of the other screens, alongside the focused window.
  `
  CREATE TABLE screen_events (
    id           INTEGER PRIMARY KEY,
    start_ms     INTEGER NOT NULL,
    end_ms       INTEGER NOT NULL,
    screen       INTEGER NOT NULL,
    process_name TEXT NOT NULL,
    exe_path     TEXT,
    title        TEXT,
    domain       TEXT,
    CHECK (end_ms >= start_ms)
  );
  CREATE INDEX idx_screen_start ON screen_events (start_ms);
  CREATE INDEX idx_screen_end ON screen_events (end_ms);
  `,
  // The app holding the microphone, so time on a call isn't idle.
  `
  ALTER TABLE events ADD COLUMN call TEXT;
  `,
  // Words that make PC time count toward a project (a JSON list).
  `
  ALTER TABLE projects ADD COLUMN match_words TEXT;
  `,
  // The day's plan: blocks of time set the night before or in the morning, to hold
  // the day up against.
  `
  CREATE TABLE plan_blocks (
    id         INTEGER PRIMARY KEY,
    day        TEXT NOT NULL,
    start_ms   INTEGER NOT NULL,
    end_ms     INTEGER NOT NULL,
    label      TEXT NOT NULL,
    category   TEXT,
    created_ms INTEGER NOT NULL,
    CHECK (end_ms > start_ms)
  );
  CREATE INDEX idx_plan_day ON plan_blocks (day);
  `,
  // Health: what you ate each day, and your weight and body measurements (one a day).
  `
  CREATE TABLE food_entries (
    id         INTEGER PRIMARY KEY,
    day        TEXT NOT NULL,
    meal       TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
    name       TEXT NOT NULL,
    calories   REAL,
    protein_g  REAL,
    carbs_g    REAL,
    fat_g      REAL,
    created_ms INTEGER NOT NULL
  );
  CREATE INDEX idx_food_day ON food_entries (day);

  CREATE TABLE weigh_ins (
    day          TEXT PRIMARY KEY,
    weight_kg    REAL NOT NULL CHECK (weight_kg > 0),
    body_fat_pct REAL,
    waist_cm     REAL,
    updated_ms   INTEGER NOT NULL
  );
  `,
  // Exercise: workouts, logged by hand or imported (Caliber), and the sets in each.
  // An import names each workout by the app's own id, so importing again adds nothing twice.
  `
  CREATE TABLE workouts (
    id          INTEGER PRIMARY KEY,
    day         TEXT NOT NULL,
    start_ms    INTEGER,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'strength',
    minutes     REAL,
    calories    REAL,
    note        TEXT,
    source      TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    created_ms  INTEGER NOT NULL
  );
  CREATE INDEX idx_workouts_day ON workouts (day);
  CREATE UNIQUE INDEX idx_workouts_external ON workouts (source, external_id) WHERE external_id IS NOT NULL;

  CREATE TABLE workout_sets (
    id         INTEGER PRIMARY KEY,
    workout_id INTEGER NOT NULL REFERENCES workouts (id),
    position   INTEGER NOT NULL,
    exercise   TEXT NOT NULL,
    set_no     INTEGER NOT NULL,
    reps       INTEGER,
    weight_kg  REAL,
    rpe        REAL,
    seconds    REAL,
    distance_m REAL
  );
  CREATE INDEX idx_sets_workout ON workout_sets (workout_id);
  CREATE INDEX idx_sets_exercise ON workout_sets (exercise COLLATE NOCASE);
  `,
  // The training plan: days of a split, the exercises in each (in order, with sets, rep
  // range, weight step, and whether it comes after a muscle was already worked), a goal
  // weight per exercise at each checkpoint, and bodyweight targets. Seeded once from
  // trainingSeed.ts, then edited here. Per exercise in a workout: a form reset and a note.
  // A set can be flagged as a likely typo (an import's 125 kg among 12.5 kg sets).
  `
  CREATE TABLE plan_days (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    position INTEGER NOT NULL,
    note     TEXT
  );

  CREATE TABLE plan_exercises (
    id         INTEGER PRIMARY KEY,
    day_id     INTEGER NOT NULL REFERENCES plan_days (id),
    position   INTEGER NOT NULL,
    name       TEXT NOT NULL,
    aliases    TEXT NOT NULL DEFAULT '[]',
    sets       INTEGER NOT NULL CHECK (sets BETWEEN 1 AND 10),
    rep_min    INTEGER NOT NULL CHECK (rep_min >= 1),
    rep_max    INTEGER NOT NULL CHECK (rep_max >= rep_min),
    step_kg    REAL NOT NULL CHECK (step_kg > 0),
    later_slot INTEGER NOT NULL DEFAULT 0,
    per_hand   INTEGER NOT NULL DEFAULT 0,
    bodyweight INTEGER NOT NULL DEFAULT 0,
    note       TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_ms INTEGER NOT NULL
  );
  CREATE INDEX idx_plan_exercises_day ON plan_exercises (day_id);

  CREATE TABLE checkpoints (
    day   TEXT PRIMARY KEY,
    label TEXT NOT NULL
  );

  CREATE TABLE exercise_goals (
    plan_exercise_id INTEGER NOT NULL REFERENCES plan_exercises (id),
    day              TEXT NOT NULL,
    weight_kg        REAL NOT NULL,
    PRIMARY KEY (plan_exercise_id, day)
  );

  CREATE TABLE body_goals (
    day       TEXT PRIMARY KEY,
    weight_kg REAL NOT NULL,
    lean_kg   REAL
  );

  CREATE TABLE exercise_logs (
    workout_id INTEGER NOT NULL REFERENCES workouts (id),
    exercise   TEXT NOT NULL COLLATE NOCASE,
    form_reset INTEGER NOT NULL DEFAULT 0,
    note       TEXT,
    PRIMARY KEY (workout_id, exercise)
  );

  ALTER TABLE workouts ADD COLUMN plan_day_id INTEGER;
  ALTER TABLE workout_sets ADD COLUMN flag TEXT;
  ALTER TABLE weigh_ins ADD COLUMN note TEXT;

  ${seedSql(Date.now())}
  `,
  // The gym's machines replace three lifts (see machineSwap.ts): weights can be per side of a
  // plate-loaded machine, and the old lifts are archived, never deleted, so their history stays.
  `
  ALTER TABLE plan_exercises ADD COLUMN per_side INTEGER NOT NULL DEFAULT 0;
  ${machineSwapSql(Date.now())}
  `,
  // When a set was logged (ms), as the gym app records it: the time between sets comes from it.
  `
  ALTER TABLE workout_sets ADD COLUMN logged_ms INTEGER;
  `,
  // What you learned each day, in your own words.
  `
  CREATE TABLE learnings (
    day        TEXT PRIMARY KEY,
    text       TEXT NOT NULL,
    updated_ms INTEGER NOT NULL
  );
  `,
  // Proposed plans for a week (aims, and each day's aims and blocks), waiting to be looked
  // over, and the aims for a week you took from one.
  `
  CREATE TABLE proposals (
    id         INTEGER PRIMARY KEY,
    week       TEXT NOT NULL,
    body       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('waiting', 'applied', 'discarded', 'replaced')),
    choice     TEXT,
    created_ms INTEGER NOT NULL,
    decided_ms INTEGER
  );
  CREATE INDEX idx_proposals_week ON proposals (week);

  CREATE TABLE week_aims (
    id         INTEGER PRIMARY KEY,
    week       TEXT NOT NULL,
    position   INTEGER NOT NULL,
    text       TEXT NOT NULL,
    how        TEXT,
    result     TEXT CHECK (result IN ('met', 'partly', 'missed')),
    created_ms INTEGER NOT NULL
  );
  CREATE INDEX idx_week_aims_week ON week_aims (week);
  `,
  // A time slot logged for you from a session finished in the gym app: the workout it came
  // from, so syncing again moves the slot instead of adding a second one.
  `
  ALTER TABLE entries ADD COLUMN workout_id INTEGER;
  CREATE UNIQUE INDEX idx_entries_workout ON entries (workout_id) WHERE workout_id IS NOT NULL;
  `,
  // The hip thrust machine takes the Smith machine hip thrust's place in the plan and its
  // history, which the old app logged under that name (see machineSwap.ts).
  `
  ${machineSwapSql(Date.now(), MACHINE_SWAPS.filter((s) => s.renameHistory))}
  `,
  // ...and the single-leg thrusts that were really that machine, one side logged (machineSwap.ts).
  `
  ${machineSwapSql(Date.now(), MACHINE_SWAPS.filter((s) => s.standIns?.length))}
  `,
  // The standing calf machine replaces the dumbbell single-leg calf raise (its history keeps
  // the dumbbell's name), and the seated calf machine and a tibialis raise follow it (calfWork.ts).
  `
  ${machineSwapSql(Date.now(), MACHINE_SWAPS.filter((s) => s.exercise.name === STANDING_CALF_RAISE))}
  ${calfWorkSql(Date.now())}
  `,
];

/** Brings a database up to the newest schema. Safe to call from several connections. */
export function migrate(db: Database.Database): void {
  db.transaction(() => {
    const version = db.pragma('user_version', { simple: true }) as number;
    for (let v = version; v < MIGRATIONS.length; v++) db.exec(MIGRATIONS[v] as string);
    db.pragma(`user_version = ${Math.max(version, MIGRATIONS.length)}`);
  }).immediate();
}

/** Optional detail columns, named the same in the table and on Activity. */
const DETAIL_COLUMNS = ['domain', 'url', 'project', 'language', 'branch', 'call'] as const;
type DetailColumn = (typeof DETAIL_COLUMNS)[number];

export interface StoredEvent extends OpenEvent {
  id: number;
}

export type EventRow = {
  id: number;
  kind: 'window' | 'idle';
  start_ms: number;
  end_ms: number;
  process_name: string | null;
  exe_path: string | null;
  title: string | null;
} & Record<DetailColumn, string | null>;

function windowFromRow(row: EventRow): WindowInfo {
  const window: WindowInfo = {
    processName: row.process_name ?? 'unknown',
    exePath: row.exe_path,
    title: row.title ?? '',
  };
  for (const column of DETAIL_COLUMNS) {
    // undefined when reading a database older than this column.
    const value = row[column];
    if (value !== null && value !== undefined) window[column] = value;
  }
  return window;
}

export function fromRow(row: EventRow): StoredEvent {
  let activity: Activity;
  if (row.kind === 'window') activity = { kind: 'window', ...windowFromRow(row) };
  // Idle rows carry the window that was in front, if there was one.
  else activity = row.process_name === null ? { kind: 'idle' } : { kind: 'idle', window: windowFromRow(row) };
  return { id: row.id, activity, start: row.start_ms, end: row.end_ms };
}

function windowColumns(window: WindowInfo | undefined): unknown[] {
  if (!window) return [null, null, null, ...DETAIL_COLUMNS.map(() => null)];
  return [window.processName, window.exePath, window.title, ...DETAIL_COLUMNS.map((column) => window[column] ?? null)];
}

export class Store {
  private readonly db: Database.Database;
  private readonly applyTransaction: (ops: Op[]) => void;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    // Overwrite deleted rows with zeros so purged data is really gone.
    this.db.pragma('secure_delete = ON');
    this.migrate();

    const setEnd = this.db.prepare(
      'UPDATE events SET end_ms = ? WHERE id = (SELECT MAX(id) FROM events)',
    );
    const insert = this.db.prepare(
      `INSERT INTO events (kind, start_ms, end_ms, process_name, exe_path, title, ${DETAIL_COLUMNS.join(', ')})
       VALUES (?, ?, ?, ?, ?, ?, ${DETAIL_COLUMNS.map(() => '?').join(', ')})`,
    );
    this.applyTransaction = this.db.transaction((ops: Op[]) => {
      for (const op of ops) {
        if (op.type === 'setEnd') {
          setEnd.run(op.end);
        } else if (op.activity.kind === 'idle') {
          insert.run('idle', op.start, op.end, ...windowColumns(op.activity.window));
        } else {
          const { kind: _kind, ...window } = op.activity;
          insert.run('window', op.start, op.end, ...windowColumns(window));
        }
      }
    });
  }

  private migrate(): void {
    migrate(this.db);
  }

  apply(ops: Op[]): void {
    if (ops.length > 0) this.applyTransaction(ops);
  }

  lastEvent(): StoredEvent | null {
    const row = this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 1').get() as
      | EventRow
      | undefined;
    return row ? fromRow(row) : null;
  }

  /** Newest first. */
  recent(limit: number): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?')
      .all(limit) as EventRow[];
    return rows.map(fromRow);
  }

  /**
   * Deletes events, background audio, other screens, and your logged entries that ended before
   * the cutoff, and tasks, check-ins, goals, day plans, weekly reviews, what you learned, week aims and proposals, and project history
   * (progress, notes, targets) for days before it, then reclaims the file space.
   * Returns how many events went.
   */
  purgeBefore(cutoffMs: number): number {
    const day = new Date(cutoffMs).toLocaleDateString('en-CA');
    const { changes, others } = this.db.transaction(() => {
      // Projects and their sub-tasks stay (they may still be going); their daily history
      // goes, with the purged progress folded into each sub-task's base so counts don't drop.
      this.db
        .prepare(
          `UPDATE subtasks SET base = base + (SELECT SUM(amount) FROM progress p WHERE p.subtask_id = subtasks.id AND p.day < ?)
           WHERE id IN (SELECT subtask_id FROM progress WHERE day < ?)`,
        )
        .run(day, day);
      return {
        changes: this.db.prepare('DELETE FROM events WHERE end_ms < ?').run(cutoffMs).changes,
        others:
          this.db.prepare('DELETE FROM audio_events WHERE end_ms < ?').run(cutoffMs).changes +
          this.db.prepare('DELETE FROM screen_events WHERE end_ms < ?').run(cutoffMs).changes +
          this.db.prepare('DELETE FROM entries WHERE end_ms < ?').run(cutoffMs).changes +
          this.db.prepare('DELETE FROM tasks WHERE day < ?').run(day).changes +
          this.db.prepare('DELETE FROM checkins WHERE day < ?').run(day).changes +
          this.db.prepare('DELETE FROM goals WHERE day < ?').run(day).changes +
          this.db.prepare('DELETE FROM plan_blocks WHERE day < ?').run(day).changes +
          this.db.prepare('DELETE FROM reviews WHERE week < ?').run(day).changes +
          this.db.prepare('DELETE FROM learnings WHERE day < ?').run(day).changes +
          this.db.prepare('DELETE FROM week_aims WHERE week < ?').run(day).changes +
          this.db.prepare('DELETE FROM proposals WHERE week < ?').run(day).changes +
          this.db.prepare('DELETE FROM progress WHERE day < ?').run(day).changes +
          this.db.prepare('DELETE FROM project_days WHERE day < ?').run(day).changes +
          this.db.prepare('DELETE FROM targets WHERE day < ?').run(day).changes,
      };
    })();
    if (changes + others > 0) {
      this.db.exec('VACUUM');
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    }
    return changes;
  }

  close(): void {
    this.db.close();
  }
}
