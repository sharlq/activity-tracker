// The strength screen (#/strength): the overall strength score, each muscle group's score
// against the five levels, how the groups balance, and the score week by week. The numbers
// come from Convex (convex/strength.ts); the standards choice stays on this phone.
import type { FunctionReturnType } from 'convex/server';
import type { api } from '../convex/_generated/api';
import { h, n1, store } from './ui.ts';

export type StrengthResult = FunctionReturnType<typeof api.strength.scores>;
type Group = StrengthResult['scores']['groups'][number];

export interface StrengthCtx {
  /** Draw again from the same numbers (a group opened). */
  rerender: () => void;
  /** Ask again: the standards or the bodyweight changed. */
  refresh: () => void;
}

const MAX = 600;
const LEVEL_MARKS = [100, 200, 300, 400, 500];
const LEVEL_NAMES = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
const SVG = 'http://www.w3.org/2000/svg';

export const standardsChoice = (): 'men' | 'women' => (store.get('gym.standards') === 'women' ? 'women' : 'men');
export const bodyweightChoice = (): number | undefined => {
  const v = Number(store.get('gym.bodyweight'));
  return v >= 25 && v <= 300 ? v : undefined;
};

function svg(tag: string, attrs: Record<string, string | number>, ...children: Node[]): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en', { day: 'numeric', month: 'short' });

/** A 0–600 bar with the five level marks. */
function levelBar(score: number | null, label: string): HTMLElement {
  return h(
    'div',
    { class: 'lvl-bar', role: 'img', 'aria-label': score === null ? `${label}: no score` : `${label}: ${score} of ${MAX}` },
    score !== null ? h('span', { class: 'lvl-fill', style: `width:${Math.min(100, (score / MAX) * 100)}%` }) : null,
    ...LEVEL_MARKS.map((m) => h('i', { class: 'lvl-mark', style: `left:${(m / MAX) * 100}%` })),
  );
}

function levelScale(): HTMLElement {
  return h('div', { class: 'lvl-scale', 'aria-hidden': 'true' }, ...LEVEL_NAMES.map((n, i) => h('span', { style: `left:${((i + 1) * 100 / MAX) * 100}%` }, n.slice(0, 3))));
}

/** The overall score week by week; hover or tap shows a week. */
function trendChart(trend: StrengthResult['trend']): HTMLElement | null {
  const pts = trend.map((p, i) => ({ ...p, i })).filter((p): p is typeof p & { overall: number } => p.overall !== null);
  if (pts.length < 2) return null;
  const W = 320;
  const H = 96;
  const pad = 6;
  const lo = Math.max(0, Math.floor((Math.min(...pts.map((p) => p.overall)) - 20) / 50) * 50);
  const hi = Math.ceil((Math.max(...pts.map((p) => p.overall)) + 20) / 50) * 50;
  const x = (i: number) => pad + (i / (trend.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const line = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.overall).toFixed(1)}`).join(' ');
  const dot = svg('circle', { r: 4, class: 'trend-dot', cx: x(pts.at(-1)!.i), cy: y(pts.at(-1)!.overall) });
  const readout = h('span', { class: 'muted small trend-readout' }, `${shortDay(pts.at(-1)!.day)}: ${pts.at(-1)!.overall}`);
  const chart = svg(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'trend', role: 'img', 'aria-label': `Overall score over ${trend.length} weeks, from ${pts[0]!.overall} to ${pts.at(-1)!.overall}` },
    ...[lo, hi].map((v) => svg('line', { x1: 0, x2: W, y1: y(v), y2: y(v), class: 'trend-grid' })),
    svg('polyline', { points: line, class: 'trend-line' }),
    dot,
  );
  const pick = (clientX: number) => {
    const box = chart.getBoundingClientRect();
    const at = ((clientX - box.left) / box.width) * W;
    const p = pts.reduce((a, b) => (Math.abs(x(b.i) - at) < Math.abs(x(a.i) - at) ? b : a));
    dot.setAttribute('cx', String(x(p.i)));
    dot.setAttribute('cy', String(y(p.overall)));
    readout.textContent = `Week of ${shortDay(p.day)}: ${p.overall}`;
  };
  chart.addEventListener('pointermove', (e) => pick((e as PointerEvent).clientX));
  chart.addEventListener('pointerdown', (e) => pick((e as PointerEvent).clientX));
  return h('div', { class: 'trend-wrap' }, h('div', { class: 'trend-axis muted small' }, h('span', null, String(hi)), h('span', null, String(lo))), chart, readout);
}

const kg = (w: number | null) => (w === null ? 'BW' : `${n1(w)} kg`);

function groupCard(g: Group, open: Set<string>, rerender: () => void): HTMLElement {
  const isOpen = open.has(g.id);
  const toggle = () => (isOpen ? open.delete(g.id) : open.add(g.id), rerender());
  return h(
    'section',
    { class: 'grp' },
    h(
      'button',
      { class: 'grp-head', onclick: toggle, 'aria-expanded': String(isOpen), disabled: !g.best },
      h('span', { class: 'grp-name' }, g.name),
      h('span', { class: 'grp-score' }, g.score ?? '—'),
      h('span', { class: `badge${g.level ? ' accent' : ''}` }, g.level ?? (g.score === null ? 'No recent lifts' : 'Below beginner')),
    ),
    levelBar(g.score, g.name),
    g.best
      ? h('p', { class: 'muted small grp-best', dir: 'auto' }, `${g.best.exercise}: ${kg(g.best.weight)} × ${g.best.reps}, ${shortDay(g.best.day)}`, g.ratio !== null ? ` · ${n1(g.ratio)}× bodyweight as ${g.reference.toLowerCase()}` : '')
      : h('p', { class: 'muted small grp-best' }, `Log a ${g.reference.toLowerCase()} or similar lift to score it.`),
    g.next && g.best ? h('p', { class: 'small grp-next' }, `${g.next.level}: ${kg(g.next.weight)} × ${g.next.reps} on ${g.best.exercise}`) : null,
    isOpen
      ? h(
          'ul',
          { class: 'grp-lifts' },
          ...g.lifts.map((l) => h('li', null, h('span', { dir: 'auto' }, l.exercise), h('span', { class: 'muted' }, `${kg(l.weight)} × ${l.reps}`), h('strong', null, String(l.score)))),
        )
      : null,
  );
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
        levelBar(s.overall, 'Overall'),
        levelScale(),
        h('div', { class: 'tiles hero-tiles' }, h('div', null, h('span', { class: 'tile-label' }, 'Upper body'), h('strong', null, s.upper ?? '—')), h('div', null, h('span', { class: 'tile-label' }, 'Lower body'), h('strong', null, s.lower ?? '—'))),
        h('p', { class: 'muted small' }, `For ${n1(s.bodyweight)} kg bodyweight${r.bodyweightGiven ? ' (entered on this phone)' : ''}. Each level is 100 points: your best lift per group in 90 days, as a 1RM for your weight.`),
        r.bodyweightGiven ? h('button', { class: 'btn ghost small', onclick: () => (store.set('gym.bodyweight', null), ctx.refresh()) }, 'Change bodyweight') : null,
      ),
      trendChart(r.trend) ? h('section', { class: 'card' }, h('strong', null, 'Over 6 months'), trendChart(r.trend)) : null,
      h(
        'section',
        { class: 'card' },
        h('strong', null, 'Strength balance'),
        scored.length < 3
          ? h('p', { class: 'muted small' }, 'Train at least three muscle groups to see how they balance.')
          : b.lagging.length
            ? h('p', { class: 'note' }, `Lagging: ${b.lagging.map((g) => `${g.name} (${g.behind} points behind the rest)`).join(', ')}. Prioritise ${b.lagging.length === 1 ? 'it' : 'them'} early in the session.`)
            : h('p', { class: 'small good-ink' }, '✓ No muscle group lags far behind the rest.'),
        b.leading.length ? h('p', { class: 'muted small' }, `Strongest: ${b.leading.map((g) => `${g.name} (+${g.ahead})`).join(', ')}.`) : null,
        ...b.pairs.map(balanceRow),
      ),
      h('h2', { class: 'section-title' }, 'Muscle groups'),
      ...s.groups.map((g) => groupCard(g, openGroups, ctx.rerender)),
      h('section', { class: 'card' }, h('strong', null, 'Standards'), standards, h('p', { class: 'muted small' }, 'Approximate bodyweight ratios for each group’s reference lift. Dumbbell, cable and machine lifts are converted to that lift, conservatively. Sets over 15 reps don’t count.')),
    ),
  ];
}

