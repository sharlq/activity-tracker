# Plan: Projects in رقيب

Projects are the longer things going on in your life (an exam, a side project, a debate
tournament, learning a language). They last weeks or months, unlike tasks (one day) and goals
(one day). Each project has **sub-tasks**, and a sub-task can be **measured** ("Study 120
slides", with a progress bar) or just **done or not done** ("Book the venue"). Every day رقيب
asks what you did on each active project, so none of them slips your mind.

## What you'll see

### 1. A new Projects page (`raqib open projects`)

```
Anatomy exam                              ██████████░░░░░░░░  54%   due Nov 28
  Lecture slides   ████████████░░░░  96 / 120 slides
  Past papers      ████░░░░░░░░░░░░   2 / 8 papers
  Summary sheet    ✓ done
  Last worked on: today · "Finished chapter 6 slides"

Side project app                          ███░░░░░░░░░░░░░░░  15%
  ⚠ Not touched in 5 days
```

- Add, rename, pause, finish, or delete a project. Optional deadline and colour.
- Add sub-tasks: a title, plus an optional **total and unit** (120 slides, 300 pages,
  8 chapters, 20 problems). Without a total it's a checkbox.
- Each sub-task has its own progress bar; the project's bar is the average of its
  sub-tasks (each sub-task counts the same, whatever its unit).
- Open a project to see its history: what you did on it each day.

### 2. The daily question: "What did you do today on each project?"

A new section in the **evening log** (22:00), before the tasks:

```
Your projects
  Anatomy exam
    Lecture slides   96 / 120   [ +  ] slides today      ← type 15, bar moves to 111
    Past papers       2 / 8     [ +  ] papers today
    What did you do?  [ Finished chapter 6 slides........ ]
    [ Nothing today ]
```

- One row per active project (paused and finished ones are left out).
- Typing a number adds that many to the sub-task; ticking a checkbox sub-task marks it done.
- **Nothing today** records a deliberate skip, so it doesn't count as forgotten.
- Answers are saved per day, so you can go back and fix a past day.

### 3. Reminders so nothing is forgotten

- **Daily nudge:** the evening notification mentions projects ("3 projects to update").
  Optionally a separate daily project reminder at a time you choose (Settings), for days you
  skip the evening log.
- **Morning page:** a small "Projects" card: progress bars, plus a warning for any active
  project with no update for 3 days or more (configurable), e.g. "You haven't touched
  *Side project app* in 5 days".
- **Pace (if a deadline is set):** "24 slides left, 18 days to go → about 2 a day", and "at
  your pace this week you'll finish on Nov 25" (or "you're behind").

### 4. Claude can create and plan a project for you

You tell Claude about something new ("I have an anatomy exam on Nov 28: 6 chapters, about
120 slides, plus 8 past papers"), and Claude:

1. **Asks what it needs:** the deadline, what the material is (slides, pages, chapters),
   how much time you have on a normal day, and days you can't work (it can also check your
   recent focus time in رقيب to keep the plan realistic).
2. **Suggests a breakdown in chat:** the sub-tasks with totals and units, milestone dates
   ("slides done by Nov 20, then past papers"), and a daily schedule ("Mon–Thu: 15 slides a
   day; Fri off; weekend: 2 past papers"). It leaves a buffer of a day or two before the
   deadline.
3. **Creates it in one go** once you say yes: the project, all sub-tasks, milestone dates,
   and the daily targets.
4. **Re-plans when you fall behind or get ahead:** "plan my anatomy again" spreads what's
   left over the days remaining, and never changes what you've already done.

The plan then shows up everywhere:

- **Morning page:** "Today's targets: Anatomy · 15 slides · Past papers · 1 paper".
- **Evening log:** each row shows today's target next to what you did ("12 of 15 slides").
- **Projects page:** a "Plan" tab per project listing the days ahead, with targets met
  (green), partly met (amber), or missed (grey), and a line showing ahead or behind.
- Claude can also add today's targets to the day's **tasks**, if you want them as to-dos.

### 5. Weekly review

A Projects block in the Week page: what moved this week per project (e.g. "+64 slides, +3
papers"), days worked on each, and projects that weren't touched all week.

## How it's built

### Database (new migration in `tracker/src/store.ts`)

```sql
CREATE TABLE projects (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done')),
  due_day    TEXT,                 -- YYYY-MM-DD, optional
  position   INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
);

CREATE TABLE subtasks (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  unit       TEXT,                 -- 'slides', 'pages'...; NULL = checkbox
  total      INTEGER CHECK (total > 0),
  done_ms    INTEGER,              -- for checkbox sub-tasks
  due_day    TEXT,                 -- milestone date, optional
  position   INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
);

-- One row per thing you reported. Progress = SUM(amount), so the history is never lost
-- and the week can say "+64 slides this week".
CREATE TABLE progress (
  id         INTEGER PRIMARY KEY,
  subtask_id INTEGER NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  amount     INTEGER NOT NULL,     -- can be negative, to correct a mistake
  created_ms INTEGER NOT NULL
);
CREATE INDEX idx_progress_day ON progress (day);

-- The daily answer per project: a note, or a deliberate "nothing today".
CREATE TABLE project_days (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  note       TEXT,
  skipped    INTEGER NOT NULL DEFAULT 0,
  updated_ms INTEGER NOT NULL,
  PRIMARY KEY (project_id, day)
);
```

```sql
-- The plan: how much of a sub-task to do on a given day. Written by Claude (or edited on
-- the Projects page); compared with `progress` for "12 of 15 slides" and ahead/behind.
CREATE TABLE targets (
  subtask_id INTEGER NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),  -- 1 for a checkbox sub-task
  PRIMARY KEY (subtask_id, day)
);
```

`purge --before` deletes `progress`, `project_days`, and `targets` rows before the date, but
keeps the projects and sub-tasks themselves (they're still going). Purged progress is folded
into each sub-task's `base` column first, so "96 / 120 slides" never drops.

**Status:** all five steps are built. The project reminder is off by default (Settings), since
the evening log already asks; the evening notification names unanswered projects.

### Code

| Where | What |
| --- | --- |
| `tracker/src/projects.ts` (new) | Pure logic: percentages, project average, "last touched", neglected list, pace and projected finish. Fully unit-tested. |
| `tracker/src/journal.ts` | CRUD for projects, sub-tasks, progress, and daily notes. |
| `tracker/src/ui.ts` | API routes: list, create, update, delete, report today's progress. |
| `tracker/ui/app.js`, `style.css` | Projects page; "Your projects" section in the evening log; card on the morning page; block in the week page. |
| `tracker/src/planner.ts` + `service.ts` | Optional daily project reminder and the project count in the evening toast; settings for reminder time and neglect threshold. |
| `tracker/src/journalCli.ts` | Commands (below). |
| `tracker/src/projectPlan.ts` (new) | Checks a plan file (dates, totals, targets that add up to no more than what's left, sub-tasks that exist), and works out ahead/behind. Unit-tested. |
| `.claude/skills/raqib/SKILL.md` | Teach Claude to ask about each project when logging the day, to add progress from what you say ("I did 20 slides of anatomy"), and a new **Planning a project** section: the questions to ask, how to size daily targets from your real free time, always showing the plan and waiting for your yes before `project create`, running `--dry-run` first, and re-planning only future days. |
| `README.md` | Document it. |

### Commands

```
projects                                         list with progress bars
project add "Anatomy exam" [--due 2026-11-28]
project pause|resume|done|rm <id>
sub add <projectId> "Lecture slides" --total 120 --unit slides
sub add <projectId> "Summary sheet"              (checkbox)
sub done|undo|rm <subId>
progress <subId> +15 [--date D]                  add slides/pages done
project note <id> "Finished chapter 6" [--date D]
project skip <id> [--date D]                     "nothing today"

project show <id> [--json]                       everything: sub-tasks, progress, plan, ahead/behind
project create --file plan.json [--dry-run]      create project + sub-tasks + targets in one step
project plan <id> --file plan.json [--dry-run]   replace future targets (past days untouched)
targets [date] [--json]                          the day's targets across all projects
```

`project create` and `project plan` take one JSON file, so Claude writes the whole plan at
once and it's saved in a single transaction (all or nothing). `--dry-run` checks it and
prints what would be created, without saving anything:

```json
{
  "name": "Anatomy exam",
  "due": "2026-11-28",
  "subtasks": [
    { "title": "Lecture slides", "total": 120, "unit": "slides", "due": "2026-11-20",
      "targets": { "2026-11-11": 15, "2026-11-12": 15, "2026-11-13": 15 } },
    { "title": "Past papers", "total": 8, "unit": "papers", "due": "2026-11-26" },
    { "title": "Summary sheet", "due": "2026-11-27", "targets": { "2026-11-27": 1 } }
  ]
}
```

## Build order

1. **Data and logic:** migration, `projects.ts`, journal methods, tests.
2. **Commands and Claude planning:** CLI including `project create` / `project plan`, and
   the skill update. From here you can already plan projects with Claude in chat.
3. **Projects page:** the list, progress bars, editing, the Plan tab.
4. **Daily question:** the evening-log section with targets, the morning card with
   today's targets, neglect warnings.
5. **Reminders and pace:** optional daily reminder, deadline pace, week-page block.

Each step ends with `npm run build` and `npm test` passing.

## Decisions to confirm

1. **Where the daily question goes:** inside the evening log (proposed), a separate daily
   reminder at its own time, or both.
2. **Project bar:** average of sub-tasks with equal weight (proposed), or weight by size.
3. **Neglect warning:** after 3 days without an update (proposed)?
4. **Deadlines and pace:** include in the first version, or later?
5. **Claude's plans:** should daily targets also be added to the day's tasks automatically,
   or only when you ask (proposed)?
