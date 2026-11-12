import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Journal } from './journal.ts';
import { checkNewProject, checkReplan } from './projectPlan.ts';
import type { Progress, Target } from './projects.ts';
import { addDays, answered, daysBetween, neglectedFor, paceTo, planStatus, projectedFinish, projectFraction, subtaskFraction } from './projects.ts';
import { Store } from './store.ts';

describe('project logic', () => {
  it('works out sub-task and project progress, each sub-task counting the same', () => {
    assert.equal(subtaskFraction({ total: 120, done: 30 }), 0.25);
    assert.equal(subtaskFraction({ total: 10, done: 14 }), 1);
    assert.equal(subtaskFraction({ total: null, done: 1 }), 1);
    assert.equal(projectFraction([{ total: 120, done: 60 }, { total: null, done: 0 }]), 0.25);
    assert.equal(projectFraction([]), 0);
  });

  it('counts days across months and daylight saving', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(daysBetween('2026-03-28', '2026-04-02'), 5);
    assert.throws(() => addDays('2026-02-31', 1));
  });

  it('gives the pace to a due date, today included', () => {
    assert.deepEqual(paceTo({ total: 120, done: 96 }, '2026-11-21', '2026-11-10'), { remaining: 24, daysLeft: 12, perDay: 2 });
    assert.equal(paceTo({ total: 120, done: 96 }, '2026-11-01', '2026-11-10').perDay, null);
    assert.equal(paceTo({ total: 10, done: 10 }, '2026-11-20', '2026-11-10').perDay, null);
  });

  it('projects a finish date from the last week', () => {
    const p = (day: string, amount: number): Progress => ({ subtaskId: 1, day, amount });
    // 14 in the last 7 days = 2 a day; 10 left = 5 days.
    assert.equal(projectedFinish(10, [p('2026-11-04', 7), p('2026-11-10', 7), p('2026-11-01', 50)], '2026-11-10'), '2026-11-15');
    assert.equal(projectedFinish(10, [p('2026-11-01', 50)], '2026-11-10'), null);
    assert.equal(projectedFinish(0, [], '2026-11-10'), '2026-11-10');
  });

  it('flags only active projects gone quiet for long enough', () => {
    assert.equal(neglectedFor({ status: 'active' }, '2026-11-05', '2026-10-01', '2026-11-10', 3), 5);
    assert.equal(neglectedFor({ status: 'active' }, '2026-11-09', '2026-10-01', '2026-11-10', 3), null);
    assert.equal(neglectedFor({ status: 'paused' }, '2026-11-01', '2026-10-01', '2026-11-10', 3), null);
    assert.equal(neglectedFor({ status: 'active' }, null, '2026-11-06', '2026-11-10', 3), 4);
  });

  it('compares the plan with what was done, without counting today against you', () => {
    const t = (day: string, amount: number): Target => ({ subtaskId: 1, day, amount });
    const p = (day: string, amount: number): Progress => ({ subtaskId: 1, day, amount });
    const targets = [t('2026-11-08', 15), t('2026-11-09', 15), t('2026-11-10', 15), t('2026-11-11', 15)];

    const status = planStatus(targets, [p('2026-11-08', 15), p('2026-11-09', 5), p('2026-11-10', 10)], '2026-11-10');
    assert.deepEqual(status.days.map((d) => d.result), ['met', 'partly', 'pending', 'pending']);
    // Expected by now: 15 + 15 + the 10 done of today's 15. Done: 30. Behind by 10.
    assert.equal(status.ahead, -10);

    assert.equal(planStatus(targets, [p('2026-11-08', 15), p('2026-11-09', 15), p('2026-11-10', 20)], '2026-11-10').ahead, 5);
    assert.deepEqual(planStatus(targets, [], '2026-11-10').days.slice(0, 2).map((d) => d.result), ['missed', 'missed']);
  });
});

describe('checking a plan', () => {
  const today = '2026-11-10';

  it('accepts a full plan and warns about loose ends', () => {
    const result = checkNewProject(
      {
        name: ' Anatomy exam ',
        due: '2026-11-28',
        subtasks: [
          { title: 'Lecture slides', total: 120, unit: 'slides', due: '2026-11-20', targets: { '2026-11-11': 15, '2026-11-12': 15 } },
          { title: 'Summary sheet', due: '2026-11-30', targets: { '2026-11-27': 1 } },
        ],
      },
      today,
    );
    assert.ok(result.ok);
    assert.equal(result.plan.name, 'Anatomy exam');
    assert.equal(result.plan.subtasks[1]?.total, null);
    assert.ok(result.warnings.some((w) => w.includes('covers 30 of the 120 slides')));
    assert.ok(result.warnings.some((w) => w.includes('after the project')));
  });

  it('rejects past days, too much planned, and broken checkboxes', () => {
    const result = checkNewProject(
      {
        name: 'Exam',
        subtasks: [
          { title: 'Slides', total: 20, unit: 'slides', targets: { '2026-11-09': 5, '2026-11-11': 25 } },
          { title: 'Book', unit: 'pages' },
          { title: 'Tick', targets: { '2026-11-11': 2 } },
          { title: '' },
        ],
      },
      today,
    );
    assert.ok(!result.ok);
    const all = result.errors.join('\n');
    assert.match(all, /2026-11-09, it's in the past/);
    assert.match(all, /add up to 25, but only 20 slides left/);
    assert.match(all, /a unit needs a total/);
    assert.match(all, /checkbox, so its target/);
    assert.match(all, /Sub-task 4's title is missing/);
  });

  it('re-plans only what is left of existing sub-tasks', () => {
    const project = { due: '2026-11-28', subtasks: [{ id: 7, title: 'Slides', unit: null, total: 120, done: 100, due: null }] };
    assert.ok(checkReplan({ subtasks: [{ id: 7, targets: { '2026-11-11': 20 } }] }, today, project).ok);
    const tooMuch = checkReplan({ subtasks: [{ id: 7, targets: { '2026-11-11': 21 } }] }, today, project);
    assert.ok(!tooMuch.ok && tooMuch.errors[0]?.includes('only 20 left'));
    const missing = checkReplan({ subtasks: [{ id: 8, title: 'x' }] }, today, project);
    assert.ok(!missing.ok && missing.errors[0]?.includes('no sub-task 8'));
  });
});

describe('projects in the journal', () => {
  let dir: string;
  let journal: Journal;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-projects-'));
    journal = new Journal(join(dir, 'data.db'));
  });
  afterEach(() => {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('tracks progress per day and keeps counts honest', () => {
    const project = journal.addProject({ name: 'Anatomy exam', due: '2026-11-28' });
    const slides = journal.addSubtask(project.id, { title: 'Slides', total: 120, unit: 'slides' });
    assert.ok(slides);
    assert.equal(journal.addProgress(slides.id, '2026-11-09', 15)?.done, 15);
    assert.equal(journal.addProgress(slides.id, '2026-11-10', 10)?.done, 25);
    assert.equal(journal.addProgress(slides.id, '2026-11-10', -30), null);
    // The evening box sets the day's amount, replacing what was there.
    assert.equal(journal.setProgress(slides.id, '2026-11-10', 12)?.done, 27);
    assert.equal(journal.subtask(slides.id)?.done, 27);
    assert.deepEqual(journal.progressBetween('2026-11-10', '2026-11-10').map((p) => p.amount), [12]);
  });

  it('ticks checkboxes and refuses progress on them', () => {
    const project = journal.addProject({ name: 'Trip' });
    const book = journal.addSubtask(project.id, { title: 'Book the hotel', unit: 'ignored' });
    assert.ok(book);
    assert.equal(book.unit, null);
    assert.equal(journal.addProgress(book.id, '2026-11-10', 1), null);
    assert.equal(journal.setSubtaskDone(book.id, true, '2026-11-10', 500)?.doneAt, 500);
    assert.equal(journal.setSubtaskDone(book.id, true, '2026-11-10')?.done, 1);
    assert.equal(journal.setSubtaskDone(book.id, false, '2026-11-10')?.done, 0);
    assert.deepEqual(journal.progressBetween('2026-11-01', '2026-11-30'), []);
  });

  it('keeps daily notes and skips, a note clearing a skip', () => {
    const project = journal.addProject({ name: 'App' });
    assert.equal(journal.setProjectDay(project.id, '2026-11-10', { skipped: true })?.skipped, true);
    const day = journal.setProjectDay(project.id, '2026-11-10', { note: 'Wrote the login page' });
    assert.deepEqual(day, { projectId: project.id, day: '2026-11-10', note: 'Wrote the login page', skipped: false });
    assert.equal(journal.setProjectDay(999, '2026-11-10', { skipped: true }), null);
  });

  it('creates a whole plan at once and re-plans only the days ahead', () => {
    const checked = checkNewProject(
      {
        name: 'Anatomy exam',
        due: '2026-11-28',
        subtasks: [
          { title: 'Slides', total: 120, unit: 'slides', targets: { '2026-11-10': 15, '2026-11-11': 15 } },
          { title: 'Summary sheet', targets: { '2026-11-27': 1 } },
        ],
      },
      '2026-11-10',
    );
    assert.ok(checked.ok);
    const project = journal.createProjectFromPlan(checked.plan, '2026-11-10');
    const [slides, sheet] = journal.subtasks(project.id);
    assert.ok(slides && sheet);
    assert.equal(journal.targets(slides.id).length, 2);

    journal.addProgress(slides.id, '2026-11-10', 15);
    // The next day: re-plan from the 11th. The 10th's target and progress stay.
    journal.applyPlan(project.id, { subtasks: [{ id: slides.id, title: 'Slides', unit: 'slides', total: 120, due: null, targets: { '2026-11-12': 50 } }] }, '2026-11-11');
    assert.deepEqual(journal.targets(slides.id).map((t) => t.day), ['2026-11-10', '2026-11-12']);
    assert.equal(journal.subtask(slides.id)?.done, 15);

    const view = journal.projectOverview(project.id, '2026-11-10', 3);
    assert.ok(view);
    assert.equal(view.subtasks[0]?.todayTarget, 15);
    assert.equal(view.subtasks[0]?.plan?.days[0]?.result, 'met');
    assert.equal(view.lastWorked, '2026-11-10');
    assert.equal(view.fraction, 0.0625);
  });

  it('rolls a failing plan back completely', () => {
    const project = journal.addProject({ name: 'A' });
    const other = journal.addProject({ name: 'B' });
    const foreign = journal.addSubtask(other.id, { title: 'Not mine' });
    assert.ok(foreign);
    assert.throws(() =>
      journal.applyPlan(
        project.id,
        {
          due: '2026-12-01',
          subtasks: [
            { title: 'New', unit: null, total: null, due: null, targets: {} },
            { id: foreign.id, title: 'x', unit: null, total: null, due: null, targets: {} },
          ],
        },
        '2026-11-10',
      ),
    );
    assert.equal(journal.subtasks(project.id).length, 0);
    assert.equal(journal.project(project.id)?.due, null);
  });

  it('deletes a project with everything under it', () => {
    const project = journal.addProject({ name: 'Gone' });
    const s = journal.addSubtask(project.id, { title: 'S', total: 5 });
    assert.ok(s);
    journal.addProgress(s.id, '2026-11-10', 2);
    journal.setTargets(s.id, '2026-11-10', { '2026-11-11': 3 });
    journal.setProjectDay(project.id, '2026-11-10', { note: 'x' });
    assert.ok(journal.deleteProject(project.id));
    assert.equal(journal.subtask(s.id), null);
    assert.deepEqual(journal.progressBetween('2026-01-01', '2026-12-31'), []);
    assert.deepEqual(journal.targetsBetween('2026-01-01', '2026-12-31'), []);
    assert.deepEqual(journal.projectDaysBetween('2026-01-01', '2026-12-31'), []);
  });

  it('keeps sub-task counts when old history is purged', () => {
    const path = join(dir, 'data.db');
    const project = journal.addProject({ name: 'Long one' });
    const s = journal.addSubtask(project.id, { title: 'Pages', total: 300, unit: 'pages' });
    assert.ok(s);
    journal.addProgress(s.id, '2025-12-30', 40);
    journal.addProgress(s.id, '2026-01-05', 10);
    const store = new Store(path);
    store.purgeBefore(new Date(2026, 0, 1).getTime());
    store.close();
    assert.equal(journal.subtask(s.id)?.done, 50);
    assert.deepEqual(journal.progressBetween('2000-01-01', '2100-01-01').map((p) => p.day), ['2026-01-05']);
    assert.ok(journal.project(project.id));
  });
});

describe('projects in the evening, the reminder, and the week', () => {
  let dir: string;
  let journal: Journal;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-projects-week-'));
    journal = new Journal(join(dir, 'data.db'));
  });
  afterEach(() => {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const setUp = () => {
    const exam = journal.addProject({ name: 'Anatomy exam' }, new Date(2026, 10, 1).getTime());
    const slides = journal.addSubtask(exam.id, { title: 'Slides', total: 120, unit: 'slides' });
    const sheet = journal.addSubtask(exam.id, { title: 'Summary sheet' });
    const app = journal.addProject({ name: 'Side app' }, new Date(2026, 10, 1).getTime());
    assert.ok(slides && sheet);
    return { exam, slides, sheet, app };
  };

  it('asks only about active projects not answered yet', async () => {
    const { eveningProjectsLine, projectReminderToast } = await import('./service.ts');
    const { exam, slides, app } = setUp();
    journal.setTarget(slides.id, '2026-11-10', 15);
    const views = () => journal.projectOverviews('2026-11-10', 3, 'active');
    assert.equal(eveningProjectsLine(views()), 'What did you do on Anatomy exam and Side app?');
    const toast = projectReminderToast(views(), 'http://127.0.0.1/ui/#evening');
    assert.equal(toast?.title, 'Your projects today');
    assert.deepEqual(toast?.lines, ['What did you do today on Anatomy exam and Side app?', 'Planned today: 15 slides Slides']);

    journal.addProgress(slides.id, '2026-11-10', 10);
    journal.setProjectDay(app.id, '2026-11-10', { skipped: true });
    assert.equal(eveningProjectsLine(views()), null);
    assert.equal(projectReminderToast(views(), null), null);
    journal.updateProject(exam.id, { status: 'paused' });
    assert.equal(answered(journal.projectOverview(app.id, '2026-11-10', 3)!), true);
  });

  it('sums up each project over a week', async () => {
    const { weekProjects } = await import('./ui.ts');
    const { slides, sheet, app } = setUp();
    journal.addProgress(slides.id, '2026-11-08', 5); // the Sunday before: not this week
    journal.addProgress(slides.id, '2026-11-09', 15);
    journal.addProgress(slides.id, '2026-11-11', 20);
    journal.setSubtaskDone(sheet.id, true, '2026-11-11');
    journal.setTarget(slides.id, '2026-11-09', 15);
    journal.setTarget(slides.id, '2026-11-10', 15);
    journal.setTarget(slides.id, '2026-11-13', 15); // after "today": not counted yet
    journal.setProjectDay(app.id, '2026-11-10', { skipped: true });

    const week = weekProjects(journal, '2026-11-09', new Date(2026, 10, 12, 18).getTime());
    const exam = week.find((p) => p.name === 'Anatomy exam');
    assert.deepEqual(exam?.moved.map((m) => [m.title, m.amount]), [['Slides', 35], ['Summary sheet', 1]]);
    assert.equal(exam?.daysWorked, 2);
    assert.deepEqual([exam?.targetsMet, exam?.targetDays], [1, 2]);
    const side = week.find((p) => p.name === 'Side app');
    assert.deepEqual([side?.moved.length, side?.daysWorked, side?.daysSkipped], [0, 0, 1]);
    // A week before the projects existed shows none of them.
    assert.deepEqual(weekProjects(journal, '2026-10-19', new Date(2026, 10, 12).getTime()), []);
  });
});

describe('work done before tracking began', () => {
  let dir: string;
  let journal: Journal;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-projects-done-'));
    journal = new Journal(join(dir, 'data.db'));
  });
  afterEach(() => {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts toward the bar but not toward any day', () => {
    const p = journal.addProject({ name: 'Learn AWS' });
    const slides = journal.addSubtask(p.id, { title: 'Slides', total: 876, unit: 'slides', alreadyDone: 266 });
    assert.equal(slides?.done, 266);
    const view = journal.projectOverview(p.id, '2026-11-10', 3);
    assert.equal(view?.subtasks[0]?.doneToday, 0);
    assert.equal(view?.lastWorked, null);
    assert.deepEqual(journal.progressBetween('2000-01-01', '2100-01-01'), []);
  });

  it('is checked in a plan, and leaves only the rest to plan', () => {
    assert.ok(checkNewProject({ name: 'AWS', subtasks: [{ title: 'Slides', total: 876, unit: 'slides', done: 266, targets: { '2026-11-11': 610 } }] }, '2026-11-10').ok);
    const over = checkNewProject({ name: 'AWS', subtasks: [{ title: 'Slides', total: 876, unit: 'slides', done: 266, targets: { '2026-11-11': 611 } }] }, '2026-11-10');
    assert.ok(!over.ok && over.errors[0]?.includes('only 610 slides left'));
    assert.ok(!checkNewProject({ name: 'AWS', subtasks: [{ title: 'Tick', done: 1 }] }, '2026-11-10').ok);
  });
});
