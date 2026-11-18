// رقيب at the gym. Screens on the hash: today's plan day a set at a time (#/), a workout's
// summary (#/summary/<num>), past workouts (#/history), strength score and balance
// (#/strength, in strength.ts), and plans (#/plans, #/plans/<num>,
// in plans.ts). The plans and the engine's suggestions come from Convex; the rest timer
// runs here (timer.ts).
import { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../convex/_generated/api';
import './style.css';
import type { PlanList } from './plans.ts';
import { planEditor, plansScreen } from './plans.ts';
import type { StrengthResult } from './strength.ts';
import { bodyweightChoice, standardsChoice, strengthScreen } from './strength.ts';
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
/** What you changed in the steppers; reps go back to the next set's aim once a set is logged. */
const inputs = new Map<number, { weight?: number; reps?: number }>();
/** Sets sent but not yet confirmed (shown greyed until Convex has them). */
const pending: { id: number; exercise: number; weight: number; reps: number; at: number }[] = [];
let pendingId = 0;
let unsubscribe: (() => void) | null = null;
let online = true;
let plans: PlanList | undefined;
let strength: StrengthResult | undefined;

function renderStrength(): void {
  if (route().name !== 'strength' || !strength) return;
  const y = window.scrollY;
  app.replaceChildren(...strengthScreen(strength, { rerender: renderStrength, refresh: start }));
  window.scrollTo(0, y);
}

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

type Route = { name: 'today' } | { name: 'summary'; num: number } | { name: 'history' } | { name: 'strength' } | { name: 'plans' } | { name: 'plan'; num: number };

function route(): Route {
  const m = /^#\/summary\/(\d+)$/.exec(location.hash);
  if (m) return { name: 'summary', num: Number(m[1]) };
  const p = /^#\/plans\/(\d+)$/.exec(location.hash);
  if (p) return { name: 'plan', num: Number(p[1]) };
  if (location.hash === '#/plans') return { name: 'plans' };
  if (location.hash === '#/history') return { name: 'history' };
  if (location.hash === '#/strength') return { name: 'strength' };
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
  } else if (r.name === 'strength') {
    const k = key;
    const bodyweight = bodyweightChoice();
    if (strength) renderStrength();
    else app.replaceChildren(h('p', { class: 'muted pad' }, 'Working out your scores…'));
    watch<StrengthResult>((cb, err) => client.onUpdate(api.strength.scores, { key: k, date: localDay(), standards: standardsChoice(), ...(bodyweight !== undefined ? { bodyweight } : {}) }, cb, err), (v) => {
      strength = v;
      renderStrength();
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

/**
 * Today's reps to aim for, set by set, at the suggested weight. "Same weight: beat your reps"
 * becomes one more than last time on each set; a set already at or past the top of the range
 * aims to match it (never fewer than last time). A set with nothing at this weight before
 * (new lift, weight just added, or a set more than last time) aims for the bottom of the range.
 */
function aimsOf(e: Exercise): number[] {
  return Array.from({ length: Math.max(1, e.sets) }, (_, i) => {
    const last = e.beat?.[i];
    if (last === undefined) return e.repMin;
    return last >= e.repMax ? last : Math.max(e.repMin, last + 1);
  });
}
const aimAt = (e: Exercise, i: number) => {
  const aims = aimsOf(e);
  return aims[i] ?? (aims.at(-1) as number);
};

function defaults(e: Exercise): { weight: number; reps: number } {
  const set = inputs.get(e.num);
  const mine = pending.filter((p) => p.exercise === e.num).at(-1);
  const last = e.logged.at(-1);
  const weight = set?.weight ?? mine?.weight ?? (last ? (last.weight ?? 0) : e.suggested);
  // At the suggested weight the next set's aim; at another, what you did last set.
  const reps = set?.reps ?? (weight === e.suggested ? aimAt(e, done(e)) : (mine?.reps ?? last?.reps ?? e.repMin));
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

const weightField = (e: Exercise) => (e.bodyweight ? 'Added kg' : e.perHand ? 'kg per hand' : e.perSide ? 'kg per side' : 'kg');

/** A small stroke icon (fixed markup, no data in it). */
function icon(paths: string): HTMLElement {
  const s = h('span', { class: 'icon', 'aria-hidden': 'true' });
  s.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return s;
}
const PENCIL = '<path d="M4 20h4L19 9l-4-4L4 16v4z"></path>';
const MENU = '<path d="M4 7h16M4 12h16M4 17h16"></path>';

const STATUS: Record<string, [string, string]> = { ahead: ['Ahead of goal', 'good'], 'on track': ['On track', 'accent'], behind: ['Behind goal', 'danger'] };
const VERDICT: Record<string, [string, string]> = { ADD_WEIGHT: ['Add weight', 'good'], HOLD: ['Same weight', 'accent'], TOO_HEAVY: ['Too heavy', 'danger'] };

/** How hard a set was, as reps left in the tank; stored as RPE so the PC reads it too. */
const EFFORT = [
  { label: 'Easy', sub: '3+ left', rpe: 7 },
  { label: 'Solid', sub: '1–2 left', rpe: 8.5 },
  { label: 'All out', sub: '0 left', rpe: 10 },
] as const;
const effortOf = (rpe: number | null) => (rpe === null ? null : rpe <= 7.5 ? EFFORT[0] : rpe < 9.5 ? EFFORT[1] : EFFORT[2]);

function effortChips(current: number | null, pick: (rpe: number | null) => void): HTMLElement {
  const on = effortOf(current);
  return h(
    'div',
    { class: 'effort', role: 'group', 'aria-label': 'How hard it was' },
    ...EFFORT.map((x) => h('button', { class: `btn effort-btn${on === x ? ' picked' : ''}`, 'aria-pressed': String(on === x), onclick: () => pick(on === x ? null : x.rpe) }, x.label, h('span', { class: 'effort-sub' }, x.sub))),
  );
}

/** A logged set being fixed in the dock. */
let editing: { exercise: number; workoutNum: number; setId: number; no: number; weight: number; reps: number; rpe: number | null } | null = null;
/** The "finish with sets left?" sheet is up. */
let confirming = false;

async function logSet(e: Exercise, all: Exercise[]): Promise<void> {
  unlockSound();
  const { weight, reps } = defaults(e);
  const id = ++pendingId;
  const at = Date.now();
  pending.push({ id, exercise: e.num, weight, reps, at });
  // The weight carries on (it's the last set's now); reps start again from the next set's aim.
  inputs.delete(e.num);
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
    const res = await client!.mutation(api.training.logSet, { key: key!, date, exerciseNum: e.num, weight, reps, at });
    settle();
    toast(`Set ${n} logged · ${wLabel(weight, e)} × ${reps}`, false, { label: 'Undo', run: () => void undoLog(e, res) });
  } catch (err) {
    settle();
    toast(message(err), true);
  }
}

/** Undo of a set just logged: it goes, and so does the rest it started. */
async function undoLog(e: Exercise, res: { workoutNum: number; setNum: number }): Promise<void> {
  stopRest();
  open = e.num;
  if (await attempt(() => client!.mutation(api.training.deleteSet, { key: key!, workoutNum: res.workoutNum, setNum: res.setNum }), 'Set taken back')) render();
}

async function saveEdit(ed: NonNullable<typeof editing>): Promise<void> {
  editing = null;
  render();
  try {
    const before = await client!.mutation(api.training.editSet, { key: key!, workoutNum: ed.workoutNum, setNum: ed.setId, weight: ed.weight, reps: ed.reps, rpe: ed.rpe });
    toast(`Set ${ed.no} saved`, false, {
      label: 'Undo',
      run: () =>
        void attempt(
          () => client!.mutation(api.training.editSet, { key: key!, workoutNum: ed.workoutNum, setNum: ed.setId, weight: before.weight ?? 0, ...(before.reps !== null ? { reps: before.reps } : {}), rpe: before.rpe }),
          'Change undone',
        ),
    });
  } catch (err) {
    toast(message(err), true);
  }
}

async function removeSet(ed: NonNullable<typeof editing>): Promise<void> {
  editing = null;
  render();
  try {
    const gone = await client!.mutation(api.training.deleteSet, { key: key!, workoutNum: ed.workoutNum, setNum: ed.setId });
    toast(`Set ${ed.no} removed`, false, { label: 'Undo', run: () => void attempt(() => client!.mutation(api.training.restoreSet, { key: key!, workoutNum: ed.workoutNum, set: gone }), 'Set put back') });
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

/** Seconds between each logged set and the one logged before it in the workout (any exercise). */
function gapsOf(all: Exercise[]): Map<number, number> {
  const timed = all.flatMap((x) => x.logged).filter((s) => s.at !== null).sort((a, b) => (a.at as number) - (b.at as number));
  return new Map(timed.slice(1).map((s, i) => [s.id, Math.round(((s.at as number) - (timed[i]!.at as number)) / 1000)]));
}

/** When the last set was logged: a pending one counts from its tap. */
function lastLoggedAt(all: Exercise[]): number | null {
  const times = [...all.flatMap((x) => x.logged.map((s) => s.at)), ...pending.map((p) => p.at)].filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

/** The clock since the last set: counts on its own, so it's right even when the rest timer was missed. */
let sinceTick = 0;
function sinceLastSet(t: { exercises: Exercise[]; workout: { end: number | null } | null }): HTMLElement | null {
  window.clearInterval(sinceTick);
  const last = lastLoggedAt(t.exercises);
  if (last === null || t.workout?.end) return null;
  const value = h('strong', { class: 'since-time' }, mmss(Math.max(0, Math.round((Date.now() - last) / 1000))));
  sinceTick = window.setInterval(() => {
    if (!value.isConnected) return window.clearInterval(sinceTick);
    value.textContent = mmss(Math.max(0, Math.round((Date.now() - last) / 1000)));
  }, 1000);
  return h('span', { class: 'since', role: 'timer', 'aria-label': 'Time since your last set' }, 'Since last set ', value);
}

/** Reps against today's aim for that set, at the suggested weight. */
function compared(reps: number | null, aim: number | undefined): HTMLElement | null {
  if (reps === null || aim === undefined) return null;
  const d = reps - aim;
  return h('span', { class: `set-cmp${d >= 0 ? ' good' : ' warn'}` }, d > 0 ? `aim ${aim}, beat by ${d}` : d < 0 ? `aim ${aim}, ${-d} short` : `hit aim ${aim}`);
}

/** Pieces joined with " · ". */
function dotted(...parts: (HTMLElement | string | null)[]): HTMLElement | null {
  const kept = parts.filter((p): p is HTMLElement | string => p !== null);
  return kept.length ? h('span', { class: 'set-sub' }, ...kept.flatMap((p, i) => (i ? [' · ', p] : [p]))) : null;
}

function exerciseCard(e: Exercise, all: Exercise[], workoutNum: number | null): HTMLElement {
  const count = done(e);
  const complete = count >= e.sets;
  const isOpen = open === e.num;
  const head = h(
    'button',
    { class: 'ex-head', onclick: () => ((open = isOpen ? null : e.num), (editing = null), render()), 'aria-expanded': String(isOpen) },
    h('span', { class: `ex-dot${complete ? ' done' : count ? ' some' : ''}`, 'aria-hidden': 'true' }, complete ? '✓' : ''),
    h('span', { class: 'ex-name', dir: 'auto' }, e.name),
    h('span', { class: 'ex-meta' }, `${count}/${e.sets}`, h('span', { class: 'ex-weight' }, wLabel(e.suggested, e))),
  );
  if (!isOpen) return h('section', { class: `ex${complete ? ' complete' : ''}`, id: `ex-${e.num}` }, head);

  const { weight, reps } = defaults(e);
  const progress = e.progress ? STATUS[e.progress.status] : null;
  const gaps = gapsOf(all);
  // "Last time" reps only mean something at the weight they were done at.
  const atAim = (w: number | null) => (w ?? 0) === e.suggested;
  const lastAt = lastLoggedAt(all);
  const rows: HTMLElement[] = [
    ...e.logged.map((s, i) => {
      const w = s.weight ?? (e.bodyweight ? 0 : null);
      const gap = gaps.get(s.id);
      const isEditing = editing?.setId === s.id;
      return h(
        'li',
        null,
        h(
          'button',
          {
            class: `set logged${isEditing ? ' editing' : ''}`,
            'aria-label': `Edit set ${i + 1}: ${wLabel(w, e)} × ${s.reps ?? '—'}`,
            onclick: () => {
              if (workoutNum === null) return;
              editing = { exercise: e.num, workoutNum, setId: s.id, no: i + 1, weight: w ?? 0, reps: s.reps ?? 0, rpe: s.rpe };
              render();
            },
          },
          h('span', { class: 'set-no' }, `Set ${i + 1}`),
          h('span', { class: 'set-what' }, `${wLabel(w, e)} × ${s.reps ?? '—'}`, dotted(compared(s.reps, atAim(w) ? aimAt(e, i) : undefined), gap !== undefined ? `rested ${mmss(gap)}` : null, effortOf(s.rpe)?.label ?? null)),
          icon(PENCIL),
        ),
      );
    }),
    ...pending
      .filter((p) => p.exercise === e.num)
      .map((p, i) => h('li', { class: 'set saving' }, h('span', { class: 'set-no' }, `Set ${e.logged.length + i + 1}`), h('span', { class: 'set-what' }, `${wLabel(p.weight, e)} × ${p.reps}`), h('span', { class: 'muted small' }, online ? 'saving…' : 'waiting for signal'))),
  ];
  // Sets still to do: weight × today's aim, and last time's reps beside it.
  const lastTime = (k: number) => (e.beat && atAim(weight) && e.beat[k] !== undefined ? `last time ${e.beat[k]}` : null);
  if (!complete && !editing) {
    rows.push(
      h(
        'li',
        { class: 'set current' },
        h('span', { class: 'set-no' }, `Set ${count + 1}`),
        h(
          'span',
          { class: 'set-what' },
          h('span', { id: 'cur-what' }, `${wLabel(weight, e)} × ${reps}`),
          dotted(atAim(weight) ? h('strong', { class: 'set-aim' }, `aim ${aimAt(e, count)}`) : `${e.repMin}–${e.repMax} reps`, lastTime(count)),
        ),
        h('button', { class: 'btn primary', onclick: () => void logSet(e, all), 'aria-label': `Log set ${count + 1}` }, 'Log'),
      ),
    );
  }
  for (let k = complete ? e.sets : count + 1; k < e.sets; k++) {
    rows.push(
      h(
        'li',
        { class: 'set future' },
        h('span', { class: 'set-no' }, `Set ${k + 1}`),
        h('span', { class: 'set-what' }, atAim(weight) ? h('span', null, wLabel(weight, e), ' × ', h('strong', { class: 'set-aim' }, String(aimAt(e, k)))) : `${wLabel(weight, e)} × ${e.repMin}–${e.repMax}`, dotted(lastTime(k))),
      ),
    );
  }

  // One tap for how the set just logged felt; it goes once answered, or once another set is in.
  const latest = e.logged.at(-1);
  const askEffort = workoutNum !== null && !editing && latest !== undefined && latest.rpe === null && latest.at !== null && latest.at === lastAt && Date.now() - latest.at < 20 * 60_000;
  return h(
    'section',
    { class: `ex open${complete ? ' complete' : ''}`, id: `ex-${e.num}` },
    head,
    h(
      'div',
      { class: 'ex-body' },
      h('div', { class: 'ex-plan' }, h('span', null, `${e.sets} × ${e.repMin}–${e.repMax}`), progress ? h('span', { class: `badge ${progress[1]}` }, progress[0]) : null, restPicker(e)),
      e.last
        ? h('p', { class: 'muted small' }, `Last ${shortDay(e.last.day)}: ${wLabel(e.last.weight, e)} × ${e.last.reps.join('/')}`, e.lastVerdict ? `. ${e.lastVerdict}` : '')
        : h('p', { class: 'muted small' }, 'First time on the plan'),
      e.setsReason ? h('p', { class: 'small' }, h('span', { class: 'badge accent' }, `${e.sets} sets`), ` ${e.setsReason}`) : null,
      ...e.flags.map((f) => h('p', { class: 'note' }, f.message)),
      e.note ? h('p', { class: 'muted small', dir: 'auto' }, e.note) : null,
      h('ol', { class: 'sets' }, rows),
      askEffort
        ? h(
            'div',
            { class: 'effort-ask' },
            h('p', { class: 'small' }, h('strong', null, `How hard was set ${e.logged.length}?`), h('span', { class: 'muted' }, ' Optional')),
            effortChips(null, (rpe) => void attempt(() => client!.mutation(api.training.editSet, { key: key!, workoutNum, setNum: latest.id, rpe }), rpe === null ? undefined : `Set ${e.logged.length}: ${effortOf(rpe)!.label}`)),
          )
        : null,
      // The engine's call needs the whole session: shown once the planned sets are in.
      e.now && e.logged.length >= e.sets ? h('p', { class: `now ${VERDICT[e.now.kind]?.[1] ?? ''}` }, e.now.message) : null,
      plannedSets(e),
    ),
  );
}

const logText = (e: Exercise) => {
  const c = done(e);
  const { weight, reps } = defaults(e);
  return `${c >= e.sets ? 'Log extra set' : `Log set ${c + 1}`} · ${wLabel(weight, e)} × ${reps}`;
};

/** The stepper changed: the dock's button and the highlighted row say the new numbers. */
function updateLive(e: Exercise): void {
  const { weight, reps } = defaults(e);
  const b = document.getElementById('log-btn');
  if (b) b.textContent = logText(e);
  const c = document.getElementById('cur-what');
  if (c) c.textContent = `${wLabel(weight, e)} × ${reps}`;
}

/** Pinned to the bottom, under the thumb: the next set's weight and reps and its Log button, or the set being fixed. */
function dock(t: Today, e: Exercise): HTMLElement {
  if (editing && editing.exercise === e.num) {
    const ed = editing;
    return h(
      'div',
      { class: 'dock', id: 'dock' },
      h('div', { class: 'dock-head' }, h('span', { dir: 'auto' }, `Editing set ${ed.no} · ${e.name}`)),
      h('div', { class: 'inputs' }, stepper(weightField(e), ed.weight, e.step, e.bodyweight ? -200 : 0, (v) => (ed.weight = v), true), stepper('Reps', ed.reps, 1, 0, (v) => (ed.reps = v), false)),
      effortChips(ed.rpe, (rpe) => ((ed.rpe = rpe), render())),
      h(
        'div',
        { class: 'dock-actions' },
        h('button', { class: 'btn danger-ghost', onclick: () => void removeSet(ed) }, 'Remove'),
        h('button', { class: 'btn', onclick: () => ((editing = null), render()) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => void saveEdit(ed) }, 'Save'),
      ),
    );
  }
  const count = done(e);
  const { weight, reps } = defaults(e);
  const set = (patch: Partial<{ weight: number; reps: number }>) => {
    inputs.set(e.num, { ...inputs.get(e.num), ...patch });
    updateLive(e);
  };
  return h(
    'div',
    { class: 'dock', id: 'dock' },
    h('div', { class: 'dock-head' }, h('span', { dir: 'auto' }, `${count >= e.sets ? `Extra set ${count + 1}` : `Set ${count + 1} of ${e.sets}`} · ${e.name}`), sinceLastSet(t)),
    h('div', { class: 'inputs' }, stepper(weightField(e), weight, e.step, e.bodyweight ? -200 : 0, (v) => set({ weight: v }), true), stepper('Reps', reps, 1, 0, (v) => set({ reps: v }), false)),
    h('button', { class: 'btn primary big', id: 'log-btn', onclick: () => void logSet(e, t.exercises) }, logText(e)),
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

const unfinished = (t: Today) => t.exercises.filter((e) => done(e) < e.sets);

/** Before finishing with sets left: what's not done, and what that means for next time. */
function finishSheet(t: Today): HTMLElement {
  const left = unfinished(t);
  const partial = left.filter((e) => done(e) > 0);
  const first = (partial[0] ?? left[0]) as Exercise;
  const total = t.exercises.reduce((n, e) => n + e.sets, 0);
  const logged = t.exercises.reduce((n, e) => n + Math.min(done(e), e.sets), 0);
  const minutes = t.workout?.start ? Math.round((Date.now() - t.workout.start) / 60_000) : null;
  const close = () => ((confirming = false), render());
  const why = [
    partial.length ? `A half-done lift counts as a short session, so it usually holds the weight next time.` : null,
    left.length > partial.length ? `Lifts you didn't start keep their aim.` : null,
  ].filter(Boolean);
  return h(
    'div',
    { class: 'sheet-wrap', onclick: (ev: MouseEvent) => ev.target === ev.currentTarget && close() },
    h(
      'section',
      { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'finish-title' },
      h('h2', { id: 'finish-title', dir: 'auto' }, `Finish ${t.day.name}?`),
      h('p', { class: 'muted' }, `${logged} of ${total} planned sets done${minutes !== null ? ` · ${minutes} min` : ''}`),
      h(
        'ul',
        { class: 'left-list' },
        ...left.map((e) => h('li', { class: done(e) ? 'part' : '' }, h('span', { dir: 'auto' }, e.name), h('span', { class: 'small' }, done(e) ? `${done(e)} of ${e.sets} sets` : `not started · ${e.sets} sets`))),
      ),
      h('p', { class: 'muted small' }, why.join(' ')),
      h(
        'button',
        {
          class: 'btn primary big',
          onclick: () => {
            confirming = false;
            editing = null;
            open = first.num;
            render();
            document.getElementById(`ex-${first.num}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          },
        },
        `Keep training: ${first.name}`,
      ),
      h('button', { class: 'btn big', onclick: () => ((confirming = false), void finish(t)) }, 'Finish anyway'),
    ),
  );
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
  // A set being fixed that's gone (removed on the PC, say) closes the editor.
  if (editing && !t.exercises.some((e) => e.logged.some((s) => s.id === editing!.setId))) editing = null;
  const current = t.exercises.find((e) => e.num === open);
  const total = t.exercises.reduce((n, e) => n + e.sets, 0);
  const logged = t.exercises.reduce((n, e) => n + Math.min(done(e), e.sets), 0);
  const awake = canKeepAwake()
    ? h('button', { class: `btn ghost small${keepingAwake() ? ' on' : ''}`, onclick: async () => (await setKeepAwake(!keepingAwake()), render()), 'aria-pressed': String(keepingAwake()) }, keepingAwake() ? '☀ Screen on' : '☾ Screen can sleep')
    : null;
  const switchDay = (num: number) => () => {
    dayNum = num;
    open = null;
    editing = null;
    inputs.clear();
    start();
  };
  const workout = t.workout;
  return [
    h(
      'header',
      { class: 'top' },
      h(
        'div',
        { class: 'top-row' },
        h('div', { class: 'grow' }, h('p', { class: 'eyebrow' }, `${shortDay(t.date)} · `, h('a', { href: `#/plans/${t.plan.num}`, class: 'plan-link' }, t.plan.name)), h('h1', null, t.day.name)),
        h(
          'details',
          { class: 'menu' },
          h('summary', { class: 'btn ghost menu-btn', 'aria-label': 'Menu' }, icon(MENU)),
          h('nav', { class: 'menu-list' }, h('a', { href: '#/strength' }, 'Strength score'), h('a', { href: '#/plans' }, 'Plans'), h('a', { href: '#/history' }, 'Past workouts')),
        ),
      ),
      h(
        'div',
        { class: 'chips', role: 'tablist', 'aria-label': 'Plan day' },
        ...t.days.map((d) =>
          h(
            'button',
            { class: `chip${d.id === t.day.id ? ' on' : ''}`, role: 'tab', 'aria-selected': String(d.id === t.day.id), onclick: switchDay(d.id) },
            d.name,
            d.id === t.next && d.id !== t.started ? h('span', { class: 'chip-dot' }, h('span', { 'aria-hidden': 'true' }, '•'), h('span', { class: 'sr-only' }, ' (next in the rotation)')) : null,
          ),
        ),
      ),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': logged }, h('span', { style: `width:${total ? (logged / total) * 100 : 0}%` })),
      h('div', { class: 'top-row small' }, h('span', { class: 'muted' }, `${logged} of ${total} sets`), awake),
      t.started !== null && t.started !== t.day.id ? h('p', { class: 'note' }, 'You already started another plan day today. Sets here go into a separate workout.') : null,
      t.day.note ? h('p', { class: 'muted small', dir: 'auto' }, t.day.note) : null,
    ),
    h('main', { class: 'list' }, ...t.exercises.map((e) => exerciseCard(e, t.exercises, workout?.num ?? null))),
    h(
      'footer',
      { class: 'finish' },
      workout
        ? h(
            'button',
            { class: 'btn big', onclick: () => (!workout.end && unfinished(t).length ? ((confirming = true), render()) : void finish(t)) },
            workout.end ? 'See summary' : 'Finish workout',
          )
        : h('p', { class: 'muted small center' }, 'The workout starts with your first set.'),
    ),
    ...(current ? [dock(t, current)] : []),
    ...(confirming && workout ? [finishSheet(t)] : []),
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
        tile('Between sets', s.totals.avgRest !== null ? mmss(s.totals.avgRest) : '—', s.totals.longestRest !== null ? `average · longest ${mmss(s.totals.longestRest)}` : 'average'),
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
          e.logged.some((x) => x.rest !== null)
            ? h('p', { class: 'muted small' }, `⏱ ${e.logged.map((x) => (x.rest === null ? '—' : mmss(x.rest))).join('  ·  ')}`, e.avgRest !== null ? `  (average ${mmss(e.avgRest)})` : '')
            : null,
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
      h('div', { class: 'row-buttons' }, h('a', { class: 'btn big', href: '#/' }, 'Back to today'), h('a', { class: 'btn big', href: '#/history' }, 'Past workouts'), h('a', { class: 'btn big', href: '#/strength' }, 'Strength score')),
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
  document.body.classList.toggle('resting', !!r);
  if (!r) return;
  const left = remaining();
  const over = left === 0;
  // Past the end it counts on, so the clock since the last set needs no second display.
  const late = over ? Math.max(0, Math.floor((Date.now() - r.endsAt) / 1000)) : 0;
  bar.className = over ? 'over' : '';
  bar.replaceChildren(
    h('div', { class: 'timer-fill', style: `width:${over ? 100 : ((r.total - left) / r.total) * 100}%` }),
    h(
      'div',
      { class: 'timer-row' },
      h('button', { class: 'btn timer-btn', onclick: () => addRest(-30), 'aria-label': '30 seconds less' }, '−30'),
      h('div', { class: 'timer-mid', role: 'timer', 'aria-live': over ? 'assertive' : 'off' }, h('strong', { class: 'timer-time' }, over ? `+${mmss(late)}` : mmss(left)), h('span', { class: 'timer-label' }, over ? `Rest over · ${r.label}` : r.label)),
      h('button', { class: 'btn timer-btn', onclick: () => addRest(30), 'aria-label': '30 seconds more' }, '+30'),
      h('button', { class: 'btn timer-btn', onclick: () => stopRest(), 'aria-label': over ? 'Dismiss the timer' : 'Skip rest' }, over ? 'Done' : 'Skip'),
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
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && confirming) {
    confirming = false;
    render();
  }
});
// The dock's height: the timer sits on it, and the page leaves room for both.
const dockSize = new ResizeObserver(() => syncDock());
function syncDock(): void {
  const d = document.getElementById('dock');
  document.body.classList.toggle('has-dock', !!d);
  document.body.style.setProperty('--dock-h', `${d?.offsetHeight ?? 0}px`);
}
new MutationObserver(() => {
  dockSize.disconnect();
  const d = document.getElementById('dock');
  if (d) dockSize.observe(d);
  syncDock();
}).observe(app, { childList: true });
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
