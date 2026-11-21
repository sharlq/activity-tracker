// The plans screens: every plan (#/plans), and one plan's days and exercises to edit
// (#/plans/<num>), and its weekly sets per muscle (#/plans/<num>/summary). Each plan has its own days; the active one is what "today" follows.
// Changes save as you make them; the list updates itself from Convex.
import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import type { Contribution, MuscleLoad, Verdict } from '../../tracker/src/muscles.ts';
import { MUSCLES, planLoad, verdict } from '../../tracker/src/muscles.ts';
import { mmss } from './timer.ts';
import { attempt, h, n1 } from './ui.ts';

export type PlanList = FunctionReturnType<typeof api.plans.list>;
type Plan = PlanList['plans'][number];
type Day = Plan['days'][number];
type Exercise = Day['exercises'][number];

export interface Ctx {
  client: ConvexClient;
  key: string;
  rerender: () => void;
}

/** The exercise whose form is open, and the day whose "add exercise" box is. */
let editing: number | null = null;

const REST = [45, 60, 75, 90, 120, 150, 180, 240, 300];

function header(title: string, back: string, backLabel: string, eyebrow?: string): HTMLElement {
  return h(
    'header',
    { class: 'top' },
    h('div', { class: 'top-row' }, h('div', null, eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null, h('h1', null, title)), h('a', { class: 'btn ghost small', href: back }, backLabel)),
  );
}

function namesList(names: string[]): HTMLElement {
  return h('datalist', { id: 'exercise-names' }, ...names.map((n) => h('option', { value: n })));
}

// ------------------------------------------------------------------ all plans

export function plansScreen(data: PlanList, ctx: Ctx): HTMLElement[] {
  const { client, key } = ctx;
  const nameIn = h('input', { class: 'field', type: 'text', dir: 'auto', placeholder: 'New plan name, e.g. Push Pull Legs', 'aria-label': 'New plan name', maxlength: 120 }) as HTMLInputElement;
  const from = h(
    'select',
    { class: 'field', 'aria-label': 'Start from' },
    h('option', { value: '' }, 'Start empty'),
    ...data.plans.map((p) => h('option', { value: p.num }, `Copy of ${p.name}`)),
  ) as HTMLSelectElement;
  const create = async () => {
    const name = nameIn.value.trim();
    if (!name) return nameIn.focus();
    let num = 0;
    const ok = await attempt(async () => {
      num = await client.mutation(api.plans.createPlan, { key, name, ...(from.value ? { copyFrom: Number(from.value) } : {}) });
    });
    if (ok) location.hash = `#/plans/${num}`;
  };
  return [
    header('Plans', '#/', 'Today'),
    h(
      'main',
      { class: 'pad-x stack' },
      ...data.plans.map((p) => {
        const exercises = p.days.reduce((n, d) => n + d.exercises.length, 0);
        return h(
          'section',
          { class: `card plan${p.active ? ' active' : ''}` },
          h('div', { class: 'sum-head' }, h('strong', { dir: 'auto' }, p.name), p.active ? h('span', { class: 'badge accent' }, 'Active') : null),
          h('p', { class: 'muted small' }, p.days.length ? p.days.map((d) => d.name).join(' · ') : 'No days yet', ` — ${exercises} exercise${exercises === 1 ? '' : 's'}`),
          h(
            'div',
            { class: 'row' },
            h('a', { class: 'btn', href: `#/plans/${p.num}` }, 'Edit'),
            h('a', { class: 'btn', href: `#/plans/${p.num}/summary` }, 'Summary'),
            p.active ? null : h('button', { class: 'btn primary', onclick: () => void attempt(() => client.mutation(api.plans.setActive, { key, planNum: p.num }), `Now following ${p.name}`) }, 'Use this plan'),
          ),
        );
      }),
      h('section', { class: 'card stack' }, h('strong', null, 'New plan'), nameIn, from, h('button', { class: 'btn primary big', onclick: () => void create() }, 'Create plan')),
    ),
  ];
}

// ------------------------------------------------------------------ a plan's summary

const VERDICT: Record<Exclude<Verdict, null>, [string, string]> = {
  low: ['warn', 'Low'],
  ok: ['good', 'In range'],
  high: ['warn', 'A lot'],
  once: ['accent', 'Once a week'],
};

const sets = (n: number) => `${n1(n)} set${n === 1 ? '' : 's'}`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n}×`);

function muscleRow(r: MuscleLoad, scale: number): HTMLElement {
  const v = verdict(r);
  const freq = r.days ? `${times(r.days)} a week` : r.helperDays ? `helper only, ${times(r.helperDays)} a week` : 'not trained';
  const byDay = new Map<string, Contribution[]>();
  for (const c of r.from) byDay.set(c.day, [...(byDay.get(c.day) ?? []), c]);
  return h(
    'li',
    { class: 'ms-row' },
    h(
      'details',
      null,
      h(
        'summary',
        null,
        h('span', { class: 'ms-name' }, r.muscle),
        h('span', { class: 'ms-num' }, h('strong', null, n1(r.total)), h('span', { class: 'muted small' }, ' sets')),
        h('span', { class: 'ms-bar', 'aria-hidden': 'true' },
          h('span', { class: 'ms-direct', style: `width:${(r.direct / scale) * 100}%` }),
          h('span', { class: 'ms-help', style: `width:${(r.indirect / 2 / scale) * 100}%` })),
        h('span', { class: 'muted small ms-meta' }, freq, r.indirect ? ` · ${n1(r.direct)} direct + ${n1(r.indirect)} helping` : '', v ? ' · ' : '', v ? h('span', { class: `badge ${VERDICT[v][0]}` }, VERDICT[v][1]) : null),
      ),
      h(
        'ul',
        { class: 'ms-from small' },
        ...[...byDay].map(([day, cs]) =>
          h('li', null, h('strong', { dir: 'auto' }, day), ' ', h('span', { class: 'muted', dir: 'auto' }, cs.map((c) => `${c.exercise} ${c.sets}${c.main ? '' : ' (helps, ½)'}`).join(' · '))),
        ),
      ),
    ),
  );
}

export function planSummary(data: PlanList, planNum: number): HTMLElement[] {
  const plan = data.plans.find((p) => p.num === planNum);
  if (!plan) return [header('Plan not found', '#/plans', 'Plans'), h('p', { class: 'pad muted' }, 'It may have been removed.')];
  const load = planLoad(plan.days);
  const trained = load.muscles.filter((m) => m.total > 0);
  const missing = load.muscles.filter((m) => m.total === 0);
  const scale = Math.max(20, ...trained.map((m) => m.total));
  const weekSets = load.days.reduce((n, d) => n + d.sets, 0);
  const groups: [string, (m: MuscleLoad) => boolean][] = [
    ['Upper body', (m) => MUSCLES.indexOf(m.muscle) < MUSCLES.indexOf('Abs')],
    ['Trunk', (m) => m.muscle === 'Abs' || m.muscle === 'Lower back'],
    ['Lower body', (m) => MUSCLES.indexOf(m.muscle) > MUSCLES.indexOf('Lower back')],
  ];
  return [
    header('Weekly muscle summary', `#/plans/${planNum}`, 'Edit plan', plan.name),
    h(
      'main',
      { class: 'pad-x stack' },
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'ms-totals' },
          h('div', null, h('strong', null, String(plan.days.length)), h('span', { class: 'muted small' }, 'days a week')),
          h('div', null, h('strong', null, String(weekSets)), h('span', { class: 'muted small' }, 'sets a week')),
          h('div', null, h('strong', null, String(trained.length)), h('span', { class: 'muted small' }, 'muscles worked'))),
        h('ul', { class: 'ms-days small' }, ...load.days.map((d) => h('li', null, h('span', { dir: 'auto' }, d.name), h('span', { class: 'muted' }, `${d.sets} sets`)))),
        h('p', { class: 'muted small' }, 'Counts one pass through the plan\'s days as a week. Sets on a main muscle count in full; sets where a muscle only helps count as half. A rough growth range is about 10–20 sets, over 2 days, a week.'),
      ),
      ...groups.map(([title, test]) => {
        const rows = trained.filter(test);
        return rows.length ? h('section', { class: 'card' }, h('strong', null, title), h('ul', { class: 'ms-list' }, ...rows.map((r) => muscleRow(r, scale)))) : null;
      }),
      missing.length ? h('section', { class: 'card' }, h('strong', null, 'Not trained'), h('p', { class: 'muted small' }, missing.map((m) => m.muscle).join(' · '))) : null,
      load.unknown.length
        ? h('section', { class: 'card' }, h('strong', null, 'Not counted'), h('p', { class: 'muted small', dir: 'auto' }, 'These names weren\'t recognised: ', load.unknown.map((u) => `${u.exercise} (${u.day})`).join(' · ')))
        : null,
    ),
  ];
}

// ------------------------------------------------------------------ one plan

function restSelect(value: number, label: string): HTMLSelectElement {
  return h(
    'select',
    { class: 'field', 'aria-label': label },
    ...[...new Set([...REST, value])].sort((a, b) => a - b).map((s) => h('option', { value: s, ...(s === value ? { selected: true } : {}) }, mmss(s))),
  ) as HTMLSelectElement;
}

function numberField(label: string, value: number, attrs: Record<string, unknown> = {}): [HTMLElement, HTMLInputElement] {
  const input = h('input', { class: 'field', type: 'number', inputmode: 'decimal', value: n1(value), 'aria-label': label, ...attrs }) as HTMLInputElement;
  return [h('label', { class: 'form-field' }, h('span', { class: 'step-label' }, label), input), input];
}

function check(label: string, on: boolean, hint: string): [HTMLElement, HTMLInputElement] {
  const box = h('input', { type: 'checkbox', ...(on ? { checked: true } : {}) }) as HTMLInputElement;
  return [h('label', { class: 'check' }, box, h('span', null, label, h('span', { class: 'muted small block' }, hint))), box];
}

function exerciseForm(e: Exercise, ctx: Ctx, isFirst: boolean, isLast: boolean): HTMLElement {
  const ss = e.superset;
  const { client, key } = ctx;
  const name = h('input', { class: 'field', type: 'text', dir: 'auto', value: e.name, list: 'exercise-names', 'aria-label': 'Exercise name', maxlength: 200 }) as HTMLInputElement;
  const [setsF, sets] = numberField('Sets', e.sets, { min: 1, max: 10, step: 1, inputmode: 'numeric' });
  const [minF, repMin] = numberField('Reps from', e.repMin, { min: 1, max: 100, step: 1, inputmode: 'numeric' });
  const [maxF, repMax] = numberField('Reps to', e.repMax, { min: 1, max: 100, step: 1, inputmode: 'numeric' });
  const [stepF, step] = numberField('Weight step (kg)', e.step, { min: 0.25, max: 50, step: 'any' });
  const rest = restSelect(e.restSeconds, 'Rest between sets');
  const [bwF, bodyweight] = check('Bodyweight', e.bodyweight, 'Weight is what you add (pull-ups, dips)');
  const [phF, perHand] = check('Per hand', e.perHand, 'Weight is one dumbbell');
  const [psF, perSide] = check('Per side', e.perSide, 'Plates on one side of a plate-loaded machine');
  const [lsF, laterSlot] = check('After the same muscle', e.laterSlot, 'Already worked earlier: the engine expects fewer reps');
  const note = h('input', { class: 'field', type: 'text', dir: 'auto', value: e.note ?? '', placeholder: 'Note (optional)', 'aria-label': 'Note', maxlength: 500 }) as HTMLInputElement;
  const save = async () => {
    const ok = await attempt(
      () =>
        client.mutation(api.plans.updateExercise, {
          key, exerciseNum: e.num, name: name.value, sets: Number(sets.value), repMin: Number(repMin.value), repMax: Number(repMax.value),
          step: Number(step.value), restSeconds: Number(rest.value), bodyweight: bodyweight.checked, perHand: perHand.checked, perSide: perSide.checked, laterSlot: laterSlot.checked, note: note.value,
        }),
      'Saved',
    );
    if (ok) {
      editing = null;
      ctx.rerender();
    }
  };
  const remove = () => {
    if (confirm(`Remove ${e.name} from this day? Its logged history stays.`)) void attempt(() => client.mutation(api.plans.deleteExercise, { key, exerciseNum: e.num }), `${e.name} removed`);
  };
  return h(
    'div',
    { class: 'ex-form stack' },
    name,
    h('div', { class: 'grid-3' }, setsF, minF, maxF),
    h('div', { class: 'grid-2' }, stepF, h('label', { class: 'form-field' }, h('span', { class: 'step-label' }, 'Rest'), rest)),
    bwF,
    phF,
    psF,
    lsF,
    note,
    h(
      'div',
      { class: 'row' },
      ss
        ? h('span', { class: 'muted small grow' }, h('span', { class: 'ss-line' }, `Superset ${ss.label}${ss.order}`), ' · its sets alternate with the others, then rest')
        : h('span', { class: 'muted small grow' }, 'Done on its own'),
      ss ? h('button', { class: 'btn small', onclick: () => void attempt(() => client.mutation(api.plans.leaveSuperset, { key, exerciseNum: e.num }), `${e.name} is done on its own now`) }, 'Leave superset') : null,
      isLast && !ss ? null : h('button', { class: 'btn small', onclick: () => void attempt(() => client.mutation(api.plans.supersetWithNext, { key, exerciseNum: e.num }), 'Superset made') }, ss ? 'Add the next lift' : 'Superset with next'),
    ),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => void save() }, 'Save'),
      h('button', { class: 'btn', onclick: () => ((editing = null), ctx.rerender()) }, 'Cancel'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost small', disabled: isFirst, 'aria-label': 'Move up', onclick: () => void attempt(() => client.mutation(api.plans.moveExercise, { key, exerciseNum: e.num, by: -1 })) }, '↑'),
      h('button', { class: 'btn ghost small', disabled: isLast, 'aria-label': 'Move down', onclick: () => void attempt(() => client.mutation(api.plans.moveExercise, { key, exerciseNum: e.num, by: 1 })) }, '↓'),
      h('button', { class: 'btn ghost small danger-ink', onclick: remove }, 'Remove'),
    ),
  );
}

function exerciseRow(e: Exercise, ctx: Ctx, i: number, count: number): HTMLElement {
  if (editing === e.num) return h('li', { class: 'ex-row open' }, exerciseForm(e, ctx, i === 0, i === count - 1));
  const extra = [e.bodyweight ? 'bodyweight' : null, e.perHand ? 'per hand' : null, e.perSide ? 'per side' : null].filter(Boolean).join(' · ');
  const tag = e.superset ? `${e.superset.label}${e.superset.order}` : null;
  return h(
    'li',
    { class: `ex-row${tag ? ' in-superset' : ''}` },
    h(
      'button',
      { class: 'ex-line', onclick: () => ((editing = e.num), ctx.rerender()) },
      tag ? h('span', { class: 'ss-tag' }, tag) : null,
      h('span', { class: 'grow' }, h('span', { class: 'ex-name', dir: 'auto' }, e.name), h('span', { class: 'muted small block' }, `${e.sets} × ${e.repMin}–${e.repMax} · ${e.superset ? 'rest after the round' : `rest ${mmss(e.restSeconds)}`}${extra ? ` · ${extra}` : ''}`)),
      h('span', { class: 'muted', 'aria-hidden': 'true' }, '›'),
    ),
  );
}

/** A superset's heading in the day: its letter and the rest after each round. */
function supersetRow(ss: NonNullable<Exercise['superset']>, ctx: Ctx): HTMLElement {
  const rest = restSelect(ss.restSeconds, `Rest after each round of superset ${ss.label}`);
  rest.addEventListener('change', () => void attempt(() => ctx.client.mutation(api.plans.updateSuperset, { key: ctx.key, supersetNum: ss.num, restSeconds: Number(rest.value) }), `Superset ${ss.label}: rest ${mmss(Number(rest.value))} per round`));
  return h(
    'li',
    { class: 'ss-row' },
    h('span', { class: 'ss-badge grow' }, `Superset ${ss.label}`, h('span', { class: 'muted small block' }, `${ss.size} lifts: a set of each, then rest`)),
    h('label', { class: 'form-field' }, h('span', { class: 'step-label' }, 'Rest per round'), rest),
  );
}

function daySection(d: Day, ctx: Ctx, i: number, count: number): HTMLElement {
  const { client, key } = ctx;
  const title = h('input', { class: 'day-name', type: 'text', dir: 'auto', value: d.name, 'aria-label': 'Day name', maxlength: 60 }) as HTMLInputElement;
  title.addEventListener('change', () => void attempt(() => client.mutation(api.plans.updateDay, { key, dayNum: d.num, name: title.value }), 'Day renamed'));
  const add = h('input', { class: 'field', type: 'text', dir: 'auto', list: 'exercise-names', placeholder: 'Add an exercise', 'aria-label': `Add an exercise to ${d.name}`, maxlength: 200 }) as HTMLInputElement;
  const addIt = async () => {
    const name = add.value.trim();
    if (!name) return add.focus();
    let num = 0;
    if (await attempt(async () => (num = await client.mutation(api.plans.addExercise, { key, dayNum: d.num, name })))) {
      editing = num;
      ctx.rerender();
    }
  };
  add.addEventListener('keydown', (e) => e.key === 'Enter' && void addIt());
  const removeDay = () => {
    if (confirm(`Remove ${d.name} and its ${d.exercises.length} exercises from this plan? Logged workouts stay.`)) void attempt(() => client.mutation(api.plans.deleteDay, { key, dayNum: d.num }), `${d.name} removed`);
  };
  return h(
    'section',
    { class: 'card day' },
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'day-no' }, `Day ${i + 1}`),
      title,
      h('button', { class: 'btn ghost small', disabled: i === 0, 'aria-label': `Move ${d.name} earlier`, onclick: () => void attempt(() => client.mutation(api.plans.moveDay, { key, dayNum: d.num, by: -1 })) }, '↑'),
      h('button', { class: 'btn ghost small', disabled: i === count - 1, 'aria-label': `Move ${d.name} later`, onclick: () => void attempt(() => client.mutation(api.plans.moveDay, { key, dayNum: d.num, by: 1 })) }, '↓'),
      h('button', { class: 'btn ghost small', 'aria-label': `Remove ${d.name}`, onclick: removeDay }, '✕'),
    ),
    d.exercises.length
      ? h('ol', { class: 'ex-rows' }, ...d.exercises.flatMap((e, j) => [...(e.superset?.order === 1 ? [supersetRow(e.superset, ctx)] : []), exerciseRow(e, ctx, j, d.exercises.length)]))
      : h('p', { class: 'muted small' }, 'No exercises yet.'),
    h('div', { class: 'row' }, add, h('button', { class: 'btn', onclick: () => void addIt() }, 'Add')),
  );
}

export function planEditor(data: PlanList, planNum: number, ctx: Ctx): HTMLElement[] {
  const { client, key } = ctx;
  const plan = data.plans.find((p) => p.num === planNum);
  if (!plan) return [header('Plan not found', '#/plans', 'Plans'), h('p', { class: 'pad muted' }, 'It may have been removed.')];
  const title = h('input', { class: 'field plan-name', type: 'text', dir: 'auto', value: plan.name, 'aria-label': 'Plan name', maxlength: 120 }) as HTMLInputElement;
  title.addEventListener('change', () => void attempt(() => client.mutation(api.plans.updatePlan, { key, planNum, name: title.value }), 'Plan renamed'));
  const dayName = h('input', { class: 'field', type: 'text', dir: 'auto', placeholder: `Day ${plan.days.length + 1} name, e.g. Push`, 'aria-label': 'New day name', maxlength: 60 }) as HTMLInputElement;
  const addDay = () => {
    const name = dayName.value.trim();
    if (!name) return dayName.focus();
    void attempt(() => client.mutation(api.plans.addDay, { key, planNum, name }), `${name} added`);
  };
  dayName.addEventListener('keydown', (e) => e.key === 'Enter' && addDay());
  const removePlan = async () => {
    if (!confirm(`Remove the plan "${plan.name}"? Logged workouts stay.`)) return;
    if (await attempt(() => client.mutation(api.plans.deletePlan, { key, planNum }), 'Plan removed')) location.hash = '#/plans';
  };
  return [
    header(plan.name, '#/plans', 'Plans', plan.active ? 'Active plan' : 'Plan'),
    h(
      'main',
      { class: 'pad-x stack' },
      namesList(data.names),
      h('label', { class: 'form-field' }, h('span', { class: 'step-label' }, 'Plan name'), title),
      h('a', { class: 'btn', href: `#/plans/${planNum}/summary` }, 'Weekly muscle summary'),
      plan.active
        ? h('p', { class: 'muted small' }, 'Today follows this plan. Days come in this order, then start again.')
        : h('button', { class: 'btn primary big', onclick: () => void attempt(() => client.mutation(api.plans.setActive, { key, planNum }), `Now following ${plan.name}`) }, 'Use this plan'),
      ...plan.days.map((d, i) => daySection(d, ctx, i, plan.days.length)),
      h('section', { class: 'card stack' }, h('strong', null, 'Add a day'), h('div', { class: 'row' }, dayName, h('button', { class: 'btn', onclick: addDay }, 'Add'))),
      plan.active ? null : h('button', { class: 'btn ghost danger-ink', onclick: () => void removePlan() }, 'Remove this plan'),
    ),
  ];
}
