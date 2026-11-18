// The strength screen (#/strength): the overall strength score, what to do next, each muscle
// group's score with its trend and next targets, how the groups balance, and the score week
// by week. The numbers come from Convex (convex/strength.ts); the standards and figure
// shading choices stay on this phone.
import type { FunctionReturnType } from 'convex/server';
import type { api } from '../convex/_generated/api';
import type { FigureMode } from '../../tracker/src/bodyFigure.ts';
import { bodyFigureSvg, FIGURE_LEGEND, RELATIVE_LEGEND } from '../../tracker/src/bodyFigure.ts';
import { h, n1, store } from './ui.ts';

export type StrengthResult = FunctionReturnType<typeof api.strength.scores>;
type Group = StrengthResult['scores']['groups'][number];

export interface StrengthCtx {
  /** Draw again from the same numbers (a group opened). */
  rerender: () => void;
  /** Ask again: the standards or the bodyweight changed. */
  refresh: () => void;
}

const LEVEL_NAMES = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
const SVG = 'http://www.w3.org/2000/svg';

export const standardsChoice = (): 'men' | 'women' => (store.get('gym.standards') === 'women' ? 'women' : 'men');
export const bodyweightChoice = (): number | undefined => {
  const v = Number(store.get('gym.bodyweight'));
  return v >= 25 && v <= 300 ? v : undefined;
};
const figureMode = (): FigureMode => (store.get('gym.figureMode') === 'level' ? 'level' : 'relative');

function svg(tag: string, attrs: Record<string, string | number>, ...children: Node[]): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en', { day: 'numeric', month: 'short' });
const kg = (w: number | null) => (w === null ? 'BW' : `${n1(w)} kg`);
const CONFIDENCE = { high: 'High', medium: 'Medium', low: 'Low' } as const;
const DAY_MS = 86_400_000;

/** Points into the current level (0–99) and the level above; null at Elite or without a score. */
function inLevel(score: number | null): { into: number; next: number; nextName: string } | null {
  if (score === null || score >= 500) return null;
  const next = (Math.floor(score / 100) + 1) * 100;
  return { into: score % 100, next, nextName: LEVEL_NAMES[next / 100 - 1] as string };
}

/** A bar for the way through the current level. */
function levelProgress(score: number | null, label: string): HTMLElement | null {
  const at = inLevel(score);
  if (!at) return null;
  return h('div', { class: 'lvl-bar', role: 'img', 'aria-label': `${label}: ${at.into}% of the way to ${at.nextName}` }, h('span', { class: 'lvl-fill', style: `width:${at.into}%` }));
}

/** A score week by week; hover or tap shows a week. */
function trendChart(days: readonly string[], values: readonly (number | null)[], what: string): HTMLElement | null {
  const pts = values.map((v, i) => ({ v, i, day: days[i] as string })).filter((p): p is { v: number; i: number; day: string } => p.v !== null);
  if (pts.length < 2) return null;
  const W = 320;
  const H = 96;
  const pad = 6;
  const lo = Math.max(0, Math.floor((Math.min(...pts.map((p) => p.v)) - 20) / 50) * 50);
  const hi = Math.ceil((Math.max(...pts.map((p) => p.v)) + 20) / 50) * 50;
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const last = pts.at(-1) as (typeof pts)[number];
  const dot = svg('circle', { r: 4, class: 'trend-dot', cx: x(last.i), cy: y(last.v) });
  const readout = h('span', { class: 'muted small trend-readout' }, `${shortDay(last.day)}: ${last.v}`);
  const chart = svg(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'trend', role: 'img', 'aria-label': `${what} over ${values.length} weeks, from ${pts[0]!.v} to ${last.v}` },
    ...[lo, hi].map((v) => svg('line', { x1: 0, x2: W, y1: y(v), y2: y(v), class: 'trend-grid' })),
    svg('polyline', { points: pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '), class: 'trend-line' }),
    dot,
  );
  const pick = (clientX: number) => {
    const box = chart.getBoundingClientRect();
    const at = ((clientX - box.left) / box.width) * W;
    const p = pts.reduce((a, b) => (Math.abs(x(b.i) - at) < Math.abs(x(a.i) - at) ? b : a));
    dot.setAttribute('cx', String(x(p.i)));
    dot.setAttribute('cy', String(y(p.v)));
    readout.textContent = `Week of ${shortDay(p.day)}: ${p.v}`;
  };
  chart.addEventListener('pointermove', (e) => pick((e as PointerEvent).clientX));
  chart.addEventListener('pointerdown', (e) => pick((e as PointerEvent).clientX));
  return h('div', { class: 'trend-wrap' }, h('div', { class: 'trend-axis muted small' }, h('span', null, String(hi)), h('span', null, String(lo))), chart, readout);
}

/** A small line of a group's score; scaled to at least 40 points so a flat line looks flat. */
function sparkline(values: readonly (number | null)[]): SVGElement | null {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return null;
  const W = 56;
  const H = 20;
  let lo = Math.min(...pts.map((p) => p[1]));
  let hi = Math.max(...pts.map((p) => p[1]));
  if (hi - lo < 40) [lo, hi] = [(hi + lo) / 2 - 20, (hi + lo) / 2 + 20];
  const x = (i: number) => 1 + (i / (values.length - 1)) * (W - 2);
  const y = (v: number) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
  return svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' }, svg('polyline', { points: pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') }));
}

/** The few things that would change the numbers most (strengthFocus). */
function focusCard(items: StrengthResult['focus']): HTMLElement | null {
  if (!items.length) return null;
  return h(
    'section',
    { class: 'card' },
    h('strong', null, 'Focus next'),
    h('ul', { class: 'focus-list' }, ...items.map((f) => h('li', { class: `focus-item ${f.kind}` }, h('b', null, f.title), h('span', { class: 'small' }, f.detail)))),
  );
}

/** Confidence, and whether the score is old or about to age out. */
function groupStatus(g: Group, today: string): HTMLElement | null {
  if (!g.confidence) return null;
  const soon = g.keptUntil !== null && !g.lapsed && Date.parse(`${g.keptUntil}T12:00:00`) - Date.parse(`${today}T12:00:00`) <= 21 * DAY_MS;
  return h(
    'p',
    { class: 'small grp-status' },
    h('span', { class: 'conf' }, h('i', { class: `conf-dot ${g.confidence}`, 'aria-hidden': 'true' }), `${CONFIDENCE[g.confidence]} confidence`),
    g.lapsed && g.keptUntil ? h('span', { class: 'warn-ink' }, `Not trained in 90 days · kept until ${shortDay(g.keptUntil)}`) : null,
    soon && g.keptUntil ? h('span', { class: 'warn-ink' }, `Ages out after ${shortDay(g.keptUntil)}`) : null,
  );
}

/** The near step (+25) when the next level is far, then the next level. */
function targets(g: Group): HTMLElement | null {
  if (!g.next || !g.best) return null;
  const at = inLevel(g.score);
  return h(
    'p',
    { class: 'small grp-next' },
    g.milestone ? h('span', null, `Next +25: ${kg(g.milestone.weight)} × ${g.milestone.reps}`) : null,
    h('span', { class: g.milestone ? 'muted' : '' }, `${g.next.level}${at ? ` (${g.next.score - (g.score ?? 0)} to go)` : ''}: ${kg(g.next.weight)} × ${g.next.reps}`),
    h('span', { class: 'muted', dir: 'auto' }, `on ${g.best.exercise}`),
  );
}

function groupCard(g: Group, r: StrengthResult, open: Set<string>, rerender: () => void): HTMLElement {
  const isOpen = open.has(g.id);
  const toggle = () => (isOpen ? open.delete(g.id) : open.add(g.id), rerender());
  const history = r.trend.map((p) => p.groups[g.id] ?? null);
  return h(
    'section',
    { class: 'grp' },
    h(
      'button',
      { class: 'grp-head', onclick: toggle, 'aria-expanded': String(isOpen), disabled: !g.best },
      h('span', { class: 'grp-name' }, g.name),
      sparkline(history),
      h('span', { class: 'grp-score' }, g.score ?? '—'),
      h('span', { class: `badge${g.level ? ' accent' : ''}` }, g.level ?? (g.score === null ? 'No recent lifts' : 'Below beginner')),
      g.best ? h('span', { class: `chev${isOpen ? ' open' : ''}`, 'aria-hidden': 'true' }) : null,
    ),
    levelProgress(g.score, g.name),
    g.best
      ? h('p', { class: 'muted small grp-best', dir: 'auto' }, `${g.best.exercise}: ${kg(g.best.weight)} × ${g.best.reps}, ${shortDay(g.best.day)}`, g.ratio !== null ? ` · ${n1(g.ratio)}× bodyweight as ${g.reference.toLowerCase()}` : '')
      : h('p', { class: 'muted small grp-best' }, `Log a ${g.reference.toLowerCase()} or similar lift to score it.`),
    groupStatus(g, r.scores.day),
    targets(g),
    isOpen
      ? h(
          'div',
          { class: 'grp-more' },
          trendChart(r.trend.map((p) => p.day), history, g.name),
          g.best
            ? h('p', { class: 'muted small', dir: 'auto' }, `How it's worked out: ${kg(g.best.weight)} × ${g.best.reps} on ${g.best.exercise} is a ${n1(g.best.e1rm)} kg 1RM, ${n1(g.best.equivalent)} kg as a ${g.reference.toLowerCase()}, ${g.ratio !== null ? `${n1(g.ratio)}×` : ''} your bodyweight.`)
            : null,
          h('ul', { class: 'grp-lifts' }, ...g.lifts.map((l) => h('li', null, h('span', { dir: 'auto' }, l.exercise), h('span', { class: 'muted' }, `${kg(l.weight)} × ${l.reps}`), h('strong', null, String(l.score))))),
        )
      : null,
  );
}

/** The body figure with each group's score on it, shaded against your average or by level. */
function figureCard(groups: Group[], ctx: StrengthCtx): HTMLElement {
  const mode = figureMode();
  const wrap = h('div', { class: 'figure-wrap' });
  // Fixed shapes from bodyFigure.ts; the group names in it are escaped there.
  wrap.innerHTML = bodyFigureSvg(groups, mode);
  const readout = h('p', { class: 'muted small figure-readout', 'aria-live': 'polite' }, 'Tap a muscle to see its score.');
  const byId = new Map(groups.map((g) => [g.id, g]));
  const show = (id: string | undefined) => {
    const g = id ? byId.get(id as Group['id']) : undefined;
    if (!g) return;
    readout.textContent = `${g.name}: ${g.score ?? '—'} · ${g.level ?? (g.score === null ? 'no recent lifts' : 'below Beginner')}${g.best ? ` — ${g.best.exercise}, ${kg(g.best.weight)} × ${g.best.reps}` : ''}`;
    wrap.querySelectorAll<SVGElement>('.bf-m, .bf-num').forEach((m) => m.classList.toggle('bf-on', m.dataset['group'] === id));
  };
  wrap.addEventListener('click', (e) => show((e.target as SVGElement).dataset?.['group']));
  wrap.addEventListener('focusin', (e) => show((e.target as SVGElement).dataset?.['group']));
  const legend = mode === 'relative' ? RELATIVE_LEGEND : FIGURE_LEGEND;
  const toggle = h(
    'div',
    { class: 'chips', role: 'radiogroup', 'aria-label': 'Shading' },
    ...([['relative', 'vs your average'], ['level', 'Level']] as const).map(([v, name]) =>
      h('button', { class: `chip${mode === v ? ' on' : ''}`, role: 'radio', 'aria-checked': String(mode === v), onclick: () => (store.set('gym.figureMode', v), ctx.rerender()) }, name),
    ),
  );
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('strong', null, 'Muscle levels'), toggle), wrap, readout, h('div', { class: 'bf-legend' }, ...legend.map(([cls, name]) => h('span', null, h('i', { class: `bf-key ${cls}` }), name))));
}

function balanceRow(p: StrengthResult['balance']['pairs'][number]): HTMLElement {
  const a = p.a.score;
  const b = p.b.score;
  // The bar leans toward the stronger side, ±200 points filling it.
  const lean = p.diff === null ? 0 : Math.max(-1, Math.min(1, p.diff / 200));
  return h(
    'div',
    { class: 'bal' },
    h('div', { class: 'bal-names small' }, h('span', null, `${p.a.name} `, h('strong', null, a ?? '—')), h('span', null, h('strong', null, b ?? '—'), ` ${p.b.name}`)),
    h(
      'div',
      { class: 'bal-track', role: 'img', 'aria-label': p.message },
      h('i', { class: 'bal-mid' }),
      p.diff !== null ? h('span', { class: `bal-fill${p.status === 'balanced' ? ' ok' : ''}`, style: lean < 0 ? `left:50%;width:${-lean * 50}%` : `right:50%;width:${lean * 50}%` }) : null,
    ),
    h('p', { class: `small bal-msg${p.status === 'balanced' ? ' muted' : ''}` }, p.status === 'balanced' ? '✓ Balanced' : p.status === 'unknown' ? p.message : `⚠ ${p.message}`),
  );
}

const openGroups = new Set<string>();

export function strengthScreen(r: StrengthResult, ctx: StrengthCtx): HTMLElement[] {
  const s = r.scores;
  const back = h('a', { class: 'btn ghost small', href: '#/' }, 'Today');
  const header = h('header', { class: 'top' }, h('div', { class: 'top-row' }, h('div', null, h('p', { class: 'eyebrow' }, 'Last 90 days'), h('h1', null, 'Strength')), back));
  const standards = h(
    'div',
    { class: 'chips', role: 'radiogroup', 'aria-label': 'Standards' },
    ...(['men', 'women'] as const).map((v) =>
      h('button', { class: `chip${r.standards === v ? ' on' : ''}`, role: 'radio', 'aria-checked': String(r.standards === v), onclick: () => (store.set('gym.standards', v), ctx.refresh()) }, v === 'men' ? 'Men’s standards' : 'Women’s standards'),
    ),
  );

  if (s.bodyweight === null) {
    const input = h('input', { class: 'field', type: 'number', inputmode: 'decimal', min: 25, max: 300, step: 'any', placeholder: 'Bodyweight in kg', 'aria-label': 'Bodyweight in kg' }) as HTMLInputElement;
    const save = () => {
      const v = Number(input.value);
      if (v >= 25 && v <= 300) store.set('gym.bodyweight', String(v)), ctx.refresh();
    };
    return [header, h('main', { class: 'pad-x stack' }, h('section', { class: 'card' }, h('strong', null, 'Scores are for your bodyweight'), h('p', { class: 'muted small' }, 'There’s no weigh-in yet. Log one in رقيب, or enter your weight here (kept on this phone).'), h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: save }, 'Use'))))];
  }

  // The trend is weekly up to today: five points back is four weeks ago.
  const then = r.trend.at(-5)?.overall ?? null;
  const change = s.overall !== null && then !== null ? s.overall - then : null;
  const scored = s.groups.filter((g) => g.score !== null);
  const b = r.balance;
  const off = b.pairs.filter((p) => p.status !== 'balanced');
  const overallAt = inLevel(s.overall);
  const gains = r.gains.filter((g) => g.change > 0).slice(0, 3);
  const overallChart = trendChart(r.trend.map((p) => p.day), r.trend.map((p) => p.overall), 'Overall score');
  const weighed = r.bodyweightGiven ? ' (entered on this phone)' : s.bodyweightDay ? `, weighed ${shortDay(s.bodyweightDay)}` : '';

  return [
    header,
    h(
      'main',
      { class: 'pad-x stack' },
      h(
        'section',
        { class: 'card hero' },
        h('span', { class: 'tile-label' }, 'Strength score'),
        h('div', { class: 'hero-row' }, h('strong', { class: 'hero-num' }, s.overall ?? '—'), h('div', { class: 'hero-side' }, h('span', { class: `badge${s.overallLevel ? ' accent' : ''}` }, s.overallLevel ?? (s.overall === null ? 'No recent lifts' : 'Below beginner')), change !== null ? h('span', { class: `small ${change > 0 ? 'good-ink' : change < 0 ? 'danger-ink' : 'muted'}` }, `${change > 0 ? '▲ +' : change < 0 ? '▼ −' : ''}${Math.abs(change)} in 4 weeks`) : null)),
        overallAt && s.overall !== null
          ? h(
              'div',
              { class: 'hero-prog' },
              h('div', { class: 'lvl-scale-ends muted small' }, h('span', null, `${s.overallLevel ?? 'Below beginner'} ${s.overall - overallAt.into}`), h('span', null, `${overallAt.nextName} ${overallAt.next}`)),
              levelProgress(s.overall, 'Overall'),
              h('span', { class: 'small' }, h('b', null, `${overallAt.next - s.overall} points`), ` to ${overallAt.nextName}`),
            )
          : null,
        h('div', { class: 'tiles hero-tiles' }, h('div', null, h('span', { class: 'tile-label' }, 'Upper body'), h('strong', null, s.upper ?? '—')), h('div', null, h('span', { class: 'tile-label' }, 'Lower body'), h('strong', null, s.lower ?? '—'))),
        h('p', { class: 'muted small' }, `For ${n1(s.bodyweight)} kg bodyweight${weighed}. Each level is 100 points: your best lift per group in 90 days, as a 1RM for your weight.`),
        r.bodyweightGiven ? h('button', { class: 'btn ghost small', onclick: () => (store.set('gym.bodyweight', null), ctx.refresh()) }, 'Change bodyweight') : null,
      ),
      focusCard(r.focus),
      figureCard(s.groups, ctx),
      h('h2', { class: 'section-title' }, 'Muscle groups'),
      ...s.groups.map((g) => groupCard(g, r, openGroups, ctx.rerender)),
      h(
        'section',
        { class: 'card' },
        h('strong', null, 'Strength balance'),
        scored.length < 3
          ? h('p', { class: 'muted small' }, 'Train at least three muscle groups to see how they balance.')
          : off.length
            ? null
            : h('p', { class: 'small good-ink' }, '✓ Every pair is within 40 points.'),
        ...(scored.length < 3 ? [] : b.pairs.map(balanceRow)),
        b.leading.length ? h('p', { class: 'muted small' }, `Strongest: ${b.leading.map((g) => `${g.name} (+${g.ahead})`).join(', ')}.`) : null,
      ),
      overallChart
        ? h('section', { class: 'card' }, h('strong', null, 'Over 6 months'), overallChart, gains.length ? h('p', { class: 'small' }, 'Biggest gains: ', ...gains.flatMap((g, i) => [i ? ', ' : '', h('b', null, `${g.name} +${g.change}`)])) : null)
        : null,
      h(
        'section',
        { class: 'card' },
        h('strong', null, 'Standards'),
        standards,
        h('p', { class: 'muted small' }, 'Approximate bodyweight ratios for each group’s reference lift. Dumbbell, cable and machine lifts are converted to that lift, conservatively. Sets over 15 reps don’t count.'),
        s.uncounted.length
          ? h('details', { class: 'uncounted' }, h('summary', { class: 'muted small' }, `${s.uncounted.length} logged ${s.uncounted.length === 1 ? 'lift counts' : 'lifts count'} toward no group`), h('p', { class: 'muted small', dir: 'auto' }, s.uncounted.join(' · ')))
          : null,
      ),
    ),
  ];
}
