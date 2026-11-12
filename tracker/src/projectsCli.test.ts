import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { runJournalCommand } from './journalCli.ts';
import { dayKey } from './planner.ts';
import { bar, parseAmount } from './projectsCli.ts';
import { addDays } from './projects.ts';

describe('project command helpers', () => {
  it('draws bars and reads amounts', () => {
    assert.equal(bar(0.5, 8), '████░░░░');
    assert.equal(bar(2, 4), '████');
    assert.deepEqual(parseAmount('+15'), { set: false, amount: 15 });
    assert.deepEqual(parseAmount('15'), { set: false, amount: 15 });
    assert.deepEqual(parseAmount('-3'), { set: false, amount: -3 });
    assert.deepEqual(parseAmount('=0'), { set: true, amount: 0 });
    assert.throws(() => parseAmount('lots'));
    assert.throws(() => parseAmount('+0'));
  });
});

describe('project commands', () => {
  let dir: string;
  let out: string[];
  let errors: string[];
  const original = { log: console.log, error: console.error, home: process.env['ACTIVITY_TRACKER_HOME'] };
  const run = async (...args: string[]) => {
    out = [];
    errors = [];
    const code = await runJournalCommand(args[0] as string, args.slice(1));
    return { code, text: out.join('\n'), error: errors.join('\n') };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-projects-cli-'));
    process.env['ACTIVITY_TRACKER_HOME'] = dir;
    console.log = (...a: unknown[]) => void out.push(a.join(' '));
    console.error = (...a: unknown[]) => void errors.push(a.join(' '));
  });
  afterEach(() => {
    console.log = original.log;
    console.error = original.error;
    if (original.home === undefined) delete process.env['ACTIVITY_TRACKER_HOME'];
    else process.env['ACTIVITY_TRACKER_HOME'] = original.home;
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds a project, sub-tasks, and progress', async () => {
    assert.match((await run('project', 'add', 'Anatomy exam')).text, /#1 {2}Anatomy exam/);
    assert.match((await run('sub', 'add', '1', 'Lecture slides', '--total', '120', '--unit', 'slides')).text, /0 \/ 120 slides/);
    await run('sub', 'add', '1', 'Summary sheet');
    assert.match((await run('progress', '1', '+30')).text, /30 \/ 120 slides/);
    assert.match((await run('progress', '1', '=12')).text, /12 \/ 120 slides/);
    assert.match((await run('sub', 'done', '2')).text, /Summary sheet {2}\[x\]/);
    const list = await run('projects');
    // (12/120 + 1) / 2 = 55%
    assert.match(list.text, /55%/);
    assert.match(list.text, /\+12 slides, ticked "Summary sheet"/);
  });

  it('explains mistakes instead of failing', async () => {
    await run('project', 'add', 'Trip');
    await run('sub', 'add', '1', 'Book hotel');
    assert.match((await run('progress', '1', '+3')).error, /checkbox: use raqib sub done 1/);
    assert.match((await run('progress', '9', '+3')).error, /no sub-task #9/);
    assert.match((await run('sub', 'add', '1', 'Pages', '--unit', 'pages')).error, /A unit needs a total/);
    assert.equal((await run('project', 'show', '5')).code, 1);
  });

  it('saves a note or a skip for the day', async () => {
    await run('project', 'add', 'App');
    assert.match((await run('project', 'note', '1', 'Wrote the login page')).text, /"Wrote the login page"/);
    await run('project', 'skip', '1', '--date', 'yesterday');
    assert.match((await run('projects', '--date', 'yesterday')).text, /nothing \(skipped\)/);
  });

  it('creates a planned project from a file, and checks it first with --dry-run', async () => {
    const today = dayKey(Date.now());
    const file = join(dir, 'plan.json');
    writeFileSync(
      file,
      JSON.stringify({
        name: 'Anatomy exam',
        due: addDays(today, 10),
        subtasks: [
          { title: 'Lecture slides', total: 40, unit: 'slides', targets: { [today]: 20, [addDays(today, 1)]: 20 } },
          { title: 'Summary sheet', targets: { [addDays(today, 2)]: 1 } },
        ],
      }),
    );
    const dry = await run('project', 'create', '--file', file, '--dry-run');
    assert.match(dry.text, /2 sub-task\(s\) and 3 planned day\(s\)\. Nothing saved/);
    assert.match((await run('projects')).text, /No projects yet/);

    const created = await run('project', 'create', '--file', file);
    assert.equal(created.code, 0);
    assert.match(created.text, /Plan/);
    assert.match(created.text, /0 \/ 20 {2}← today/);
    await run('progress', '1', '+20');
    assert.match((await run('targets')).text, /\[x\] Anatomy exam · Lecture slides {2}#1 {2}20 \/ 20 slides/);
  });

  it('refuses a bad plan without saving any of it', async () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({ name: 'X', subtasks: [{ title: 'S', total: 5, targets: { '2000-01-01': 2 } }] }));
    const result = await run('project', 'create', '--file', file);
    assert.equal(result.code, 1);
    assert.match(result.error, /nothing was saved[\s\S]*in the past/);
    writeFileSync(file, '{ not json');
    assert.match((await run('project', 'create', '--file', file)).error, /isn't valid JSON/);
  });

  it('re-plans an existing project from today on', async () => {
    const today = dayKey(Date.now());
    await run('project', 'add', 'Book');
    await run('sub', 'add', '1', 'Pages', '--total', '100', '--unit', 'pages');
    await run('progress', '1', '+40');
    const file = join(dir, 'replan.json');
    writeFileSync(file, JSON.stringify({ due: addDays(today, 5), subtasks: [{ id: 1, targets: { [addDays(today, 1)]: 30, [addDays(today, 2)]: 30 } }, { title: 'Review notes' }] }));
    const result = await run('project', 'plan', '1', '--file', file);
    assert.equal(result.code, 0, result.error);
    assert.match(result.text, /40 \/ 100 pages/);
    assert.match(result.text, /Review notes/);
    writeFileSync(file, JSON.stringify({ subtasks: [{ id: 1, targets: { [addDays(today, 1)]: 61 } }] }));
    assert.match((await run('project', 'plan', '1', '--file', file)).error, /only 60 pages left/);
  });
});
