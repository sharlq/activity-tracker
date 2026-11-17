// The plans screens: every plan (#/plans), and one plan's days and exercises to edit
// (#/plans/<num>). Each plan has its own days; the active one is what "today" follows.
// Changes save as you make them; the list updates itself from Convex.
import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
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
            p.active ? null : h('button', { class: 'btn primary', onclick: () => void attempt(() => client.mutation(api.plans.setActive, { key, planNum: p.num }), `Now following ${p.name}`) }, 'Use this plan'),
          ),
        );
      }),
      h('section', { class: 'card stack' }, h('strong', null, 'New plan'), nameIn, from, h('button', { class: 'btn primary big', onclick: () => void create() }, 'Create plan')),
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
  return h(
    'li',
    { class: 'ex-row' },
    h(
      'button',
      { class: 'ex-line', onclick: () => ((editing = e.num), ctx.rerender()) },
      h('span', { class: 'grow' }, h('span', { class: 'ex-name', dir: 'auto' }, e.name), h('span', { class: 'muted small block' }, `${e.sets} × ${e.repMin}–${e.repMax} · rest ${mmss(e.restSeconds)}${extra ? ` · ${extra}` : ''}`)),
      h('span', { class: 'muted', 'aria-hidden': 'true' }, '›'),
    ),
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
    d.exercises.length ? h('ol', { class: 'ex-rows' }, ...d.exercises.map((e, j) => exerciseRow(e, ctx, j, d.exercises.length))) : h('p', { class: 'muted small' }, 'No exercises yet.'),
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
      plan.active
        ? h('p', { class: 'muted small' }, 'Today follows this plan. Days come in this order, then start again.')
        : h('button', { class: 'btn primary big', onclick: () => void attempt(() => client.mutation(api.plans.setActive, { key, planNum }), `Now following ${plan.name}`) }, 'Use this plan'),
      ...plan.days.map((d, i) => daySection(d, ctx, i, plan.days.length)),
      h('section', { class: 'card stack' }, h('strong', null, 'Add a day'), h('div', { class: 'row' }, dayName, h('button', { class: 'btn', onclick: addDay }, 'Add'))),
      plan.active ? null : h('button', { class: 'btn ghost danger-ink', onclick: () => void removePlan() }, 'Remove this plan'),
    ),
  ];
}
