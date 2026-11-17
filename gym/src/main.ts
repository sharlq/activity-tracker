// رقيب at the gym. Screens on the hash: today's plan day a set at a time (#/), a workout's
// summary (#/summary/<num>), past workouts (#/history), and plans (#/plans, #/plans/<num>,
// in plans.ts). The plans and the engine's suggestions come from Convex; the rest timer
// runs here (timer.ts).
import { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import './style.css';
import type { PlanList } from './plans.ts';
import { planEditor, plansScreen } from './plans.ts';
import { addRest, canKeepAwake, keepingAwake, mmss, onRest, remaining, restNow, setKeepAwake, startRest, stopRest, unlockSound } from './timer.ts';
import { attempt, h, message, n1, store, thousands, toast } from './ui.ts';

type TodayResult = FunctionReturnType<typeof api.training.today>;
type Today = Extract<TodayResult, { kind: 'day' }>;
type Exercise = Today['exercises'][number];
type Summary = FunctionReturnType<typeof api.training.summary>;
type Recent = FunctionReturnType<typeof api.training.recent>;

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const client = url ? new ConvexClient(url) : null;

// ------------------------------------------------------------------ small helpers

function localDay(t = new Date()): string {
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** A weight as the gym says it: "85 kg", "BW", "+5 kg", "20 kg per hand". */
function wLabel(w: number | null, e: Pick<Exercise, 'bodyweight' | 'perHand' | 'perSide'>): string {
  if (e.bodyweight) return !w ? 'BW' : `${w > 0 ? '+' : '−'}${n1(Math.abs(w))} kg`;
  return w === null ? '—' : `${n1(w)} kg${e.perHand ? ' per hand' : e.perSide ? ' per side' : ''}`;
}

// ------------------------------------------------------------------ state


let key = store.get('gym.key');
let today: TodayResult | undefined;
let date = localDay();
let dayNum: number | undefined;
let open: number | null = null;
const inputs = new Map<number, { weight: number; reps: number }>();
/** Sets sent but not yet confirmed (shown greyed until Convex has them). */
const pending: { id: number; exercise: number; weight: number; reps: number }[] = [];
let pendingId = 0;
let unsubscribe: (() => void) | null = null;
let online = true;
let plans: PlanList | undefined;

function renderPlans(): void {
  const r = route();
  if (!plans || !client || !key) return;
  const ctx = { client, key, rerender: renderPlans };
  // Keep the scroll place: these screens redraw after each change.
  const y = window.scrollY;
  if (r.name === 'plans') app.replaceChildren(...plansScreen(plans, ctx));
  else if (r.name === 'plan') app.replaceChildren(...planEditor(plans, r.num, ctx));
  window.scrollTo(0, y);
}

const app = document.getElementById('app') as HTMLElement;

type Route = { name: 'today' } | { name: 'summary'; num: number } | { name: 'history' } | { name: 'plans' } | { name: 'plan'; num: number };

function route(): Route {
  const m = /^#\/summary\/(\d+)$/.exec(location.hash);
  if (m) return { name: 'summary', num: Number(m[1]) };
  const p = /^#\/plans\/(\d+)$/.exec(location.hash);
  if (p) return { name: 'plan', num: Number(p[1]) };
  if (location.hash === '#/plans') return { name: 'plans' };
  if (location.hash === '#/history') return { name: 'history' };
  return { name: 'today' };
}

function watch<T>(subscribe: (cb: (v: T) => void, err: (e: Error) => void) => () => void, onValue: (v: T) => void): void {
  unsubscribe?.();
  unsubscribe = subscribe(onValue, (e) => {
    const text = message(e);
    if (/wrong key/.test(text)) {
      key = null;
      store.set('gym.key', null);
      render();
    }
    toast(text, true);
  });
}

function start(): void {
  if (!client) return render();
  if (!key) return render();
  const r = route();
  if (r.name === 'today') {
    today = undefined;
    const k = key;
    watch<TodayResult>((cb, err) => client.onUpdate(api.training.today, { key: k, date, ...(dayNum !== undefined ? { dayNum } : {}) }, cb, err), (v) => {
      today = v;
      render();
    });
  } else if (r.name === 'plans' || r.name === 'plan') {
    const k = key;
    if (plans) renderPlans();
    else app.replaceChildren(h('p', { class: 'muted pad' }, 'Loading plans…'));
    watch<PlanList>((cb, err) => client.onUpdate(api.plans.list, { key: k }, cb, err), (v) => {
      plans = v;
      renderPlans();
    });
  } else if (r.name === 'summary') {
    const k = key;
    watch<Summary>((cb, err) => client.onUpdate(api.training.summary, { key: k, workoutNum: r.num }, cb, err), (v) => renderSummary(v));
  } else {
    const k = key;
    watch<Recent>((cb, err) => client.onUpdate(api.training.recent, { key: k, limit: 30 }, cb, err), (v) => renderHistory(v));
  }
  render();
}

function render(): void {
  if (!client) return void app.replaceChildren(setupNeeded());
  if (!key) return void app.replaceChildren(signIn());
  const r = route();
  if (r.name === 'today') app.replaceChildren(...todayScreen());
  else if (app.childElementCount === 0) app.replaceChildren(h('p', { class: 'muted pad' }, 'Loading…'));
}

// ------------------------------------------------------------------ sign-in

function setupNeeded(): HTMLElement {
  return h('main', { class: 'pad center' }, h('h1', null, 'Not set up'), h('p', { class: 'muted' }, 'VITE_CONVEX_URL is missing from this build.'));
}

function signIn(): HTMLElement {
  const input = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Gym key', 'aria-label': 'Gym key', class: 'field' }) as HTMLInputElement;
  const go = async () => {
    const k = input.value.trim();
    if (!k) return;
    try {
      await client!.query(api.training.ping, { key: k });
      key = k;
      store.set('gym.key', k);
      start();
    } catch (e) {
      toast(message(e), true);
    }
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && void go());
  return h(
    'main',
    { class: 'pad signin' },
    h('img', { src: '/icon.svg', alt: '', width: 72, height: 72 }),
    h('h1', null, 'رقيب · Gym'),
    h('p', { class: 'muted' }, 'Enter your gym key once. It stays on this phone.'),
    input,
    h('button', { class: 'btn primary big', onclick: () => void go() }, 'Sign in'),
  );
}

// ------------------------------------------------------------------ today

function done(e: Exercise): number {
  return e.logged.length + pending.filter((p) => p.exercise === e.num).length;
}

function defaults(e: Exercise): { weight: number; reps: number } {
  const set = inputs.get(e.num);
  if (set) return set;
  const last = e.logged.at(-1);
  const weight = last ? (last.weight ?? 0) : e.suggested;
  const reps = last?.reps ?? e.beat?.[e.logged.length] ?? e.beat?.at(-1) ?? e.repMin;
  return { weight, reps };
}

function stepper(label: string, value: number, step: number, min: number, onChange: (v: number) => void, decimal: boolean): HTMLElement {
  const field = h('input', {
    type: 'number', inputmode: decimal ? 'decimal' : 'numeric', step: decimal ? 'any' : '1', min, value: n1(value), 'aria-label': label, class: 'step-value',
  }) as HTMLInputElement;
  field.addEventListener('change', () => {
    const v = Number(field.value);
    if (Number.isFinite(v) && v >= min) onChange(decimal ? Math.round(v * 100) / 100 : Math.round(v));
  });
  field.addEventListener('focus', () => field.select());
  const bump = (d: number) => () => {
    const v = Math.max(min, Math.round((Number(field.value || 0) + d) * 100) / 100);
    field.value = n1(v);
    onChange(v);
  };
  return h(
    'div',
    { class: 'stepper' },
    h('span', { class: 'step-label' }, label),
    h('div', { class: 'step-row' }, h('button', { class: 'btn step', onclick: bump(-step), 'aria-label': `Less ${label}` }, '−'), field, h('button', { class: 'btn step', onclick: bump(step), 'aria-label': `More ${label}` }, '+')),
  );
}

const STATUS: Record<string, [string, string]> = { ahead: ['Ahead of goal', 'good'], 'on track': ['On track', 'accent'], behind: ['Behind goal', 'danger'] };
const VERDICT: Record<string, [string, string]> = { ADD_WEIGHT: ['Add weight', 'good'], HOLD: ['Same weight', 'accent'], TOO_HEAVY: ['Too heavy', 'danger'] };

async function logSet(e: Exercise, all: Exercise[]): Promise<void> {
  unlockSound();
  const { weight, reps } = defaults(e);
  const id = ++pendingId;
  pending.push({ id, exercise: e.num, weight, reps });
  const n = done(e);
  // Rest starts now; the last set of an exercise moves on to the next one.
  const next = n >= e.sets ? all.find((x) => x.num !== e.num && done(x) < x.sets) : undefined;
  if (n >= e.sets && next) open = next.num;
  if (n < e.sets || next) startRest(e.restSeconds, n >= e.sets ? `Next: ${next!.name}` : `Set ${n + 1} of ${e.sets} next`);
  else stopRest();
  render();
  const settle = () => {
    const i = pending.findIndex((p) => p.id === id);
    if (i >= 0) pending.splice(i, 1);
    render();
  };
  // Convex resolves a mutation once the subscribed queries show it, so the greyed set
  // gives way to the real one without a gap. Offline, it waits and sends on reconnect.
  try {
    await client!.mutation(api.training.logSet, { key: key!, date, exerciseNum: e.num, weight, reps, at: Date.now() });
    settle();
  } catch (err) {
    settle();
    toast(message(err), true);
  }
}

async function deleteSet(workoutNum: number, setNum: number): Promise<void> {
  try {
    await client!.mutation(api.training.deleteSet, { key: key!, workoutNum, setNum });
    toast('Set removed');
  } catch (err) {
    toast(message(err), true);
  }
}

const REST_CHOICES = [60, 90, 120, 150, 180, 240, 300];

function restPicker(e: Exercise): HTMLElement {
  const select = h(
    'select',
    { class: 'rest-pick', 'aria-label': `Rest after each set of ${e.name}` },
    ...[...new Set([...REST_CHOICES, e.restSeconds])].sort((a, b) => a - b).map((s) => h('option', { value: s, ...(s === e.restSeconds ? { selected: true } : {}) }, `Rest ${mmss(s)}`)),
  ) as HTMLSelectElement;
  select.addEventListener('change', async () => {
    try {
      await client!.mutation(api.training.setRest, { key: key!, exerciseNum: e.num, seconds: Number(select.value) });
      toast(`Rest for ${e.name}: ${mmss(Number(select.value))}`);
    } catch (err) {
      toast(message(err), true);
    }
  });
  return select;
}

/** The plan's number of sets for this exercise, from now on (the engine judges that many). */
function plannedSets(e: Exercise): HTMLElement {
  const change = (by: number) => () => {
    const sets = e.planSets + by;
    if (sets < 1 || sets > 10) return;
    void attempt(() => client!.mutation(api.plans.updateExercise, { key: key!, exerciseNum: e.num, sets }), `${e.name}: ${sets} sets from now on`);
  };
  return h(
    'div',
    { class: 'planned' },
    h('span', { class: 'muted small' }, 'Planned sets'),
    h('button', { class: 'btn ghost small', onclick: change(-1), disabled: e.planSets <= 1, 'aria-label': 'One planned set fewer' }, '−'),
    h('strong', null, String(e.planSets)),
    h('button', { class: 'btn ghost small', onclick: change(1), disabled: e.planSets >= 10, 'aria-label': 'One planned set more' }, '+'),
  );
}

function exerciseCard(e: Exercise, all: Exercise[], workoutNum: number | null): HTMLElement {
  const count = done(e);
  const complete = count >= e.sets;
  const isOpen = open === e.num;
  const head = h(
    'button',
    { class: 'ex-head', onclick: () => ((open = isOpen ? null : e.num), render()), 'aria-expanded': String(isOpen) },
    h('span', { class: `ex-dot${complete ? ' done' : count ? ' some' : ''}`, 'aria-hidden': 'true' }, complete ? '✓' : ''),
    h('span', { class: 'ex-name', dir: 'auto' }, e.name),
    h('span', { class: 'ex-meta' }, `${count}/${e.sets}`, h('span', { class: 'ex-weight' }, wLabel(e.suggested, e))),
  );
  if (!isOpen) return h('section', { class: `ex${complete ? ' complete' : ''}` }, head);

  const { weight, reps } = defaults(e);
  const set = (patch: Partial<{ weight: number; reps: number }>) => inputs.set(e.num, { ...defaults(e), ...patch });
  const progress = e.progress ? STATUS[e.progress.status] : null;
  const rows = [
    ...e.logged.map((s, i) =>
      h(
        'li',
        { class: 'set' },
        h('span', { class: 'set-no' }, `Set ${i + 1}`),
        h('span', { class: 'set-what' }, `${wLabel(s.weight ?? (e.bodyweight ? 0 : null), e)} × ${s.reps ?? '—'}`),
        workoutNum !== null ? h('button', { class: 'btn ghost small', onclick: () => void deleteSet(workoutNum, s.id), 'aria-label': `Remove set ${i + 1}` }, '✕') : null,
      ),
    ),
    ...pending
      .filter((p) => p.exercise === e.num)
      .map((p, i) => h('li', { class: 'set saving' }, h('span', { class: 'set-no' }, `Set ${e.logged.length + i + 1}`), h('span', { class: 'set-what' }, `${wLabel(p.weight, e)} × ${p.reps}`), h('span', { class: 'muted small' }, online ? 'saving…' : 'waiting for signal'))),
  ];
  return h(
    'section',
    { class: `ex open${complete ? ' complete' : ''}` },
    head,
    h(
      'div',
      { class: 'ex-body' },
      e.note ? h('p', { class: 'muted small', dir: 'auto' }, e.note) : null,
      h(
        'div',
        { class: 'aim' },
        h('div', null, h('span', { class: 'aim-label' }, 'Aim'), h('strong', null, wLabel(e.suggested, e)), h('span', { class: 'muted' }, ` · ${e.sets} × ${e.repMin}–${e.repMax}`)),
        e.setsReason ? h('div', { class: 'small' }, h('span', { class: 'badge accent' }, `${e.sets} sets`), ` ${e.setsReason}`) : null,
        e.beat ? h('div', null, h('span', { class: 'aim-label' }, 'Beat'), h('strong', null, e.beat.join(' · '))) : null,
        e.last
          ? h('div', { class: 'muted small' }, `Last ${shortDay(e.last.day)}: ${wLabel(e.last.weight, e)} × ${e.last.reps.join('/')}`, e.lastVerdict ? ` → ${e.lastVerdict}` : '')
          : h('div', { class: 'muted small' }, 'First time on the plan'),
        h('div', { class: 'badges' }, progress ? h('span', { class: `badge ${progress[1]}` }, progress[0]) : null, ...e.flags.map((f) => h('span', { class: 'badge warn', title: f.message }, f.kind)), restPicker(e)),
      ),
      rows.length ? h('ol', { class: 'sets' }, rows) : null,
      // The engine's call needs the whole session: shown once the planned sets are in.
      e.now && e.logged.length >= e.sets ? h('p', { class: `now ${VERDICT[e.now.kind]?.[1] ?? ''}` }, e.now.message) : null,
      h(
        'div',
        { class: 'inputs' },
        stepper(e.bodyweight ? 'Added kg' : e.perHand ? 'kg per hand' : e.perSide ? 'kg per side' : 'kg', weight, e.step, e.bodyweight ? -200 : 0, (v) => set({ weight: v }), true),
        stepper('Reps', reps, 1, 0, (v) => set({ reps: v }), false),
      ),
      h('button', { class: 'btn primary big', onclick: () => void logSet(e, all) }, complete ? `Log extra set (${count + 1})` : `Log set ${count + 1} of ${e.sets}`),
      plannedSets(e),
    ),
  );
}

async function finish(t: Today): Promise<void> {
  if (!t.workout) return;
  if (pending.length) return toast('Wait for the last set to save', true);
  try {
    await client!.mutation(api.training.finish, { key: key!, workoutNum: t.workout.num, end: Date.now() });
    stopRest();
    location.hash = `#/summary/${t.workout.num}`;
  } catch (err) {
    toast(message(err), true);
  }
}

function todayScreen(): HTMLElement[] {
  if (today === undefined) return [h('p', { class: 'muted pad' }, 'Loading today’s plan…')];
  if (today.kind === 'no plan') {
    return [h('main', { class: 'pad center stack' }, h('h1', null, 'No plan yet'), h('p', { class: 'muted' }, 'Make one here, or push the plan from the PC (npm run push-from-pc).'), h('a', { class: 'btn primary big', href: '#/plans' }, 'Make a plan'))];
  }
  if (today.kind === 'empty plan') {
    return [h('main', { class: 'pad center stack' }, h('p', { class: 'eyebrow' }, today.plan.name), h('h1', null, 'This plan has no days yet'), h('a', { class: 'btn primary big', href: `#/plans/${today.plan.num}` }, 'Add days and exercises'))];
  }
  const t = today;
  if (open === null || !t.exercises.some((e) => e.num === open)) open = (t.exercises.find((e) => done(e) < e.sets) ?? t.exercises[0])?.num ?? null;
  const total = t.exercises.reduce((n, e) => n + e.sets, 0);
  const logged = t.exercises.reduce((n, e) => n + Math.min(done(e), e.sets), 0);
  const awake = canKeepAwake()
    ? h('button', { class: `btn ghost small${keepingAwake() ? ' on' : ''}`, onclick: async () => (await setKeepAwake(!keepingAwake()), render()), 'aria-pressed': String(keepingAwake()) }, keepingAwake() ? '☀ Screen on' : '☾ Screen can sleep')
    : null;
  const switchDay = (num: number) => () => {
    dayNum = num;
    open = null;
    inputs.clear();
    start();
  };
  return [
    h(
      'header',
      { class: 'top' },
      h(
        'div',
        { class: 'top-row' },
        h('div', null, h('p', { class: 'eyebrow' }, `${shortDay(t.date)} · `, h('a', { href: `#/plans/${t.plan.num}`, class: 'plan-link' }, t.plan.name)), h('h1', null, t.day.name)),
        h('div', { class: 'row tight' }, h('a', { class: 'btn ghost small', href: '#/plans' }, 'Plans'), h('a', { class: 'btn ghost small', href: '#/history' }, 'Past')),
      ),
      h(
        'div',
        { class: 'chips', role: 'tablist', 'aria-label': 'Plan day' },
        ...t.days.map((d) => h('button', { class: `chip${d.id === t.day.id ? ' on' : ''}`, role: 'tab', 'aria-selected': String(d.id === t.day.id), onclick: switchDay(d.id) }, d.name, d.id === t.next && d.id !== t.started ? h('span', { class: 'chip-dot', title: 'Next in the rotation' }, '•') : null)),
      ),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': logged }, h('span', { style: `width:${total ? (logged / total) * 100 : 0}%` })),
      h('div', { class: 'top-row small' }, h('span', { class: 'muted' }, `${logged} of ${total} sets`), awake),
      t.started !== null && t.started !== t.day.id ? h('p', { class: 'note' }, 'You already started another plan day today. Sets here go into a separate workout.') : null,
      t.day.note ? h('p', { class: 'muted small', dir: 'auto' }, t.day.note) : null,
    ),
    h('main', { class: 'list' }, ...t.exercises.map((e) => exerciseCard(e, t.exercises, t.workout?.num ?? null))),
    h(
      'footer',
      { class: 'finish' },
      t.workout
        ? h('button', { class: 'btn primary big', onclick: () => void finish(t) }, t.workout.end ? 'See summary' : 'Finish workout')
        : h('p', { class: 'muted small center' }, 'The workout starts with your first set.'),
    ),
  ];
}

// ------------------------------------------------------------------ summary

function tile(label: string, value: string, sub?: string): HTMLElement {
  return h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, label), h('strong', { class: 'tile-value' }, value), sub ? h('span', { class: 'muted small' }, sub) : null);
}

function renderSummary(s: Summary): void {
  if (route().name !== 'summary') return;
  const w = s.workout;
  const prev = s.previous;
  const change = prev ? prev.currentVolume - prev.volume : null;
  const doneEx = s.exercises.filter((e) => e.logged.length);
  const skipped = s.exercises.filter((e) => !e.logged.length);
  app.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('div', { class: 'top-row' }, h('div', null, h('p', { class: 'eyebrow' }, shortDay(w.day)), h('h1', null, `${w.name} ${w.end ? 'done' : 'so far'}`)), h('a', { class: 'btn ghost small', href: '#/' }, 'Today')),
    ),
    h(
      'main',
      { class: 'pad-x' },
      h(
        'div',
        { class: 'tiles' },
        tile('Time', w.minutes !== null ? `${w.minutes} min` : '—', w.start ? new Date(w.start).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) : undefined),
        tile('Sets', `${s.totals.sets}`, s.totals.plannedSets ? `of ${s.totals.plannedSets} planned` : undefined),
        tile('Volume', `${thousands(s.totals.volume)} kg`, `${s.totals.reps} reps`),
        tile('Records', String(s.totals.records), s.totals.records ? 'new bests' : 'none today'),
      ),
      prev
        ? h(
            'p',
            { class: 'compare' },
            `Last time (${prev.samePlanDay ? '' : `${prev.name}, `}${shortDay(prev.day)}${prev.minutes !== null ? `, ${prev.minutes} min` : ''}): ${thousands(prev.volume)} kg on the ${prev.shared} exercise${prev.shared === 1 ? '' : 's'} you did both times, today ${thousands(prev.currentVolume)} kg. `,
            change !== null ? h('strong', { class: change >= 0 ? 'good-ink' : 'danger-ink' }, `${change >= 0 ? '+' : '−'}${thousands(Math.abs(change))} kg`) : null,
          )
        : h('p', { class: 'compare muted' }, 'Nothing earlier to compare with yet.'),
      ...doneEx.map((e) => {
        // The engine's call needs the whole session; a half-done exercise gets none.
        const finished = e.plannedSets === null || e.logged.length >= e.plannedSets;
        const next = e.next && finished ? VERDICT[e.next.kind] : null;
        const status = e.progress ? STATUS[e.progress.status] : null;
        return h(
          'section',
          { class: 'sum-ex' },
          h('div', { class: 'sum-head' }, h('strong', { dir: 'auto' }, e.name), e.plannedSets !== null ? h('span', { class: 'muted small' }, `${e.logged.length}/${e.plannedSets} sets`) : h('span', { class: 'badge' }, 'extra')),
          h('p', { class: 'sum-sets' }, e.logged.map((x) => `${x.weight === null ? 'BW' : n1(x.weight)}×${x.reps ?? '—'}`).join('  ·  ')),
          h(
            'div',
            { class: 'badges' },
            e.record ? h('span', { class: 'badge good' }, `★ New best ${e.record.label} (was ${e.record.before})`) : null,
            next && e.next ? h('span', { class: `badge ${next[1]}` }, `${next[0]} → ${e.next.nextLabel} × ${e.next.nextSets} sets next time`) : null,
            e.next && finished && e.next.setsReason ? h('span', { class: 'badge accent' }, e.next.setsReason) : null,
            !finished ? h('span', { class: 'badge warn' }, `Unfinished: ${e.logged.length} of ${e.plannedSets} sets`) : null,
            status ? h('span', { class: `badge ${status[1]}` }, status[0]) : null,
          ),
        );
      }),
      skipped.length ? h('p', { class: 'muted small skipped-list' }, h('strong', null, 'Not done: '), skipped.map((e) => e.name).join(', ')) : null,
      h('div', { class: 'row-buttons' }, h('a', { class: 'btn big', href: '#/' }, 'Back to today'), h('a', { class: 'btn big', href: '#/history' }, 'Past workouts')),
    ),
  );
}

function renderHistory(list: Recent): void {
  if (route().name !== 'history') return;
  app.replaceChildren(
    h('header', { class: 'top' }, h('div', { class: 'top-row' }, h('h1', null, 'Past workouts'), h('a', { class: 'btn ghost small', href: '#/' }, 'Today'))),
    h(
      'main',
      { class: 'pad-x' },
      list.length
        ? h(
            'ul',
            { class: 'history' },
            ...list.map((w) =>
              h('li', null, h('a', { href: `#/summary/${w.num}` }, h('span', null, h('strong', null, w.name), h('span', { class: 'muted small' }, ` · ${shortDay(w.day)}`)), h('span', { class: 'muted small' }, `${w.sets} sets${w.minutes !== null ? ` · ${w.minutes} min` : ''}`))),
            ),
          )
        : h('p', { class: 'muted' }, 'Nothing yet.'),
    ),
  );
}

// ------------------------------------------------------------------ the timer bar

const bar = document.getElementById('timer') as HTMLElement;
function renderTimer(): void {
  const r = restNow();
  bar.hidden = !r;
  if (!r) return;
  const left = remaining();
  const over = left === 0;
  bar.className = over ? 'over' : '';
  bar.replaceChildren(
    h('div', { class: 'timer-fill', style: `width:${over ? 100 : ((r.total - left) / r.total) * 100}%` }),
    h(
      'div',
      { class: 'timer-row' },
      h('button', { class: 'btn timer-btn', onclick: () => addRest(-30), 'aria-label': '30 seconds less' }, '−30'),
      h('div', { class: 'timer-mid', role: 'timer', 'aria-live': over ? 'assertive' : 'off' }, h('strong', { class: 'timer-time' }, over ? 'Go' : mmss(left)), h('span', { class: 'timer-label' }, over ? `Rest over · ${r.label}` : r.label)),
      h('button', { class: 'btn timer-btn', onclick: () => addRest(30), 'aria-label': '30 seconds more' }, '+30'),
      h('button', { class: 'btn timer-btn', onclick: () => stopRest(), 'aria-label': over ? 'Dismiss' : 'Skip rest' }, over ? '✓' : 'Skip'),
    ),
  );
}
onRest(renderTimer);
renderTimer();

// ------------------------------------------------------------------ start

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  start();
});
document.addEventListener('pointerdown', unlockSound, { once: true });
// Past midnight with the app open: today moves on.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && localDay() !== date) {
    date = localDay();
    dayNum = undefined;
    if (route().name === 'today') start();
  }
});
client?.subscribeToConnectionState((s) => {
  const now = s.isWebSocketConnected;
  if (now !== online) {
    online = now;
    document.body.classList.toggle('offline', !online);
    if (route().name === 'today') render();
  }
});
start();
