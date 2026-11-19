import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Journal } from './journal.ts';
import type { WeekProposal } from './weekPlan.ts';
import { blockTimes, checkChoice, checkProposal, compareDay, mondayOfDay } from './weekPlan.ts';

const TODAY = '2026-11-19';

function sample(): Record<string, unknown> {
  return {
    week: '2026-11-23',
    note: 'Study after the gym on job days.',
    basedOn: ['Job 07:00–16:00, Sun–Thu'],
    aims: [{ text: 'Ready for a full practice exam', how: 'Two domains, then the exam on Friday' }, { text: 'Lecture ready to give' }],
    days: {
      '2026-11-24': {
        aims: [{ text: 'Outline the lecture', aim: 2 }, 'Get through 40 questions'],
        blocks: [
          { start: '19:30', end: '21:00', label: 'AWS practice set', category: 'learning', why: 'To see what stuck' },
          { start: '17:00', end: '18:30', label: 'Lecture outline', category: 'debate' },
        ],
      },
      '2026-11-23': {
        aims: [{ text: 'Finish networking notes', aim: 1 }],
        blocks: [
          { start: '17:00', end: '18:15', label: 'Gym', category: 'exercise' },
          { start: '23:30', end: '00:30', label: 'Wind down', category: 'sleep routine' },
        ],
      },
    },
  };
}

describe('checkProposal', () => {
  it('accepts a week and sorts its days and blocks', () => {
    const checked = checkProposal(sample(), TODAY);
    assert.ok(checked.ok, checked.ok ? '' : checked.errors.join('\n'));
    const plan = checked.plan;
    assert.deepEqual(plan.days.map((d) => d.day), ['2026-11-23', '2026-11-24']);
    assert.deepEqual(plan.days[1]?.blocks.map((b) => b.label), ['Lecture outline', 'AWS practice set']);
    assert.deepEqual(plan.days[1]?.aims, [{ text: 'Outline the lecture', aim: 2 }, { text: 'Get through 40 questions', aim: null }]);
    assert.equal(plan.aims[1]?.how, null);
  });

  it('runs a block that ends before it starts past midnight', () => {
    const t = blockTimes('2026-11-23', '23:30', '00:30');
    assert.equal(t.end - t.start, 60 * 60_000);
  });

  it('lists every problem at once', () => {
    const raw = sample();
    raw['week'] = '2026-11-24';
    const checked = checkProposal(raw, TODAY);
    assert.equal(checked.ok, false);
    assert.match(checked.ok ? '' : checked.errors.join('\n'), /must be a Monday/);

    const bad = sample();
    const days = bad['days'] as Record<string, { aims: unknown[]; blocks: Record<string, unknown>[] }>;
    (days['2026-11-23'] as { blocks: Record<string, unknown>[] }).blocks.push({ start: '18:00', end: '19:00', label: 'Overlaps the gym' });
    (days['2026-11-24'] as { aims: unknown[] }).aims.push({ text: 'Points nowhere', aim: 5 }, 'Four', 'Five');
    days['2026-12-01'] = { aims: [], blocks: [] };
    const errors = (() => {
      const c = checkProposal(bad, TODAY);
      return c.ok ? [] : c.errors;
    })().join('\n');
    assert.match(errors, /overlap/);
    assert.match(errors, /up to 3 aims/);
    assert.match(errors, /week aim 5, but there are 2/);
    assert.match(errors, /isn't in the week/);
  });

  it('refuses a week that is already over, and warns about week aims no day serves', () => {
    const old = sample();
    old['week'] = '2026-11-09';
    old['days'] = { '2026-11-10': { aims: ['x'], blocks: [] } };
    assert.equal(checkProposal(old, TODAY).ok, false);

    const lonely = sample();
    (lonely['aims'] as unknown[]).push({ text: 'Nobody serves me' });
    const checked = checkProposal(lonely, TODAY);
    assert.ok(checked.ok);
    assert.ok(checked.warnings.some((w) => /week aim 3/.test(w)));
  });

  it('finds the Monday of any day', () => {
    assert.equal(mondayOfDay('2026-11-29'), '2026-11-23');
    assert.equal(mondayOfDay('2026-11-23'), '2026-11-23');
  });
});

describe('compareDay', () => {
  it('spots blocks kept as they are, moved, and dropped', () => {
    const day = '2026-11-23';
    const at = (from: string, until: string) => blockTimes(day, from, until);
    const current = [
      { id: 1, day, ...at('18:00', '19:00'), label: 'gym', category: null },
      { id: 2, day, ...at('21:00', '22:00'), label: 'Reading', category: null },
      { id: 3, day, ...at('19:00', '20:00'), label: 'Study', category: 'study' },
    ];
    const proposed = [
      { start: '17:00', end: '18:15', label: 'Gym', category: null, why: null },
      { start: '19:00', end: '20:00', label: 'Study', category: 'study', why: null },
      { start: '20:30', end: '21:30', label: 'Research', category: null, why: null },
    ];
    const c = compareDay(day, current, proposed);
    assert.deepEqual(c.was, ['18:00–19:00', null, null]);
    assert.deepEqual(c.same, [false, true, false]);
    assert.deepEqual(c.removed.map((r) => r.label), ['Reading']);
  });
});

describe('Journal proposals', () => {
  let dir: string;
  let journal: Journal;
  let plan: WeekProposal;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'raqib-proposal-'));
    journal = new Journal(join(dir, 'data.db'));
    const checked = checkProposal(sample(), TODAY);
    assert.ok(checked.ok);
    plan = checked.plan;
  });
  afterEach(() => {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps one waiting proposal a week: a newer one replaces it', () => {
    const first = journal.addProposal(plan, 1);
    const second = journal.addProposal(plan, 2);
    assert.equal(journal.proposal(first.id)?.status, 'replaced');
    assert.deepEqual(journal.waitingProposals(TODAY).map((p) => p.id), [second.id]);
    assert.equal(journal.discardProposal(second.id, 3)?.status, 'discarded');
    assert.deepEqual(journal.waitingProposals(TODAY), []);
    assert.equal(journal.discardProposal(second.id, 4), null, 'only a waiting one can be discarded');
  });

  it('keeps proposals for different weeks waiting side by side, the earliest week first', () => {
    const next = journal.addProposal(plan, 1);
    const thisWeek = journal.addProposal({ ...plan, week: '2026-11-16', days: [{ day: '2026-11-20', aims: [{ text: 'Gym', aim: null }], blocks: [] }] }, 2);
    assert.deepEqual(journal.waitingProposals(TODAY).map((p) => p.id), [thisWeek.id, next.id]);
    assert.deepEqual(journal.waitingProposals('2026-11-21').map((p) => p.id), [next.id], 'a proposal whose days are all past drops out');
  });

  it('applies the days you take and leaves the rest alone', () => {
    const monday = '2026-11-23';
    const tuesday = '2026-11-24';
    journal.addPlanBlock({ day: monday, ...blockTimes(monday, '21:00', '22:00'), label: 'Reading', category: null });
    journal.addPlanBlock({ day: tuesday, ...blockTimes(tuesday, '06:00', '07:00'), label: 'Run', category: 'exercise' });
    journal.addGoal(monday, 'Finish networking notes');
    const p = journal.addProposal(plan, 1);

    const choice = checkChoice({ days: [monday], dropBlocks: [`${monday}#1`], dropAims: [], dropWeekAims: [2] }, p);
    assert.ok(typeof choice !== 'string');
    const result = journal.applyProposal(p.id, choice, 5);
    assert.ok(result);
    assert.deepEqual({ days: result.days, blocks: result.blocks, goals: result.goals, weekAims: result.weekAims }, { days: 1, blocks: 1, goals: 0, weekAims: 1 });

    assert.deepEqual(journal.planBlocks(monday).map((b) => b.label), ['Gym'], "Monday's plan is replaced, without the dropped block");
    assert.deepEqual(journal.planBlocks(tuesday).map((b) => b.label), ['Run'], 'a day not taken keeps its plan');
    assert.equal(journal.goals(monday).length, 1, 'an aim already set as a goal is not added twice');
    assert.equal(journal.goals(tuesday).length, 0);
    assert.deepEqual(journal.weekAims('2026-11-23').map((a) => a.text), ['Ready for a full practice exam']);
    assert.equal(journal.proposal(p.id)?.status, 'applied');
    assert.equal(journal.applyProposal(p.id, choice, 6), null, 'applying twice does nothing');

    const aim = journal.weekAims('2026-11-23')[0];
    assert.ok(aim);
    assert.equal(journal.updateWeekAim(aim.id, { result: 'met' })?.result, 'met');
    assert.ok(journal.deleteWeekAim(aim.id));
  });

  it('drops day aims that serve a week aim you switched off', () => {
    const tuesday = '2026-11-24';
    const p = journal.addProposal(plan, 1);
    const choice = checkChoice({ days: [tuesday], dropWeekAims: [2] }, p);
    assert.ok(typeof choice !== 'string');
    journal.applyProposal(p.id, choice, 2);
    assert.deepEqual(journal.goals(tuesday).map((g) => g.text), ['Get through 40 questions']);
  });

  it('checks a choice against its proposal', () => {
    const p = journal.addProposal(plan, 1);
    assert.equal(checkChoice({ days: [] }, p), 'Take at least one day.');
    assert.match(String(checkChoice({ days: ['2026-11-30'] }, p)), /isn't in this proposal/);
    assert.match(String(checkChoice({ days: ['2026-11-23'], dropWeekAims: [9] }, p)), /from 1 to 2/);
  });
});
