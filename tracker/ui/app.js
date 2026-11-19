// رقيب's window. Plain JavaScript, no build step: served as is by the tracker.
// Every bit of data goes into the page as text through h(), never as HTML.

// ------------------------------------------------------------------ helpers

const main = document.getElementById('main');
const snackbar = document.getElementById('snackbar');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) prop.startsWith('--') ? el.style.setProperty(prop, v) : (el.style[prop] = v);
    }
    else if (key === 'value') el.value = value;
    else if (key === 'checked') el.checked = Boolean(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

let snackTimer;
function say(message, error = false) {
  snackbar.textContent = message;
  snackbar.className = `show${error ? ' error' : ''}`;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => (snackbar.className = ''), error ? 5000 : 2200);
}

/**
 * Runs `fn` at most once at a time: a second Enter or click while the first save is
 * still on its way is ignored, so one answer is never saved twice.
 */
function oneAtATime(fn) {
  let busy = false;
  return async (...args) => {
    if (busy) return;
    busy = true;
    try {
      return await fn(...args);
    } finally {
      busy = false;
    }
  };
}

class SignedOut extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/v1/ui${path}`, {
    method,
    headers: { 'x-raqib': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) throw new SignedOut();
  if (!response.ok) {
    let message = `Something went wrong (HTTP ${response.status})`;
    try {
      message = (await response.json()).error ?? message;
    } catch {}
    throw new Error(message[0].toUpperCase() + message.slice(1));
  }
  return response.status === 204 ? null : response.json();
}

// Line icons from the Raqib design system: 24px grid, 1.75px stroke, currentColor.
// Static markup written here, never data, so building them from a string is safe.
const ICONS = {
  today: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  morning: '<path d="M3.5 18.5h17M7 18.5a5 5 0 0 1 10 0M12 5.5V8M5.4 10.2l1.7 1.3M18.6 10.2l-1.7 1.3"/>',
  evening: '<path d="M19 14.6A7.6 7.6 0 1 1 9.4 5a6 6 0 0 0 9.6 9.6z"/>',
  reminders: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.8H5zM10 20.6a2.1 2.1 0 0 0 4 0"/>',
  reports: '<path d="M5 19.5V10M10 19.5V5M15 19.5v-7M20 19.5V15"/>',
  projects: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 5.8v1.7M7 14h6"/>',
  settings: '<path d="M4.5 7.5h9M18.5 7.5h1M4.5 16.5h3M12.5 16.5h7"/><circle cx="16" cy="7.5" r="2.3"/><circle cx="10" cy="16.5" r="2.3"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>',
  right: '<path d="M9.5 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M7 7l10 10M17 7L7 17"/>',
  shield: '<path d="M12 3.5l7 2.6v5.6c0 4.4-3 7.4-7 8.8-4-1.4-7-4.4-7-8.8V6.1z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
  pill: '<path d="M10.6 4.6a4.9 4.9 0 0 1 6.9 6.9l-6 6a4.9 4.9 0 0 1-6.9-6.9z"/><path d="M7.6 7.6l8.8 8.8"/>',
  drop: '<path d="M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5z"/>',
  arrowin: '<path d="M4.5 12h11M11.5 7.5l4.5 4.5-4.5 4.5M19.5 4.5v15"/>',
  sleep: '<path d="M18 14.8A7 7 0 1 1 9.2 6a5.6 5.6 0 0 0 8.8 8.8z"/><path d="M15 4h3.5L15 7.5h3.5"/>',
  bed: '<path d="M3.5 18.5v-11M3.5 15.5h17v3M20.5 15.5v-3a2.5 2.5 0 0 0-2.5-2.5h-8v5.5"/><circle cx="7" cy="12" r="1.8"/>',
  routine: '<path d="M10 3.5h4M12 3.5v2"/><circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2.5 1.5"/>',
  meal: '<path d="M7 3.5v7a2 2 0 0 0 2 2v8M7 3.5v4.5M11 3.5V8a2 2 0 0 1-2 2M16.5 20.5v-17c-1.8 1-3 3.3-3 6.5 0 2.6 1.2 3.5 3 3.5"/>',
  errand: '<path d="M13.5 4.5h4.5v15h-4.5M4.5 12h10M10.5 8l4 4-4 4"/>',
  exercise: '<path d="M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11"/>',
  commute: '<rect x="5" y="4.5" width="14" height="12" rx="3"/><path d="M5 11.5h14M8 19.5l1.5-3M16 19.5l-1.5-3"/>',
  social: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.3"/><path d="M15.6 14.6a4.6 4.6 0 0 1 5 4.9"/>',
  prayer: '<path d="M5.5 20.5h13M7.5 20.5V10.5a4.5 4.5 0 0 1 9 0v10"/><path d="M12 3.5v2"/>',
  rest: '<path d="M4 17.5h16M6 17.5V12a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5.5M4 20v-2.5M20 20v-2.5"/>',
  chores: '<path d="M14.5 3.5l-2 8M8 11.5h9l1.5 9h-12z"/>',
  health: '<path d="M12 19.5s-7.5-4.4-7.5-10a4.2 4.2 0 0 1 7.5-2.6 4.2 4.2 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10z"/><path d="M7.5 12h2.5l1.5-2.5 2 4 1.5-1.5h1.5"/>',
  scale: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M9 9.5a4 4 0 0 1 6 0M12 9.5l1-1.5"/>',
  phone: '<rect x="7" y="3.5" width="10" height="17" rx="2.5"/><path d="M11 17.5h2"/>',
  music: '<path d="M9 18V6.5l10-2v11.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
};
function icon(name, cls = 'ic') {
  const box = document.createElement('span');
  box.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  return box.firstChild;
}

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const span = (a, b) => `${clock(a)}–${clock(b)}`;
function duration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return ms > 0 ? '<1m' : '0m';
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes}m` : `${hours}h ${pad(minutes % 60)}m`;
}
const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const parseDay = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};
const shiftDay = (key, days) => {
  const d = new Date(parseDay(key));
  d.setDate(d.getDate() + days);
  return dayKey(d.getTime());
};
const longDate = (key) =>
  new Date(parseDay(key)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const today = () => dayKey(Date.now());

/** Clock time on a given day, as ms. */
function onDay(key, hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number);
  const d = new Date(parseDay(key));
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

// Category colours are theme tokens in style.css, so light and dark each get their own value.
const COLORS = {
  work: 'var(--cat-work)', learning: 'var(--cat-learning)', debate: 'var(--cat-debate)', 'social media': 'var(--cat-social)', video: 'var(--cat-video)',
  news: 'var(--cat-news)', gaming: 'var(--cat-gaming)', 'game launcher': 'var(--cat-launcher)', messaging: 'var(--cat-messaging)', meeting: 'var(--cat-meeting)', entertainment: 'var(--cat-entertainment)', other: 'var(--cat-other)', idle: 'var(--cat-idle)',
};
const FOCUS = new Set(['work', 'learning', 'debate']);
const DISTRACTION = new Set(['social media', 'video', 'news', 'gaming', 'game launcher']);
const SOUND_COLOR = 'var(--cat-audio)';
/** Screen categories have their own colour; anything you logged yourself is drawn as "logged". */
const colorOf = (category) => COLORS[category] ?? (category ? 'var(--cat-logged)' : 'var(--cat-other)');
const kindOf = (category) => (FOCUS.has(category) ? 'Focus' : DISTRACTION.has(category) ? 'Distraction' : COLORS[category] ? 'Neutral' : 'Logged');
const cap = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const swatch = (category) => h('i', { class: `dot${COLORS[category] ? '' : ' logged'}`, style: COLORS[category] ? { background: COLORS[category] } : {} });

/** Quick answers for a gap: the label to log, the category it goes under, and its icon. */
const QUICK = [
  ['Sleep', 'sleep', 'sleep'], ['In bed', 'in bed', 'bed'], ['Sleep routine', 'sleep routine', 'routine'], ['Pre shower', 'pre shower', 'drop'], ['Meal', 'meal', 'meal'], ['Out / errands', 'errand', 'errand'], ['Exercise', 'exercise', 'exercise'], ['Commute', 'commute', 'commute'],
  ['With people', 'social', 'social'], ['Prayer', 'prayer', 'prayer'], ['Rest', 'rest', 'rest'], ['Entertainment', 'entertainment', 'music'], ['Chores', 'chores', 'chores'], ['On my phone', 'social media', 'phone'],
];

/** The date and earlier/later arrows in the title bar, for pages that are about one day. */
function setTopnav(key, base) {
  const nav = document.getElementById('topnav');
  if (!key) return nav.replaceChildren();
  const isToday = key === today();
  nav.replaceChildren(...[
    h('a', { class: 'btn ghost icon sm', href: `${base}/${shiftDay(key, -1)}`, 'aria-label': 'Earlier day', title: 'Earlier day' }, icon('left')),
    h('span', { class: 'd' }, longDate(key)),
    isToday
      ? h('span', { class: 'btn ghost icon sm', 'aria-disabled': 'true', style: { opacity: 0.35 } }, icon('right'))
      : h('a', { class: 'btn ghost icon sm', href: `${base}/${shiftDay(key, 1)}`, 'aria-label': 'Later day', title: 'Later day' }, icon('right')),
    isToday ? null : h('a', { class: 'btn sm', href: base, style: { marginLeft: '6px' } }, 'Today'),
  ].filter(Boolean));
}

// ------------------------------------------------------------------ pieces

function stat(label, value, sub, cls = '') {
  return h('div', { class: `stat ${cls}` }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
}

function card(title, note, ...body) {
  return h('section', { class: 'card' }, h('header', {}, h('h2', {}, title), note ? h('p', {}, note) : null), ...body);
}

function bars(items, colorFor) {
  if (items.length === 0) return h('p', { class: 'empty' }, 'Nothing yet.');
  const max = Math.max(...items.map((i) => i.ms));
  return h(
    'div',
    { class: 'bars' },
    items.map((item) =>
      h(
        'div',
        { class: 'item' },
        h('i', { style: { background: colorFor(item) } }),
        h('span', { class: 'name', title: item.name }, item.name),
        h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: `${(item.ms / max) * 100}%`, background: colorFor(item) } })),
        h('span', { class: 'ms' }, duration(item.ms)),
      ),
    ),
  );
}

// The day's timeline: hover any bar for details; zoom with the wheel, by dragging
// across a stretch, by clicking a bar, or with the buttons. The zoom is kept per
// day, so it survives the page refreshing itself.
const zoomByDay = new Map();
const MIN_SPAN = 10 * 60000;
let tip;

function showTip(event, info) {
  tip ??= document.body.appendChild(h('div', { class: 'tip', role: 'tooltip' }));
  tip.replaceChildren(
    info.kind ? h('div', { class: 'tip-kind' }, info.swatch ?? null, info.kind) : null,
    h('strong', {}, info.heading),
    ...info.lines.filter(Boolean).map((line) => h('div', {}, line)),
    info.when ? h('div', { class: 'tip-when' }, h('span', {}, info.when[0]), h('b', {}, info.when[1])) : null,
    info.hint ? h('div', { class: 'tip-hint' }, info.hint) : null,
  );
  tip.classList.add('show');
  moveTip(event);
}
function moveTip(event) {
  if (!tip) return;
  const pad = 14;
  const { innerWidth, innerHeight } = window;
  const box = tip.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + box.width > innerWidth - 8) x = event.clientX - box.width - pad;
  if (y + box.height > innerHeight - 8) y = event.clientY - box.height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
function hideTip() {
  tip?.classList.remove('show');
}

function tickStep(spanMs) {
  const steps = [5, 10, 15, 30, 60, 120, 180, 240].map((m) => m * 60000);
  return steps.find((s) => spanMs / s <= 9) ?? steps.at(-1);
}

function timelineCard(day) {
  const full = { from: day.from, to: day.to };
  const view = zoomByDay.get(day.date) ?? { ...full };
  const { report } = day;

  // Everything that can be drawn, by lane.
  const when = (start, end) => [span(start, end), duration(end - start)];
  const items = [
    ...report.timeline.map((b) => ({
      lane: 'screen', start: b.start, end: b.end, color: b.category === 'idle' ? null : colorOf(b.category), cls: b.category === 'idle' ? 'idle' : null,
      info: b.category === 'idle'
        ? { kind: 'Neutral · Idle', heading: 'Idle', lines: [b.detail !== 'idle' ? `${b.detail} on screen` : 'No input'], when: when(b.start, b.end), hint: 'Click to zoom in' }
        : { kind: `${kindOf(b.category)} · ${b.category}`, swatch: swatch(b.category), heading: b.detail !== b.category ? b.detail : b.category, lines: [], when: when(b.start, b.end), hint: 'Click to zoom in' },
    })),
    ...report.multitasking.blocks.map((b) => ({
      lane: 'sound', start: b.start, end: b.end, color: SOUND_COLOR,
      info: { kind: 'Playing', swatch: h('i', { class: 'dot', style: { background: SOUND_COLOR } }), heading: b.source, lines: [b.title], when: when(b.start, b.end), hint: 'Click to zoom in' },
    })),
    ...day.gaps.map((g) => ({
      lane: 'you', start: g.start, end: g.end, gap: g, cls: 'gap', label: 'Not logged',
      info: { kind: 'Away', swatch: h('i', { class: 'dot dot-gap' }), heading: 'Not logged yet', lines: [g.kind === 'idle' ? `PC on but untouched${g.onScreen ? ` (${g.onScreen} on screen)` : ''}` : 'PC off, asleep, or locked'], when: [span(g.start, g.end), duration(g.ms)], hint: 'Click to log it' },
    })),
    ...report.entries.map((e) => ({
      lane: 'you', start: e.start, end: e.end, cls: 'logged', label: e.label,
      info: { kind: `Logged${e.category ? ` · ${e.category}` : ''}`, swatch: h('i', { class: 'dot logged' }), heading: e.label, lines: [], when: when(e.start, e.end), hint: 'Logged by you · click to zoom in' },
    })),
    ...day.planComparison.blocks.map((o) => ({
      lane: 'plan', start: o.block.start, end: o.block.end, cls: `plan ${o.status}`, vars: { '--c': STATUS_COLOR[o.status] }, label: o.block.label,
      info: {
        kind: `Planned${o.block.category ? ` · ${planCategoryName(o.block.category)}` : ''} · ${STATUS[o.status][0]}`,
        swatch: h('i', { class: 'dot', style: { background: STATUS_COLOR[o.status] } }),
        heading: o.block.label,
        lines: [
          o.elapsedMs ? `${duration(o.keptMs)} of ${duration(o.elapsedMs)} so far as planned` : null,
          o.actual.length ? `Did: ${o.actual.slice(0, 3).map((a) => `${a.name} ${duration(a.ms)}`).join(', ')}` : null,
        ],
        when: when(o.block.start, o.block.end),
        hint: 'Click to zoom in',
      },
    })),
  ];

  const lanesBox = h('div', { class: 'timeline tl-lanes' });
  const axis = h('div', { class: 'axis' });
  const range = h('span', { class: 'hint' });
  const selection = h('div', { class: 'tl-select' });

  const setView = (from, to) => {
    let span_ = Math.max(MIN_SPAN, Math.min(to - from, full.to - full.from));
    let start = Math.max(full.from, Math.min(from, full.to - span_));
    view.from = start;
    view.to = start + span_;
    if (view.from === full.from && view.to === full.to) zoomByDay.delete(day.date);
    else zoomByDay.set(day.date, view);
    draw();
  };
  const zoomBy = (factor, at = (view.from + view.to) / 2) => {
    const span_ = (view.to - view.from) * factor;
    const share = (at - view.from) / (view.to - view.from);
    setView(at - span_ * share, at - span_ * share + span_);
  };
  const pan = (share) => {
    const shift = (view.to - view.from) * share;
    setView(view.from + shift, view.to + shift);
  };

  function draw() {
    const total = view.to - view.from;
    const width = lanesBox.clientWidth || 800;
    const pos = (start, end) => ({ left: `${((Math.max(start, view.from) - view.from) / total) * 100}%`, width: `${((Math.min(end, view.to) - Math.max(start, view.from)) / total) * 100}%` });
    const lane = (key) =>
      items
        .filter((i) => i.lane === key && i.end > view.from && i.start < view.to)
        .map((item) => {
          const px = ((Math.min(item.end, view.to) - Math.max(item.start, view.from)) / total) * width;
          return h(
            'div',
            {
              class: `bar${item.cls ? ` ${item.cls}` : ''}`,
              style: { ...pos(item.start, item.end), ...(item.color ? { background: item.color } : {}), ...(item.vars ?? {}) },
              onmouseenter: (e) => showTip(e, item.info),
              onmousemove: moveTip,
              onmouseleave: hideTip,
              onclick: (e) => {
                if (e.detail > 1) return;
                hideTip();
                if (item.gap) {
                  const target = document.querySelector(`[data-gap="${item.gap.start}"]`);
                  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  target?.querySelector('input[type=text]')?.focus({ preventScroll: true });
                  target?.classList.add('flash');
                  setTimeout(() => target?.classList.remove('flash'), 1200);
                } else {
                  const padMs = Math.max((item.end - item.start) * 0.25, 5 * 60000);
                  setView(item.start - padMs, item.end + padMs);
                }
              },
            },
            item.label && px > 56 ? h('span', { class: 'bar-label' }, item.label) : null,
          );
        });

    const now = day.now >= view.from && day.now < view.to ? h('div', { class: 'bar now', style: { left: pos(day.now, day.now).left } }) : null;
    // Job hours: a shaded band behind every lane, and a labelled strip above them.
    const job = day.job && day.job.end > view.from && day.job.start < view.to ? day.job : null;
    const band = () => (job ? h('div', { class: 'job-band', style: pos(job.start, job.end) }) : null);
    const jobInfo = job && { kind: 'Job', swatch: h('i', { class: 'dot dot-job' }), heading: 'Job hours', lines: ['Change them in Settings'], when: when(job.start, job.end) };
    lanesBox.replaceChildren(
      ...(day.job
        ? [h('span', { class: 'lane-name' }, 'Job'), h('div', { class: 'lane job-lane' },
            job ? h('div', { class: 'job-strip', style: pos(job.start, job.end), onmouseenter: (e) => showTip(e, jobInfo), onmousemove: moveTip, onmouseleave: hideTip },
              ((Math.min(job.end, view.to) - Math.max(job.start, view.from)) / total) * width > 90 ? h('span', {}, `Job · ${span(job.start, job.end)}`) : null) : null,
            now?.cloneNode())]
        : []),
      ...(day.plan.length ? [h('span', { class: 'lane-name' }, 'Plan'), h('div', { class: 'lane plan-lane' }, band(), lane('plan'), now?.cloneNode())] : []),
      h('span', { class: 'lane-name' }, 'On screen'), h('div', { class: 'lane' }, band(), lane('screen'), now),
      h('span', { class: 'lane-name' }, 'Playing'), h('div', { class: 'lane thin' }, band(), lane('sound'), now?.cloneNode()),
      h('span', { class: 'lane-name' }, 'Logged'), h('div', { class: 'lane' }, band(), lane('you'), now?.cloneNode()),
      selection,
    );

    const step = tickStep(total);
    const ticks = [];
    const first = new Date(view.from);
    first.setMinutes(0, 0, 0);
    for (let t = first.getTime(); t <= view.to; t += step) {
      if (t < view.from) continue;
      ticks.push(h('span', { style: { left: `${((t - view.from) / total) * 100}%` } }, clock(t)));
    }
    axis.replaceChildren(...ticks);
    const zoomed = view.from !== full.from || view.to !== full.to;
    range.textContent = zoomed ? `Showing ${span(view.from, view.to)} (${duration(total)})` : 'Whole day · scroll to zoom, or drag across the bars';
    for (const b of controls.querySelectorAll('[data-zoomed]')) b.disabled = !zoomed;
  }

  // Wheel: zoom around the pointer. Drag: pick a stretch to zoom into.
  lanesBox.addEventListener('wheel', (e) => {
    const rect = lanesBox.querySelector('.lane').getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right) return;
    e.preventDefault();
    hideTip();
    const at = view.from + ((e.clientX - rect.left) / rect.width) * (view.to - view.from);
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) pan(e.deltaX > 0 ? 0.15 : -0.15);
    else zoomBy(e.deltaY < 0 ? 0.75 : 1 / 0.75, at);
  }, { passive: false });

  let drag = null;
  lanesBox.addEventListener('mousedown', (e) => {
    const rect = lanesBox.querySelector('.lane')?.getBoundingClientRect();
    if (!rect || e.button !== 0 || e.clientX < rect.left || e.clientX > rect.right) return;
    drag = { x: e.clientX, rect, moved: false };
    e.preventDefault();
  });
  const onMove = (e) => {
    if (!lanesBox.isConnected) return cleanup();
    if (!drag) return;
    const x = Math.max(drag.rect.left, Math.min(e.clientX, drag.rect.right));
    if (Math.abs(x - drag.x) < 4) return;
    drag.moved = true;
    hideTip();
    selection.style.display = 'block';
    selection.style.left = `${Math.min(x, drag.x) - lanesBox.getBoundingClientRect().left}px`;
    selection.style.width = `${Math.abs(x - drag.x)}px`;
    drag.to = x;
  };
  const onUp = () => {
    if (!lanesBox.isConnected) return cleanup();
    if (!drag) return;
    const d = drag;
    drag = null;
    selection.style.display = 'none';
    if (!d.moved || d.to === undefined) return;
    const at = (x) => view.from + ((x - d.rect.left) / d.rect.width) * (view.to - view.from);
    setView(at(Math.min(d.x, d.to)), at(Math.max(d.x, d.to)));
    // The click that ends a drag mustn't also zoom into the bar under it.
    window.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true });
  };
  // The page redraws itself; listeners from a timeline that's gone remove themselves.
  const resize = new ResizeObserver(() => (lanesBox.isConnected ? draw() : cleanup()));
  function cleanup() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    resize.disconnect();
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  lanesBox.addEventListener('dblclick', () => setView(full.from, full.to));

  const activity = items.filter((i) => i.lane !== 'you' || !i.gap);
  const fit = () => {
    if (activity.length === 0) return;
    const start = Math.min(...activity.map((i) => i.start));
    const end = Math.max(...activity.map((i) => i.end), Math.min(day.now, day.to));
    const padMs = (end - start) * 0.03;
    setView(start - padMs, end + padMs);
  };
  const controls = h(
    'div',
    { class: 'row tl-controls' },
    h('button', { class: 'btn icon', title: 'Earlier', 'aria-label': 'Earlier', 'data-zoomed': '', onclick: () => pan(-0.5) }, icon('left')),
    h('button', { class: 'btn icon', title: 'Zoom out', 'aria-label': 'Zoom out', 'data-zoomed': '', onclick: () => zoomBy(2) }, icon('minus')),
    h('button', { class: 'btn icon', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => zoomBy(0.5) }, icon('plus')),
    h('button', { class: 'btn icon', title: 'Later', 'aria-label': 'Later', 'data-zoomed': '', onclick: () => pan(0.5) }, icon('right')),
    h('button', { class: 'btn', onclick: fit }, 'Fit to activity'),
    h('button', { class: 'btn', 'data-zoomed': '', onclick: () => setView(full.from, full.to) }, 'Whole day'),
  );

  const used = [...new Set(report.timeline.map((b) => b.category))];
  const body = card(
    'Your day',
    null,
    h('div', { class: 'tl-head' }, range, controls),
    lanesBox,
    h('div', { class: 'axis-row' }, axis),
    h(
      'div',
      { class: 'legend' },
      used.map((c) => h('span', {}, swatch(c), cap(c))),
      report.multitasking.blocks.length ? h('span', {}, h('i', { class: 'dot', style: { background: SOUND_COLOR } }), 'Playing') : null,
      report.entries.length ? h('span', {}, h('i', { class: 'dot logged' }), 'Logged') : null,
      day.gaps.length ? h('span', {}, h('i', { class: 'dot dot-gap' }), 'Not logged yet') : null,
      day.job ? h('span', {}, h('i', { class: 'dot dot-job' }), 'Job hours') : null,
      day.plan.length ? h('span', {}, h('i', { class: 'dot dot-plan' }), 'Planned') : null,
    ),
  );
  draw();
  resize.observe(lanesBox);
  return body;
}

// What was up on the screens without the focus, beside what you were doing.
function screensCard(day) {
  const o = day.report.otherScreens;
  if (!o || o.top.length === 0) return null;
  const label = (i) => (i.title && i.title.toLowerCase() !== i.name.toLowerCase() ? `${i.name}: ${i.title}` : i.name);
  return card(
    'Other screens',
    `${o.screens} screen${o.screens === 1 ? '' : 's'} beside the one in use`,
    h('p', { class: 'hint' }, "What was on top of each screen you weren't typing on. It doesn't count toward active time: it shows what you kept up beside your work."),
    o.byScreen.map((s) => [
      h('h3', { style: { margin: '14px 0 8px' } }, `Screen ${s.screen} · ${duration(s.ms)}`),
      bars(s.top.map((i) => ({ ...i, name: label(i) })), (i) => colorOf(i.category)),
    ]),
    o.pairs.length
      ? [
          h('h3', { style: { margin: '16px 0 8px' } }, 'Most often side by side'),
          h(
            'div',
            { class: 'pairs' },
            o.pairs.slice(0, 6).map((p) =>
              h(
                'div',
                { class: 'pair' },
                h('span', {}, swatch(p.category), h('span', { class: 'plus' }, '+'), swatch(p.visibleCategory), ` ${p.doing} + ${p.visible}`),
                h('span', { class: 'time' }, duration(p.ms)),
              ),
            ),
          ),
        ]
      : null,
    o.whileIdle.length
      ? [
          h('h3', { style: { margin: '16px 0 8px' } }, 'Up while the PC sat idle'),
          h('p', { class: 'hint' }, 'Reading or watching, or away: what was open on the other screens while nothing was touched.'),
          bars(o.whileIdle.slice(0, 5).map((i) => ({ ...i, name: label(i) })), (i) => colorOf(i.category)),
        ]
      : null,
  );
}

function multitaskCard(day) {
  const m = day.report.multitasking;
  const phone = m.phone ?? { ms: 0, whileActiveMs: 0, whilePcIdleMs: 0, pairs: [] };
  if (m.listeningMs === 0 && phone.ms === 0) {
    return card('Multitasking', null, h('p', { class: 'empty' }, 'No background sound or phone use recorded. Music, podcasts, and videos playing while you do something else, and phone time you log while at the PC, show up here.'));
  }
  const pairList = (pairs) =>
    h(
      'div',
      { class: 'pairs' },
      pairs.slice(0, 6).map((p) =>
        h(
          'div',
          { class: 'pair' },
          h('span', {}, swatch(p.category), h('span', { class: 'plus' }, '+'), ` ${p.doing} + ${p.listening}`),
          h('span', { class: 'time' }, duration(p.ms)),
        ),
      ),
    );
  const phoneSection = phone.ms
    ? [
        h('h3', { style: { margin: '16px 0 8px' } }, `On the phone at the PC: ${duration(phone.whileActiveMs)}`),
        h('p', { class: 'hint' }, `${duration(phone.ms)} of phone time logged: ${duration(phone.whileActiveMs)} while you were active on the PC, ${duration(phone.whilePcIdleMs)} while it sat idle.`),
        phone.pairs.length ? pairList(phone.pairs) : null,
      ]
    : null;
  if (m.listeningMs === 0) return card('Multitasking', `${duration(phone.whileActiveMs)} on the phone while at the PC`, phoneSection);
  // Every song, video, or call, across sources, longest first.
  const played = m.bySource
    .flatMap((s) => (s.titles ?? []).map((t) => ({ ...t, source: s.name })))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 8);
  return card(
    'Multitasking',
    `${duration(m.listeningMs)} with sound playing`,
    h('p', { class: 'hint' }, `${duration(m.whileActiveMs)} of it while you were doing something else, ${duration(m.whileIdleMs)} while away from the keyboard.`),
    h('h3', { style: { margin: '14px 0 8px' } }, 'Listening to'),
    bars(m.bySource.slice(0, 6).map((s) => ({ ...s, name: s.title ? `${s.name} · ${s.title}` : s.name })), () => SOUND_COLOR),
    played.length
      ? [
          h('h3', { style: { margin: '16px 0 8px' } }, 'What played'),
          h(
            'div',
            { class: 'pairs' },
            played.map((t) =>
              h(
                'div',
                { class: 'pair' },
                h('span', { dir: 'auto' }, h('i', { class: 'dot', style: { background: SOUND_COLOR } }), ` ${t.name}`, h('small', { class: 'hint' }, ` · ${t.source}`)),
                h('span', { class: 'time' }, duration(t.ms)),
              ),
            ),
          ),
        ]
      : null,
    phoneSection,
    m.pairs.length
      ? [
          h('h3', { style: { margin: '16px 0 8px' } }, 'Most often together'),
          h(
            'div',
            { class: 'pairs' },
            m.pairs.slice(0, 6).map((p) =>
              h(
                'div',
                { class: 'pair' },
                h('span', { dir: 'auto' }, swatch(p.category), h('span', { class: 'plus' }, '+'), h('i', { class: 'dot', style: { background: SOUND_COLOR } }), ` ${p.doing} + ${p.listening}${p.listeningTitle ? ` (${p.listeningTitle})` : ''}`),
                h('span', { class: 'time' }, duration(p.ms)),
              ),
            ),
          ),
        ]
      : null,
  );
}

function categoriesCard(day) {
  const items = day.report.totals.map((t) => ({ name: t.category, ms: t.ms }));
  const neutral = day.report.totals.filter((t) => !FOCUS.has(t.category) && !DISTRACTION.has(t.category) && t.category !== 'idle').reduce((s, t) => s + t.ms, 0);
  const parts = [['Focus', day.focusMs, 'var(--cat-work)'], ['Distraction', day.distractionMs, 'var(--cat-video)'], ['Neutral', neutral, 'var(--cat-other)']];
  const sum = parts.reduce((s, p) => s + p[1], 0);
  return card(
    'Where the time went',
    `${duration(day.report.trackedMs)} recorded`,
    sum
      ? [
          h('div', { class: 'split', role: 'img', 'aria-label': parts.map(([k, ms]) => `${k} ${duration(ms)}`).join(', ') }, parts.filter((p) => p[1] > 0).map(([, ms, c]) => h('b', { style: { flex: String(ms), background: c } }))),
          h('div', { class: 'totals' }, parts.map(([k, ms, c]) => h('div', {}, h('span', { class: 'k' }, h('i', { class: 'dot', style: { background: c } }), k), h('span', { class: 'v' }, duration(ms))))),
        ]
      : null,
    bars(items, (i) => colorOf(i.name)),
  );
}

function tasksCard(dayKeyValue, tasks, refresh, { title = 'Tasks', note, allowAdd = true, extra, empty } = {}) {
  const input = h('input', { type: 'text', dir: 'auto', placeholder: 'Add a task and press Enter', 'aria-label': 'New task' });
  const add = oneAtATime(async () => {
    const text = input.value.trim();
    if (!text) return;
    try {
      await api('/tasks', { method: 'POST', body: { day: dayKeyValue, text } });
      input.value = '';
      await refresh(true);
    } catch (error) {
      handle(error);
    }
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  const done = tasks.filter((t) => t.doneAt !== null).length;
  return card(
    title,
    note ?? (tasks.length ? `${done} of ${tasks.length} done` : null),
    tasks.length
      ? h(
          'ul',
          { class: 'list' },
          tasks.map((task) =>
            h(
              'li',
              { class: `task${task.doneAt !== null ? ' done' : ''}` },
              h('input', {
                type: 'checkbox',
                checked: task.doneAt !== null,
                'aria-label': `Done: ${task.text}`,
                onchange: async (e) => {
                  try {
                    await api(`/tasks/${task.id}`, { method: 'PATCH', body: { done: e.target.checked } });
                    await refresh();
                  } catch (error) {
                    handle(error);
                  }
                },
              }),
              h('span', { class: 'grow text', dir: 'auto' }, task.text),
              task.doneAt !== null ? h('span', { class: 'time' }, `done ${clock(task.doneAt)}`) : null,
              extra?.(task),
              h('button', {
                class: 'icon-btn',
                title: 'Delete task',
                'aria-label': `Delete ${task.text}`,
                onclick: async () => {
                  try {
                    await api(`/tasks/${task.id}`, { method: 'DELETE' });
                    await refresh();
                  } catch (error) {
                    handle(error);
                  }
                },
              }, '×'),
            ),
          ),
        )
      : h('p', { class: 'empty' }, empty ?? (allowAdd ? 'No tasks yet.' : 'No tasks were set for this day.')),
    allowAdd ? h('div', { class: 'add-row' }, input, h('button', { class: 'btn primary', onclick: add }, 'Add')) : null,
  );
}

function gapCard(day, gap, refresh, categories) {
  const label = h('input', { type: 'text', placeholder: 'What were you doing?', list: 'life-labels', 'aria-label': 'What you were doing' });
  const category = h(
    'select',
    { 'aria-label': 'Category' },
    h('option', { value: '' }, 'Category (optional)'),
    categories.map((c) => h('option', { value: c }, c)),
  );
  const startInput = h('input', { type: 'time', value: clock(gap.start), 'aria-label': 'From' });
  const endInput = h('input', { type: 'time', value: clock(gap.end === day.to ? gap.end - 60000 : gap.end), 'aria-label': 'Until' });
  const initial = { start: startInput.value, end: endInput.value };
  const chips = QUICK.map(([text, cat, ic]) =>
    h('button', {
      class: 'chip',
      type: 'button',
      onclick: (e) => {
        const picked = e.currentTarget;
        label.value = text;
        category.value = cat;
        for (const chip of picked.parentElement.children) chip.classList.toggle('on', chip === picked);
        label.focus();
      },
    }, icon(ic), text),
  );
  const save = oneAtATime(async () => {
    const text = label.value.trim();
    if (!text) {
      label.focus();
      say('Say what you were doing first', true);
      return;
    }
    // Times left as they were keep the exact gap edges, including midnight.
    const start = startInput.value === initial.start ? gap.start : onDay(day.date, startInput.value);
    const end = endInput.value === initial.end ? gap.end : onDay(day.date, endInput.value);
    try {
      await api('/entries', { method: 'POST', body: { start, end, label: text, category: category.value || null } });
      say(`Logged: ${text}`);
      await refresh();
    } catch (error) {
      handle(error);
    }
  });
  label.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  const why = gap.kind === 'idle' ? `PC on but untouched${gap.onScreen ? `, ${gap.onScreen} on screen` : ''}` : 'PC off, asleep, or locked';
  return h(
    'div',
    { class: 'gap-card', 'data-gap': gap.start },
    h('div', { class: 'gap-top' }, h('strong', {}, span(gap.start, gap.end), h('span', {}, duration(gap.ms))), h('span', { class: 'why' }, why)),
    h('div', { class: 'chips' }, chips),
    h('div', { class: 'gap-form' }, label, category, startInput, h('span', { class: 'to' }, 'to'), endInput, h('button', { class: 'btn primary', onclick: save }, 'Log it')),
  );
}

function gapsCard(day, refresh, { title = 'Gaps to log', note } = {}) {
  const datalist = h('datalist', { id: 'life-labels' }, QUICK.map(([text]) => h('option', { value: text })));
  return card(
    title,
    note ?? (day.gaps.length ? `${day.gaps.length} left · ${duration(day.gapMs)}` : null),
    datalist,
    day.gaps.length
      ? day.gaps.map((gap) => gapCard(day, gap, refresh, day.entryCategories))
      : h('p', { class: 'empty' }, 'Nothing left to log. Every stretch away from the PC is accounted for.'),
  );
}

function entryEditRow(day, e, refresh, done) {
  const label = h('input', { type: 'text', dir: 'auto', value: e.label, list: 'life-labels', 'aria-label': 'What you did', maxlength: 200 });
  const cats = [...new Set([...(day.entryCategories ?? []), ...(e.category ? [e.category] : [])])];
  const category = h(
    'select',
    { 'aria-label': 'Category' },
    h('option', { value: '' }, 'No category'),
    cats.map((c) => h('option', { value: c, selected: c === e.category }, c)),
  );
  category.value = e.category ?? '';
  const startInput = h('input', { type: 'time', value: clock(e.start), 'aria-label': 'From' });
  const endInput = h('input', { type: 'time', value: clock(e.end), 'aria-label': 'Until' });
  const initial = { start: startInput.value, end: endInput.value };
  const save = oneAtATime(async () => {
    const text = label.value.trim();
    if (!text) {
      label.focus();
      say('Say what you did first', true);
      return;
    }
    // Times left as they were keep their exact moment (and day, for entries that cross midnight).
    const start = startInput.value === initial.start ? e.start : onDay(dayKey(e.start), startInput.value);
    let end = endInput.value === initial.end ? e.end : onDay(dayKey(e.end), endInput.value);
    if (end <= start) end = onDay(dayKey(start + 86400000), endInput.value);
    try {
      await api(`/entries/${e.id}`, { method: 'PUT', body: { start, end, label: text, category: category.value || null } });
      say(`Updated: ${text}`);
      await refresh();
    } catch (error) {
      handle(error);
    }
  });
  const row = h(
    'li',
    { class: 'entry-edit' },
    h(
      'div',
      { class: 'gap-form' },
      label, category, startInput, h('span', { class: 'to' }, 'to'), endInput,
      h('button', { class: 'btn primary sm', onclick: save }, 'Save'),
      h('button', { class: 'btn sm', onclick: done }, 'Cancel'),
    ),
  );
  row.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.tagName !== 'BUTTON') save();
    if (ev.key === 'Escape') done();
  });
  return row;
}

function entriesCard(day, refresh) {
  const entries = day.report.entries;
  const viewRow = (e) =>
    h(
      'li',
      {},
      h('i', { class: 'dot logged' }),
      h('span', { class: 'time' }, span(e.start, e.end)),
      h('span', { class: 'grow', dir: 'auto' }, e.label, e.category ? h('span', { class: 'time' }, ` · ${e.category}`) : null),
      h('span', { class: 'time' }, duration(e.end - e.start)),
      h('button', {
        class: 'icon-btn edit',
        title: 'Edit',
        'aria-label': `Edit ${e.label}`,
        onclick: (ev) => {
          const li = ev.currentTarget.closest('li');
          const back = () => editor.replaceWith(viewRow(e));
          const editor = entryEditRow(day, e, refresh, back);
          li.replaceWith(editor);
          editor.querySelector('input')?.focus();
        },
      }, '✎'),
      h('button', {
        class: 'icon-btn',
        title: 'Remove',
        'aria-label': `Remove ${e.label}`,
        onclick: async () => {
          try {
            await api(`/entries/${e.id}`, { method: 'DELETE' });
            await refresh();
          } catch (error) {
            handle(error);
          }
        },
      }, '×'),
    );
  return card(
    'You logged',
    entries.length ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` : null,
    entries.length
      ? h('ul', { class: 'list' }, entries.map(viewRow))
      : h('p', { class: 'empty' }, 'Nothing logged yet. Fill in the gaps to see your whole day here.'),
  );
}

function dayStats(day) {
  const r = day.report;
  const f = r.longestFocus;
  return h(
    'div',
    { class: 'stats' },
    stat('Active on the PC', duration(day.activeMs), `${duration(r.idleMs)} idle`),
    stat('Focused', duration(day.focusMs), `${duration(day.distractionMs)} on distractions${day.logged.ms ? `, ${duration(day.logged.ms)} logged off the PC` : ''}`),
    day.logged.phoneMs ? stat('On the phone', duration(day.logged.phoneMs), day.logged.phoneDistractionMs ? `${duration(day.logged.phoneDistractionMs)} social media or video` : 'logged') : null,
    stat('Longest focus', f ? duration(f.ms) : '—', f ? span(f.start, f.end) : null),
    stat('Switches', String(r.switches), 'focus ⇄ distraction'),
    stat('Background sound', duration(r.multitasking.listeningMs), r.multitasking.whileActiveMs ? `${duration(r.multitasking.whileActiveMs)} while busy` : null),
  );
}

// ------------------------------------------------------------------ check-ins, goals, sleep

const MOODS = [['😞', 'Awful'], ['🙁', 'Low'], ['😐', 'Okay'], ['🙂', 'Good'], ['😄', 'Great']];
const ENERGY = [['🪫', 'Drained'], ['😴', 'Tired'], ['😐', 'Okay'], ['💪', 'Good'], ['⚡', 'Full of energy']];
const moodWord = (n) => (n ? MOODS[Math.round(n) - 1][1] : '—');
const ratingText = (scale, n) => (n ? `${scale[Math.round(n) - 1][0]} ${scale[Math.round(n) - 1][1]}` : '—');

function ratingRow(name, scale, value, onPick) {
  const said = h('span', { class: 'said' }, value ? scale[value - 1][1] : '');
  return h(
    'div',
    { class: 'rating', role: 'group', 'aria-label': name },
    h('span', { class: 'what' }, name),
    h(
      'span',
      { class: 'scale' },
      scale.map(([emoji, word], i) =>
        h('button', {
          type: 'button',
          class: value === i + 1 ? 'on' : '',
          title: word,
          'aria-label': `${name}: ${word}`,
          'aria-pressed': String(value === i + 1),
          onclick: () => onPick(value === i + 1 ? null : i + 1),
        }, emoji),
      ),
    ),
    said,
  );
}

// ------------------------------------------------------------------ note editor
// Notes stay plain text with light Markdown (**bold**, - lists, - [ ] checks, # headings),
// so the CLI and the skill read them as they are. The preview is built node by node, never as HTML.

const NOTE_MAX = 10000;
const LIST_RE = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)[.)] |> )/;

/** Inline Markdown into text nodes and elements. */
function inlineNote(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*|~~(.+?)~~|==(.+?)==|`([^`]+)`|\*([^*\s](?:[^*]*?[^*\s])?)\*|(?<![\p{L}\p{N}])_([^_\s](?:[^_]*?[^_\s])?)_(?![\p{L}\p{N}])/gu;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(h('strong', {}, inlineNote(m[1])));
    else if (m[2] !== undefined) out.push(h('s', {}, inlineNote(m[2])));
    else if (m[3] !== undefined) out.push(h('mark', {}, inlineNote(m[3])));
    else if (m[4] !== undefined) out.push(h('code', {}, m[4]));
    else out.push(h('em', {}, inlineNote(m[5] ?? m[6])));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A note as formatted blocks. `onToggle(lineIndex)` makes check items clickable. */
function renderNote(text, onToggle) {
  const root = h('div', { class: 'note-view', dir: 'auto' });
  let list = null;
  let para = null;
  const close = () => ((list = null), (para = null));
  text.split('\n').forEach((line, i) => {
    const indent = Math.floor((line.match(/^\s*/)[0].replace(/\t/g, '  ').length) / 2);
    const t = line.trim();
    let m;
    if (!t) return close();
    if ((m = t.match(/^(#{1,3})\s+(.*)$/))) {
      close();
      return root.append(h(`h${m[1].length + 2}`, { class: 'note-h' }, inlineNote(m[2])));
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) return close(), root.append(h('hr', {}));
    if ((m = t.match(/^>\s?(.*)$/))) {
      close();
      const prev = root.lastElementChild;
      if (prev?.tagName === 'BLOCKQUOTE') return prev.append(h('br'), ...inlineNote(m[1]));
      return root.append(h('blockquote', {}, inlineNote(m[1])));
    }
    const check = t.match(/^[-*+] \[([ xX])\]\s?(.*)$/);
    const bullet = !check && t.match(/^[-*+]\s+(.*)$/);
    const num = !check && !bullet && t.match(/^(\d+)[.)]\s+(.*)$/);
    if (check || bullet || num) {
      para = null;
      const tag = num ? 'ol' : 'ul';
      const kind = check ? 'checks' : tag;
      if (!list || list.dataset.kind !== kind) {
        list = h(tag, { class: `note-list ${kind}`, 'data-kind': kind }, null);
        if (num) list.start = Number(num[1]);
        root.append(list);
      }
      const style = indent ? { marginInlineStart: `${indent * 20}px` } : undefined;
      if (check) {
        const done = check[1] !== ' ';
        const box = h('input', { type: 'checkbox', checked: done, disabled: !onToggle, 'aria-label': check[2] || 'Item' });
        if (onToggle) box.addEventListener('change', () => onToggle(i));
        return list.append(h('li', { class: done ? 'done' : '', style }, h('label', {}, box, h('span', {}, inlineNote(check[2])))));
      }
      return list.append(h('li', { style }, inlineNote((bullet ?? num)[bullet ? 1 : 2])));
    }
    list = null;
    if (para) para.append(h('br'), ...inlineNote(t));
    else root.append((para = h('p', {}, inlineNote(t))));
  });
  return root;
}

/**
 * A small text editor over a textarea: toolbar, shortcuts, lists that continue on Enter,
 * Tab to indent list items, a preview, word count, and autosave. `onSave(text)` stores it;
 * the returned element has `flush()` to save anything still pending.
 */
function noteEditor({ value = '', placeholder, label = 'Note', onSave }) {
  const area = h('textarea', { class: 'note-input', placeholder, 'aria-label': label, dir: 'auto', maxlength: NOTE_MAX, spellcheck: 'true' });
  area.value = value;
  let saved = value;
  let timer;
  let saving = null;
  const status = h('span', { class: 'note-status', 'aria-live': 'polite' }, value ? 'Saved' : '');
  const count = h('span', { class: 'note-count' });

  const grow = () => {
    area.style.height = 'auto';
    area.style.height = `${Math.min(Math.max(area.scrollHeight + 2, 120), 520)}px`;
  };
  const counts = () => {
    const words = area.value.trim() ? area.value.trim().split(/\s+/).length : 0;
    count.textContent = `${words} word${words === 1 ? '' : 's'}${area.value.length > NOTE_MAX * 0.9 ? ` · ${NOTE_MAX - area.value.length} characters left` : ''}`;
  };
  const save = async () => {
    clearTimeout(timer);
    if (saving) await saving;
    const text = area.value;
    if (text === saved) return;
    status.textContent = 'Saving…';
    saving = (async () => {
      try {
        await onSave(text);
        saved = text;
        status.textContent = `Saved ${clock(Date.now())}`;
      } catch (error) {
        status.textContent = 'Not saved';
        handle(error);
      }
    })();
    await saving;
    saving = null;
  };
  const changed = () => {
    grow();
    counts();
    if (area.value !== saved) status.textContent = 'Editing…';
    clearTimeout(timer);
    timer = setTimeout(save, 1200);
    if (!view.hidden) showPreview();
  };

  /** Replaces [start, end) through the browser's own editing, so Ctrl+Z still undoes it. */
  const replace = (start, end, text, selStart = start + text.length, selEnd = selStart) => {
    area.focus();
    area.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, text)) area.setRangeText(text, start, end, 'end');
    area.setSelectionRange(selStart, selEnd);
    changed();
  };
  const lineBounds = () => {
    const v = area.value;
    const start = v.lastIndexOf('\n', area.selectionStart - 1) + 1;
    let end = v.indexOf('\n', area.selectionEnd - (area.selectionEnd > area.selectionStart && v[area.selectionEnd - 1] === '\n' ? 1 : 0));
    if (end === -1) end = v.length;
    return [start, end];
  };

  const wrap = (mark) => {
    const { selectionStart: s, selectionEnd: e, value: v } = area;
    const sel = v.slice(s, e);
    if (v.slice(s - mark.length, s) === mark && v.slice(e, e + mark.length) === mark) {
      return replace(s - mark.length, e + mark.length, sel, s - mark.length, e - mark.length);
    }
    if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
      const inner = sel.slice(mark.length, -mark.length);
      return replace(s, e, inner, s, s + inner.length);
    }
    replace(s, e, `${mark}${sel}${mark}`, s + mark.length, e + mark.length);
  };

  /** Puts `prefix` on every selected line, or takes it off when they all have it already. */
  const prefixLines = (kind) => {
    const [start, end] = lineBounds();
    const lines = area.value.slice(start, end).split('\n');
    const strip = (l) => l.replace(/^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> |#{1,3} )/, '$1');
    const has = {
      bullet: (l) => /^\s*[-*+] (?!\[[ xX]\] )/.test(l),
      number: (l) => /^\s*\d+[.)] /.test(l),
      check: (l) => /^\s*[-*+] \[[ xX]\] /.test(l),
      quote: (l) => /^\s*> /.test(l),
    }[kind];
    const blank = lines.length === 1 && !lines[0].trim(); // an empty line starts a new list
    const all = !blank && lines.every((l) => !l.trim() || has(l));
    let n = 0;
    const next = lines.map((l) => {
      if (!l.trim() && !blank) return l;
      const bare = strip(l);
      if (all) return bare;
      const [, ws, rest] = bare.match(/^(\s*)(.*)$/);
      const p = { bullet: '- ', number: `${++n}. `, check: '- [ ] ', quote: '> ' }[kind];
      return `${ws}${p}${rest}`;
    });
    const text = next.join('\n');
    replace(start, end, text, start + text.length);
  };

  /** Cycles the line through heading sizes: none, #, ##, ###, none. */
  const heading = () => {
    const [start, end] = lineBounds();
    const line = area.value.slice(start, end);
    const level = (line.match(/^(#{1,3}) /)?.[1].length ?? 0);
    const bare = line.replace(/^#{1,3} /, '').replace(/^\s*(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/, '');
    const text = level === 3 ? bare : `${'#'.repeat(level + 1)} ${bare}`;
    replace(start, end, text, start + text.length);
  };

  const indent = (out) => {
    const [start, end] = lineBounds();
    const lines = area.value.slice(start, end).split('\n');
    const text = lines.map((l) => (out ? l.replace(/^( {1,2}|\t)/, '') : `  ${l}`)).join('\n');
    if (lines.length > 1) return replace(start, end, text, start, start + text.length);
    const caret = Math.max(start, area.selectionStart + text.length - (end - start));
    replace(start, end, text, caret);
  };

  const insertLine = (text) => {
    const { selectionStart: s, value: v } = area;
    const before = s > 0 && v[s - 1] !== '\n' ? '\n' : '';
    replace(s, area.selectionEnd, `${before}${text}\n`);
  };

  area.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && !e.shiftKey && k === 'b') return e.preventDefault(), wrap('**');
    if (mod && !e.shiftKey && k === 'i') return e.preventDefault(), wrap('*');
    if (mod && e.shiftKey && k === 'x') return e.preventDefault(), wrap('~~');
    if (mod && e.shiftKey && k === 'h') return e.preventDefault(), wrap('==');
    if (mod && !e.shiftKey && k === 'e') return e.preventDefault(), wrap('`');
    if (mod && e.shiftKey && (e.code === 'Digit8' || k === '*')) return e.preventDefault(), prefixLines('bullet');
    if (mod && e.shiftKey && (e.code === 'Digit7' || k === '&')) return e.preventDefault(), prefixLines('number');
    if (mod && e.shiftKey && (e.code === 'Digit9' || k === '(')) return e.preventDefault(), prefixLines('check');
    if (mod && k === 's') return e.preventDefault(), save();
    if (mod && k === 'enter') return e.preventDefault(), save();
    if (e.key === 'Tab' && !mod && !e.altKey) {
      const [start, end] = lineBounds();
      // Only inside a list or across lines, so Tab still moves on from plain text.
      if (LIST_RE.test(area.value.slice(start, end)) || area.value.slice(area.selectionStart, area.selectionEnd).includes('\n')) {
        e.preventDefault();
        indent(e.shiftKey);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.isComposing && area.selectionStart === area.selectionEnd) {
      const s = area.selectionStart;
      const start = area.value.lastIndexOf('\n', s - 1) + 1;
      const line = area.value.slice(start, s);
      const m = line.match(LIST_RE);
      if (!m) return;
      e.preventDefault();
      if (line.slice(m[0].length).trim() === '' && area.value.slice(s).split('\n')[0].trim() === '') {
        // Enter on an empty item ends the list (or steps out one level).
        if (m[1]) return replace(start, s, `${m[1].slice(2)}${m[2]}`);
        return replace(start, s, '');
      }
      const marker = m[3] ? `${Number(m[3]) + 1}${m[2].trim().slice(-1)} ` : /\[[ xX]\]/.test(m[2]) ? `${m[2][0]} [ ] ` : m[2];
      replace(s, s, `\n${m[1]}${marker}`);
    }
  });
  area.addEventListener('input', changed);
  area.addEventListener('blur', () => save());
  area.addEventListener('paste', () => setTimeout(grow, 0));

  const view = h('div', { class: 'note-preview' });
  view.hidden = true;
  const toggleLine = (i) => {
    const lines = area.value.split('\n');
    lines[i] = lines[i].replace(/\[([ xX])\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
    const start = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    const old = area.value.split('\n')[i];
    // The textarea is hidden in preview, so edit its text directly rather than through the caret.
    area.setRangeText(lines[i], start, start + old.length, 'preserve');
    changed();
    save();
  };
  const showPreview = () => {
    view.replaceChildren(area.value.trim() ? renderNote(area.value, toggleLine) : h('p', { class: 'hint' }, 'Nothing written yet.'));
  };

  const btn = (labelText, title, run, cls = '') =>
    h('button', { type: 'button', class: `tb ${cls}`, title, 'aria-label': title, onmousedown: (e) => e.preventDefault(), onclick: run }, labelText);
  const previewBtn = h('button', { type: 'button', class: 'tb tb-text', 'aria-pressed': 'false', title: 'Preview how it reads' }, 'Preview');
  const formatting = h(
    'div',
    { class: 'tb-group' },
    btn('B', 'Bold (Ctrl+B)', () => wrap('**'), 'tb-b'),
    btn('I', 'Italic (Ctrl+I)', () => wrap('*'), 'tb-i'),
    btn('S', 'Strikethrough (Ctrl+Shift+X)', () => wrap('~~'), 'tb-s'),
    btn('H', 'Highlight (Ctrl+Shift+H)', () => wrap('=='), 'tb-mark'),
    h('i', { class: 'tb-sep' }),
    btn('H₁', 'Heading (click again for smaller, then off)', heading),
    btn('•', 'Bulleted list (Ctrl+Shift+8)', () => prefixLines('bullet')),
    btn('1.', 'Numbered list (Ctrl+Shift+7)', () => prefixLines('number')),
    btn('☐', 'Checklist (Ctrl+Shift+9)', () => prefixLines('check')),
    btn('❝', 'Quote', () => prefixLines('quote')),
    btn('—', 'Divider', () => insertLine('---')),
    btn('⇥', 'Indent list item (Tab)', () => indent(false)),
    btn('⇤', 'Outdent list item (Shift+Tab)', () => indent(true)),
    h('i', { class: 'tb-sep' }),
    btn('↶', 'Undo (Ctrl+Z)', () => (area.focus(), document.execCommand('undo'), changed())),
    btn('↷', 'Redo (Ctrl+Y)', () => (area.focus(), document.execCommand('redo'), changed())),
  );
  previewBtn.addEventListener('click', () => {
    const on = view.hidden;
    view.hidden = !on;
    area.hidden = on;
    formatting.classList.toggle('off', on);
    previewBtn.setAttribute('aria-pressed', String(on));
    previewBtn.textContent = on ? 'Write' : 'Preview';
    if (on) showPreview();
    else area.focus(), grow();
  });

  const box = h(
    'div',
    { class: 'note-editor' },
    h('div', { class: 'note-toolbar', role: 'toolbar', 'aria-label': `${label} formatting` }, formatting, previewBtn),
    area,
    view,
    h('div', { class: 'note-foot' }, count, status, h('button', { type: 'button', class: 'btn sm', onclick: () => save() }, 'Save')),
  );
  box.flush = save;
  counts();
  requestAnimationFrame(grow);
  return box;
}

/** The morning or evening check-in: mood, energy, and a note written in the note editor. */
function checkinCard(dayKeyValue, part, checkins, refresh, { title, note, withNote = false, notePrompt } = {}) {
  const current = checkins.find((c) => c.part === part) ?? { mood: null, energy: null, note: null };
  const editor = withNote
    ? noteEditor({
        value: current.note ?? '',
        placeholder: `${notePrompt ?? 'Anything that affected how you felt? (optional)'}\nTip: - for a list, - [ ] for a checklist, **bold**`,
        label: part === 'morning' ? 'Morning note' : 'Evening note',
        onSave: (text) => api('/checkins', { method: 'PUT', body: { day: dayKeyValue, part, note: text } }),
      })
    : null;
  const save = async (change, message) => {
    try {
      await editor?.flush(); // so a rating click never loses what's being typed
      await api('/checkins', { method: 'PUT', body: { day: dayKeyValue, part, ...change } });
      if (message) say(message);
      await refresh();
    } catch (error) {
      handle(error);
    }
  };
  return card(
    title ?? (part === 'morning' ? 'How are you feeling?' : 'How did you feel today?'),
    note ?? (current.mood || current.energy ? `Saved ${clock(current.at)}` : null),
    ratingRow('Mood', MOODS, current.mood, (v) => save({ mood: v })),
    ratingRow('Energy', ENERGY, current.energy, (v) => save({ energy: v })),
    editor,
  );
}

/** Today page: both check-ins at a glance, with a link to fill in what's missing. */
function moodSummaryCard(day, refresh) {
  const morning = day.checkins.find((c) => c.part === 'morning');
  const evening = day.checkins.find((c) => c.part === 'evening');
  if ((morning?.mood == null || morning?.energy == null) && day.date === today()) return checkinCard(day.date, 'morning', day.checkins, refresh, { title: 'Check in: how are you feeling?' });
  const line = (label, c) =>
    h('div', { class: 'part' }, h('span', {}, label), h('span', {}, c ? `${ratingText(MOODS, c.mood)} · energy ${c.energy ?? '—'}/5` : 'not yet'));
  return card(
    'Mood and energy',
    null,
    h('div', { class: 'mini-checkins' }, line('Morning', morning), line('Evening', evening)),
    morning?.note ? h('div', { class: 'note-summary' }, h('h3', {}, 'Morning note'), renderNote(morning.note)) : null,
    evening?.note ? h('div', { class: 'note-summary' }, h('h3', {}, 'Evening note'), renderNote(evening.note)) : null,
    !evening && day.date === today() ? h('p', { class: 'hint', style: { marginTop: '8px' } }, 'The evening log asks again. ', h('a', { href: '#evening' }, 'Check in now')) : null,
  );
}

const RESULTS = [['met', 'Met'], ['partly', 'Partly'], ['missed', 'Missed']];

/** The day's goals. `review` shows how each went (evening); otherwise they can be added (morning). */
function goalsCard(dayKeyValue, goals, refresh, { title = "Today's goals", note, review = false, allowAdd = true } = {}) {
  const input = h('input', { type: 'text', placeholder: goals.length ? 'Another goal' : 'The one thing that would make today a good day', 'aria-label': 'New goal' });
  const add = oneAtATime(async () => {
    const text = input.value.trim();
    if (!text) return;
    try {
      await api('/goals', { method: 'POST', body: { day: dayKeyValue, text } });
      input.value = '';
      await refresh();
    } catch (error) {
      handle(error);
    }
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  const call = async (path, options) => {
    try {
      await api(path, options);
      await refresh();
    } catch (error) {
      handle(error);
    }
  };
  const met = goals.filter((g) => g.result === 'met').length;
  return card(
    title,
    note ?? (goals.length && review ? `${met} of ${goals.length} met` : goals.length ? null : 'What you want to get done'),
    goals.length
      ? h(
          'ul',
          { class: 'list' },
          goals.map((goal) =>
            h(
              'li',
              { class: 'goal' },
              h('span', { class: 'grow', dir: 'auto' }, goal.text),
              review || goal.result
                ? h(
                    'span',
                    { class: 'seg', role: 'group', 'aria-label': `How it went: ${goal.text}` },
                    RESULTS.map(([value, label]) =>
                      h('button', {
                        type: 'button',
                        class: goal.result === value ? `on ${value}` : '',
                        'aria-pressed': String(goal.result === value),
                        onclick: () => call(`/goals/${goal.id}`, { method: 'PATCH', body: { result: goal.result === value ? null : value } }),
                      }, label),
                    ),
                  )
                : null,
              h('button', { class: 'icon-btn', title: 'Delete goal', 'aria-label': `Delete ${goal.text}`, onclick: () => call(`/goals/${goal.id}`, { method: 'DELETE' }) }, '×'),
            ),
          ),
        )
      : h('p', { class: 'empty' }, allowAdd ? 'No goals set yet.' : 'No goals were set for this day.'),
    allowAdd ? h('div', { class: 'add-row' }, input, h('button', { class: 'btn', onclick: add }, 'Add')) : null,
  );
}

/** Last night's sleep: what was logged, or the estimate to confirm or correct. */
function sleepCard(day, refresh, { title = 'Last night' } = {}) {
  const { night, naps, napMs } = day.sleep;
  const bedInput = h('input', { type: 'time', value: night ? clock(night.start) : '23:30', 'aria-label': 'Went to sleep' });
  const wakeInput = h('input', { type: 'time', value: night ? clock(night.end) : '07:00', 'aria-label': 'Woke up' });
  const logSleep = oneAtATime(async (start, end) => {
    try {
      await api('/entries', { method: 'POST', body: { start, end, label: 'Sleep', category: 'sleep' } });
      say('Sleep logged');
      await refresh();
    } catch (error) {
      handle(error);
    }
  });
  const fromInputs = () => {
    // A bedtime after noon was the evening before.
    const [bh] = bedInput.value.split(':').map(Number);
    const start = onDay(bh >= 12 ? shiftDay(day.date, -1) : day.date, bedInput.value);
    const end = onDay(day.date, wakeInput.value);
    if (end <= start) return say('Waking up has to come after going to sleep', true);
    if (end > Date.now()) return say("That's still to come", true);
    return logSleep(start, end);
  };
  const form = h(
    'div',
    { class: 'sleep-form', hidden: night?.source === 'estimated' ? true : undefined },
    h('span', {}, 'Slept from'), bedInput, h('span', {}, 'to'), wakeInput,
    h('button', { class: 'btn primary', onclick: fromInputs }, 'Log sleep'),
  );
  let body;
  if (night) {
    body = [
      h('div', { class: 'sleep-line' }, duration(night.ms), h('small', {}, `${span(night.start, night.end)}`), ' ', h('span', { class: 'badge' }, night.source === 'logged' ? 'logged' : 'estimated from the PC')),
      night.source === 'estimated'
        ? [
            h('p', { class: 'hint', style: { marginTop: '6px' } }, 'From when the PC was last used at night to when it was first used again.'),
            h('div', { class: 'row', style: { marginTop: '10px' } },
              h('button', { class: 'btn primary', onclick: () => logSleep(night.start, night.end) }, "That's right"),
              h('button', { class: 'btn', onclick: () => (form.hidden = !form.hidden) }, 'Adjust times'),
            ),
            form,
          ]
        : null,
    ];
  } else {
    body = [h('p', { class: 'hint' }, day.date === today() ? "رقيب couldn't tell when you slept. When did you?" : 'No sleep known for this night.'), form];
  }
  return card(
    title,
    napMs ? `+ ${duration(napMs)} nap${naps.length === 1 ? '' : 's'}` : null,
    body,
  );
}

// ------------------------------------------------------------------ the day's plan

/** Quick picks for a planned block: the label and the category it's held to. */
const PLAN_QUICK = [
  ['Deep work', 'work', 'projects'], ['Study', 'study', 'reports'], ['Exercise', 'exercise', 'exercise'], ['Meal', 'meal', 'meal'],
  ['Prayer', 'prayer', 'prayer'], ['Errands', 'errand', 'errand'], ['With people', 'social', 'social'], ['Entertainment', 'entertainment', 'music'], ['Rest', 'rest', 'rest'],
];
const STATUS = {
  kept: ['Kept', 'good'], partly: ['Partly', 'dawn'], missed: ['Missed', 'danger'], now: ['Now', 'accent'], upcoming: ['To come', ''],
};
/** Plan blocks are coloured by how they went, so the lane reads as plan vs actual. */
const STATUS_COLOR = { kept: 'var(--good)', partly: 'var(--dawn)', missed: 'var(--danger)', now: 'var(--accent)', upcoming: 'var(--accent)' };
/** "focus" in a plan means any focused work, whatever its category. */
const planCategoryName = (c) => (c === 'focus' ? 'any focus' : c);

/** A block's times on its day; an end at or before the start runs past midnight. */
function blockTimes(key, from, until) {
  const start = onDay(key, from);
  let end = onDay(key, until);
  if (end <= start) end = onDay(shiftDay(key, 1), until);
  return { start, end };
}

/** The plan as one bar across the day, so its shape shows at a glance. */
function planStrip(key, blocks, outcomes) {
  const from = parseDay(key);
  const to = parseDay(shiftDay(key, 1));
  const total = to - from;
  const byId = new Map((outcomes ?? []).map((o) => [o.block.id, o]));
  const now = Date.now();
  return h(
    'div',
    { class: 'plan-strip' },
    h(
      'div',
      { class: 'plan-strip-track' },
      blocks.map((b) => {
        const o = byId.get(b.id);
        const left = ((Math.max(b.start, from) - from) / total) * 100;
        const width = ((Math.min(b.end, to) - Math.max(b.start, from)) / total) * 100;
        return h('div', {
          class: `plan-chunk${o ? ` ${o.status}` : ''}`,
          style: { left: `${left}%`, width: `${width}%`, '--c': o ? STATUS_COLOR[o.status] : 'var(--accent)' },
          title: `${span(b.start, b.end)} ${b.label}${o ? ` · ${STATUS[o.status][0]}` : ''}`,
        });
      }),
      now >= from && now < to ? h('div', { class: 'plan-strip-now', style: { left: `${((now - from) / total) * 100}%` } }) : null,
    ),
    h('div', { class: 'plan-strip-axis' }, [0, 3, 6, 9, 12, 15, 18, 21, 24].map((hr) => h('span', { style: { left: `${(hr / 24) * 100}%` } }, `${pad(hr % 24)}`))),
  );
}

/**
 * Lays out a day's plan: blocks of time with what you'll do. Everything saves as you go.
 * `copyFrom` offers another day's plan as a starting point while this one is empty.
 */
function planEditor(key, blocks, refresh, categories, { title = 'Plan the day', note, copyFrom, outcomes } = {}) {
  const call = async (path, options, message) => {
    try {
      await api(path, options);
      if (message) say(message);
      await refresh();
    } catch (error) {
      handle(error);
    }
  };
  const categorySelect = (value) =>
    h(
      'select',
      { 'aria-label': 'Category' },
      h('option', { value: '' }, 'Category'),
      h('option', { value: 'focus', selected: value === 'focus' }, 'any focus'),
      categories.map((c) => h('option', { value: c, selected: value === c }, c)),
    );

  const rows = blocks.map((b) => {
    const startInput = h('input', { type: 'time', value: clock(b.start), 'aria-label': 'From' });
    const endInput = h('input', { type: 'time', value: clock(b.end), 'aria-label': 'Until' });
    const label = h('input', { type: 'text', dir: 'auto', value: b.label, 'aria-label': 'What you plan to do' });
    const category = categorySelect(b.category);
    category.value = b.category ?? '';
    const before = () => [startInput.value, endInput.value, label.value.trim(), category.value].join('|');
    const initial = before();
    const save = oneAtATime(async () => {
      if (before() === initial) return;
      if (!label.value.trim()) return say('Say what you plan to do', true);
      await call(`/plan/${b.id}`, { method: 'PUT', body: { ...blockTimes(key, startInput.value, endInput.value), label: label.value.trim(), category: category.value || null } });
    });
    const row = h(
      'li',
      { class: 'plan-row' },
      startInput, h('span', { class: 'to' }, '–'), endInput, label, category,
      h('button', { class: 'icon-btn', title: 'Remove block', 'aria-label': `Remove ${b.label}`, onclick: () => call(`/plan/${b.id}`, { method: 'DELETE' }) }, '×'),
    );
    // Saves once you leave the row, so typing a time doesn't redraw the page under you.
    row.addEventListener('focusout', (e) => !row.contains(e.relatedTarget) && save());
    category.addEventListener('change', save);
    label.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    return row;
  });

  // The next block starts where the last one ends, or at the next half hour today.
  const last = blocks.at(-1);
  const startDefault = (() => {
    if (last && dayKey(last.end) === key) return clock(last.end);
    if (key === today()) {
      const d = new Date(Date.now() + 30 * 60000);
      d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
      return dayKey(d.getTime()) === key ? clock(d.getTime()) : '23:00';
    }
    return '09:00';
  })();
  const [sh, sm] = startDefault.split(':').map(Number);
  const startInput = h('input', { type: 'time', value: startDefault, 'aria-label': 'From' });
  const endInput = h('input', { type: 'time', value: `${pad((sh + 1) % 24)}:${pad(sm)}`, 'aria-label': 'Until' });
  const label = h('input', { type: 'text', dir: 'auto', placeholder: 'What will you do?', 'aria-label': 'What you plan to do' });
  const category = categorySelect(null);
  const add = oneAtATime(async () => {
    const text = label.value.trim();
    if (!text) {
      label.focus();
      return say('Say what you plan to do', true);
    }
    await call('/plan', { method: 'POST', body: { day: key, ...blockTimes(key, startInput.value, endInput.value), label: text, category: category.value || null } });
  });
  label.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  const chips = PLAN_QUICK.map(([text, cat, ic]) =>
    h('button', {
      class: 'chip',
      type: 'button',
      onclick: (e) => {
        label.value = text;
        category.value = cat;
        for (const chip of e.currentTarget.parentElement.children) chip.classList.toggle('on', chip === e.currentTarget);
        label.focus();
      },
    }, icon(ic), text),
  );

  const plannedMs = blocks.reduce((s, b) => s + (b.end - b.start), 0);
  return card(
    title,
    note ?? (blocks.length ? `${blocks.length} block${blocks.length === 1 ? '' : 's'} · ${duration(plannedMs)} planned` : 'What you’ll do, and when'),
    blocks.length ? planStrip(key, blocks, outcomes) : null,
    blocks.length ? h('ul', { class: 'list plan-list' }, rows) : h('p', { class: 'empty' }, 'Nothing planned yet. Add the day’s main blocks: work, study, the gym, time with people.'),
    !blocks.length && copyFrom?.count
      ? h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn soft sm', onclick: () => call('/plan/copy', { method: 'POST', body: { from: copyFrom.day, to: key } }, 'Plan copied: adjust what’s different') },
            icon('arrowin'), `Start from ${copyFrom.label} (${copyFrom.count} block${copyFrom.count === 1 ? '' : 's'})`))
      : null,
    h('div', { class: 'chips plan-chips' }, chips),
    h('div', { class: 'plan-form' }, startInput, h('span', { class: 'to' }, 'to'), endInput, label, category, h('button', { class: 'btn primary', onclick: add }, icon('plus'), 'Add')),
  );
}

/** Each planned block next to what actually filled its time. */
function planVsActualCard(day, refresh, { title = 'Plan vs what happened', editable = false, copyFrom } = {}) {
  const pc = day.planComparison;
  const summary = pc.share === null
    ? `${pc.blocks.length} block${pc.blocks.length === 1 ? '' : 's'} · nothing started yet`
    : [`${Math.round(pc.share * 100)}% as planned`, pc.kept ? `${pc.kept} kept` : null, pc.partly ? `${pc.partly} partly` : null, pc.missed ? `${pc.missed} missed` : null].filter(Boolean).join(' · ');
  const items = pc.blocks.map((o) => {
    const b = o.block;
    const [word, tone] = STATUS[o.status];
    const blockMs = b.end - b.start;
    const did = o.actual.slice(0, 3).map((a) => h('span', { class: a.kept ? 'did kept' : 'did' }, a.kept ? '✓ ' : '', `${a.name} ${duration(a.ms)}`));
    if (o.unknownMs >= 60000) did.push(h('span', { class: 'did unknown' }, `not logged ${duration(o.unknownMs)}`));
    return h(
      'li',
      { class: 'pva' },
      h('div', { class: 'pva-top' },
        h('span', { class: 'time' }, span(b.start, b.end)),
        h('span', { class: 'grow', dir: 'auto' }, h('strong', {}, b.label), b.category ? h('span', { class: 'time' }, ` · ${planCategoryName(b.category)}`) : null),
        h('span', { class: `badge ${tone}` }, word),
      ),
      o.elapsedMs
        ? h('div', { class: 'pva-bar', title: `${duration(o.keptMs)} of ${duration(blockMs)} as planned` },
            h('b', { class: 'kept', style: { width: `${(o.keptMs / blockMs) * 100}%`, background: 'var(--good)' } }),
            h('b', { class: 'other', style: { width: `${((o.elapsedMs - o.keptMs) / blockMs) * 100}%` } }))
        : null,
      did.length ? h('div', { class: 'pva-did' }, h('span', { class: 'time' }, 'Did: '), did) : null,
    );
  });
  const editor = editable ? h('div', { class: 'pva-edit', hidden: true }, planEditor(day.date, day.plan, refresh, day.entryCategories, { title: 'Change the plan', copyFrom })) : null;
  return card(
    title,
    summary,
    planStrip(day.date, day.plan, pc.blocks),
    h('ul', { class: 'list' }, items),
    editor
      ? [h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onclick: () => (editor.hidden = !editor.hidden) }, 'Change the plan')), editor]
      : null,
  );
}

// ------------------------------------------------------------------ pages

async function todayPage(date) {
  const key = date ?? today();
  const [day, { projects }, before] = await Promise.all([api(`/day?date=${key}`), api(`/projects?date=${key}`), api(`/plan?date=${shiftDay(key, -1)}`)]);
  const refresh = () => render();
  const isToday = key === today();
  const copyFrom = { day: before.day, count: before.blocks.length, label: "yesterday's plan" };
  setTopnav(key, '#today');
  const head = h(
    'div',
    { class: 'page-head' },
    h(
      'div',
      {},
      h('h1', {}, isToday ? 'Today' : longDate(key)),
      h('p', {}, [isToday ? longDate(key) : null, `${duration(day.activeMs)} on the PC`, `${duration(day.focusMs)} focused`, day.gaps.length ? `${day.gaps.length} gap${day.gaps.length === 1 ? '' : 's'} to log` : null].filter(Boolean).join(' · ')),
    ),
    h('a', { class: 'btn primary', href: isToday ? '#evening' : `#evening/${key}` }, icon('evening'), 'Evening log'),
  );
  return [
    head,
    dayStats(day),
    h('div', { class: 'grid' }, timelineCard(day)),
    h(
      'div',
      { class: 'grid cols-2', style: { marginTop: '16px' } },
      h('div', { class: 'stack' }, gapsCard(day, refresh), entriesCard(day, refresh)),
      h(
        'div',
        { class: 'stack' },
        day.plan.length
          ? planVsActualCard(day, refresh, { title: isToday ? 'Your plan so far' : 'Plan vs what happened', editable: key >= today(), copyFrom })
          : key >= today()
            ? planEditor(key, [], refresh, day.entryCategories, { title: isToday ? 'Plan today' : 'Plan this day', copyFrom })
            : null,
        moodSummaryCard(day, refresh),
        goalsCard(key, day.goals, refresh, { title: isToday ? "Today's goals" : 'Goals', review: true, allowAdd: key >= today() }),
        projectsGlanceCard(key, projects),
        sleepCard(day, refresh, { title: isToday ? 'Last night' : 'Sleep' }),
        tasksCard(key, day.tasks, refresh),
        multitaskCard(day),
        screensCard(day),
        categoriesCard(day),
      ),
    ),
  ];
}

async function eveningPage(date) {
  const key = date ?? today();
  const next = shiftDay(key, 1);
  // Planning the next day: tonight for tomorrow, or this morning for today if last night's log was skipped.
  const planNext = next >= today();
  const [day, { projects }, nextPlan] = await Promise.all([api(`/day?date=${key}`), api(`/projects?date=${key}`), planNext ? api(`/plan?date=${next}`) : null]);
  const refresh = () => render();
  const done = day.tasks.filter((t) => t.doneAt !== null).length;
  const activeProjects = projects.filter((p) => p.status === 'active');
  setTopnav(key, '#evening');
  return [
    h(
      'section',
      { class: 'card hero dusk', style: { marginBottom: '16px' } },
      h('h1', {}, key === today() ? 'How did today go?' : `Log ${longDate(key)}`),
      h(
        'p',
        {},
        `You were active on the PC for ${duration(day.activeMs)}, ${duration(day.focusMs)} of it focused.`,
        day.tasks.length ? ` You finished ${done} of ${day.tasks.length} tasks.` : '',
        activeProjects.length ? ` Say what you did on your ${activeProjects.length === 1 ? 'project' : `${activeProjects.length} projects`}.` : '',
        day.gaps.length ? ` ${day.gaps.length} stretch${day.gaps.length === 1 ? '' : 'es'} (${duration(day.gapMs)}) aren't accounted for yet: tell رقيب what you were doing.` : ' Every stretch of the day is accounted for.',
        day.planComparison.share !== null ? ` ${Math.round(day.planComparison.share * 100)}% of the planned time went as planned.` : '',
        planNext ? (nextPlan.blocks.length ? ` ${next === today() ? 'Today' : 'Tomorrow'} has ${nextPlan.blocks.length} block${nextPlan.blocks.length === 1 ? '' : 's'} planned.` : ` Then plan ${next === today() ? 'today' : 'tomorrow'}.`) : '',
      ),
    ),
    h(
      'div',
      { class: 'grid cols-2' },
      h(
        'div',
        { class: 'stack' },
        checkinCard(key, 'evening', day.checkins, refresh, { withNote: true, notePrompt: 'What affected your day, good or bad? (optional)' }),
        day.plan.length ? planVsActualCard(day, refresh, { title: 'Your plan vs what happened' }) : null,
        gapsCard(day, refresh, { title: 'Fill in the gaps' }),
        entriesCard(day, refresh),
      ),
      h(
        'div',
        { class: 'stack' },
        eveningProjectsCard(key, projects),
        goalsCard(key, day.goals, refresh, { title: 'How did your goals go?', review: true, allowAdd: false }),
        tasksCard(key, day.tasks, refresh, { title: "Today's tasks" }),
        multitaskCard(day),
      ),
    ),
    h('div', { class: 'grid', style: { marginTop: '16px' } }, timelineCard(day)),
    planNext
      ? h('div', { class: 'grid', style: { marginTop: '16px' } },
          planEditor(next, nextPlan.blocks, refresh, day.entryCategories, {
            title: next === today() ? 'Plan today' : `Plan tomorrow, ${longDate(next)}`,
            note: nextPlan.blocks.length ? undefined : 'A few minutes now, so the morning starts with a plan',
            copyFrom: { day: key, count: day.plan.length, label: next === today() ? "yesterday's plan" : "today's plan" },
          }))
      : null,
    h(
      'div',
      { class: 'footer-actions' },
      new Date(parseDay(key)).getDay() === 0 ? h('a', { class: 'btn big', href: `#week/${key}` }, 'Review the week') : null,
      h('button', { class: 'btn primary big', onclick: () => closeOr('#today') }, icon('check'), 'Done for today'),
    ),
  ];
}

async function morningPage() {
  const key = today();
  const yesterday = shiftDay(key, -1);
  const [day, past, { projects }, { projects: pastProjects }] = await Promise.all([
    api(`/day?date=${key}`),
    api(`/day?date=${yesterday}`),
    api(`/projects?date=${key}`),
    api(`/projects?date=${yesterday}`),
  ]);
  const refresh = () => render();
  const unfinished = past.tasks.filter((t) => t.doneAt === null && !day.tasks.some((n) => n.text === t.text));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const r = past.report;
  const pastDone = past.tasks.filter((t) => t.doneAt !== null).length;

  const top = r.totals.filter((t) => t.category !== 'idle').slice(0, 4);
  const yesterdayCard = card(
    `Yesterday, ${longDate(yesterday)}`,
    null,
    h(
      'div',
      { class: 'stats', style: { marginBottom: '12px' } },
      stat('Active on the PC', duration(past.activeMs)),
      stat('Focused', duration(past.focusMs)),
      stat('Tasks done', past.tasks.length ? `${pastDone}/${past.tasks.length}` : '—'),
      past.goals.length ? stat('Goals met', `${past.goals.filter((g) => g.result === 'met').length}/${past.goals.length}`) : null,
      past.planComparison.share !== null
        ? stat('Plan kept', `${Math.round(past.planComparison.share * 100)}%`, `${past.planComparison.kept} of ${past.planComparison.blocks.length} block${past.planComparison.blocks.length === 1 ? '' : 's'} kept`)
        : null,
      (() => {
        const moods = past.checkins.map((c) => c.mood).filter(Boolean);
        return moods.length ? stat('Mood', ratingText(MOODS, moods.reduce((a, b) => a + b, 0) / moods.length)) : stat('Background sound', duration(r.multitasking.listeningMs));
      })(),
      past.gaps.length ? stat('Unlogged gaps', `${past.gaps.length} · ${duration(past.gapMs)}`, h('a', { href: `#evening/${yesterday}` }, 'Log them now'), 'dawn') : null,
    ),
    top.length ? bars(top.map((t) => ({ name: t.category, ms: t.ms })), (i) => colorOf(i.name)) : h('p', { class: 'empty' }, 'Nothing was recorded yesterday.'),
    r.entries.length
      ? h('p', { class: 'hint', style: { marginTop: '12px' } }, 'You logged: ', r.entries.map((e) => `${e.label} (${duration(e.end - e.start)})`).join(', '), ' · ', h('a', { href: `#evening/${yesterday}` }, 'Edit'))
      : null,
  );

  // Unfinished tasks from yesterday, each with its own Bring over, plus one for all of them.
  const bringOne = async (task) => {
    try {
      await api('/tasks', { method: 'POST', body: { day: key, text: task.text } });
      say(`Brought over: ${task.text}`);
      await refresh();
    } catch (error) {
      handle(error);
    }
  };
  const bringAll = async () => {
    try {
      const added = await api('/tasks/carry', { method: 'POST', body: { from: yesterday, to: key } });
      say(`Brought over ${added.length} task${added.length === 1 ? '' : 's'}`);
      await refresh();
    } catch (error) {
      handle(error);
    }
  };
  const carry = unfinished.length
    ? card(
        'Left from yesterday',
        'Bring over what still matters',
        h('ul', { class: 'list' }, unfinished.map((t) =>
          h('li', { class: 'task' },
            h('span', { class: 'grow text', dir: 'auto' }, t.text),
            h('button', { class: 'btn soft sm', onclick: () => bringOne(t) }, icon('arrowin'), 'Bring over'),
          ),
        )),
        unfinished.length > 1 ? h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onclick: bringAll }, 'Bring all over')) : null,
      )
    : null;

  // What last night's evening log would have asked and nobody answered: the PC was off
  // at 22:00, or you only came back too late. Asked here instead, about yesterday.
  const noEvening = !past.checkins.some((c) => c.part === 'evening');
  const openGoals = past.goals.filter((g) => g.result === null);
  const openProjects = (pastProjects ?? []).filter((p) => p.status === 'active' && !answeredToday(p));
  const yesterdayOpen = noEvening || openGoals.length || openProjects.length;
  // These cards sit at the top of the left column with the rest, so a column never
  // stands empty next to a long card.
  const finishYesterday = yesterdayOpen
    ? [
        noEvening ? checkinCard(yesterday, 'evening', past.checkins, refresh, { title: 'How was yesterday?', withNote: true, notePrompt: 'What affected it, good or bad? (optional)' }) : null,
        openGoals.length ? goalsCard(yesterday, past.goals, refresh, { title: "How did yesterday's goals go?", review: true, allowAdd: false }) : null,
        openProjects.length ? eveningProjectsCard(yesterday, openProjects) : null,
      ]
    : [];

  setTopnav(null);
  return [
    h(
      'section',
      { class: 'card hero dawn', style: { marginBottom: '16px' } },
      h('h1', {}, greeting),
      h('p', {}, `${longDate(key)}. Here's how yesterday went, and room to plan today.`),
    ),
    yesterdayOpen
      ? h('div', { class: 'callout', style: { marginBottom: '16px' } }, `Last night's log is still open. A minute on ${longDate(yesterday)} while you remember it (on the left):`)
      : null,
    new Date(parseDay(key)).getDay() === 1
      ? h('div', { class: 'callout', style: { marginBottom: '16px' } }, 'A new week. ', h('a', { href: `#week/${shiftDay(key, -7)}` }, 'Look back on last week'), ' before you plan this one.')
      : null,
    h(
      'div',
      { class: 'grid cols-2' },
      h('div', { class: 'stack' }, ...finishYesterday, sleepCard(day, refresh), yesterdayCard),
      h(
        'div',
        { class: 'stack' },
        checkinCard(key, 'morning', day.checkins, refresh, {
          withNote: true,
          notePrompt: "How's your mood this morning, and what's on your mind?",
        }),
        planEditor(key, day.plan, refresh, day.entryCategories, {
          title: 'Plan your day',
          note: day.plan.length ? 'Your plan for today. Change anything that’s moved since you made it.' : 'What you’ll do today, and when',
          copyFrom: { day: yesterday, count: past.plan.length, label: "yesterday's plan" },
          outcomes: day.planComparison.blocks,
        }),
        goalsCard(key, day.goals, refresh, { title: 'Your goals for today' }),
        projectsGlanceCard(key, projects, { title: 'Your projects', morning: true }),
        tasksCard(key, day.tasks, refresh, { title: "Today's tasks", note: 'What would make today a good day?' }),
        carry,
      ),
    ),
    h(
      'div',
      { class: 'footer-actions' },
      h('a', { class: 'btn', href: '#today' }, 'See today so far'),
      h('button', { class: 'btn primary big', onclick: () => closeOr('#today') }, 'Start my day'),
    ),
  ];
}

/** #back/<start>-<end>: the small window that opens when you come back to the PC. */
async function backPage(arg) {
  const match = /^(\d+)-(\d+)$/.exec(arg ?? '');
  if (!match) {
    location.hash = '#today';
    return [];
  }
  const away = { start: Number(match[1]), end: Number(match[2]) };
  const keys = [...new Set([dayKey(away.start), dayKey(away.end)])];
  const days = await Promise.all(keys.map((k) => api(`/day?date=${k}`)));
  const refresh = () => render();
  // The gaps inside the time away, a minute's slack either side.
  const open = days.flatMap((day) => day.gaps.filter((g) => g.end > away.start - 60000 && g.start < away.end + 60000).map((gap) => ({ day, gap })));
  const head = h(
    'div',
    { class: 'back-head' },
    h('h1', {}, 'Welcome back'),
    h('p', {}, `You were away ${span(away.start, away.end)} (${duration(away.end - away.start)}). What were you doing?`),
  );
  if (open.length === 0) {
    setTimeout(() => closeOr('#today'), 1500);
    return [head, card('All logged', null, h('p', { class: 'hint' }, "That's all accounted for. Closing…"))];
  }
  const categories = days[0].entryCategories;
  return [
    head,
    h('datalist', { id: 'life-labels' }, QUICK.map(([text]) => h('option', { value: text }))),
    open.map(({ day, gap }) => gapCard(day, gap, refresh, categories)),
    h(
      'div',
      { class: 'footer-actions' },
      h('a', { class: 'btn ghost', href: '#today' }, 'Open the day'),
      h('button', { class: 'btn', onclick: () => closeOr('#today') }, 'Not now'),
    ),
  ];
}

const WEEKDAY_SHORT = (key) => new Date(parseDay(key)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
const mondayOf = (key) => shiftDay(key, -((new Date(parseDay(key)).getDay() + 6) % 7));
const hhmm = (minutes) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

/** "+12m" against last week, coloured by whether more is better. */
function delta(now, before, { format = (v) => duration(Math.abs(v)), moreIsBetter = true, min = 60000 } = {}) {
  if (!now || !before) return null;
  const diff = now.value - before.value;
  if (Math.abs(diff) < min) return h('span', { class: 'delta' }, '≈ last week');
  const good = diff > 0 === moreIsBetter;
  return h('span', { class: `delta ${good ? 'up' : 'down'}`, title: 'Compared with last week' }, `${diff > 0 ? '▲' : '▼'} ${format(diff)}`);
}

async function weekPage(date) {
  const start = mondayOf(date ?? today());
  const week = await api(`/week?date=${start}`);
  const { totals: t, previous: p } = week;
  const thisWeek = start === mondayOf(today());
  const avg = (a) => (a ? duration(a.value) : '—');
  const rating = (a) => (a ? a.value.toFixed(1) : '—');

  const head = h(
    'div',
    { class: 'page-head' },
    h(
      'div',
      {},
      h('h1', {}, thisWeek ? 'This week' : 'Weekly review'),
      h('p', {}, `${new Date(parseDay(week.start)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} – ${new Date(parseDay(week.end)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`),
    ),
    h(
      'div',
      { class: 'date-nav' },
      h('a', { class: 'btn', href: `#week/${shiftDay(start, -7)}`, 'aria-label': 'Previous week' }, '‹'),
      thisWeek ? null : h('a', { class: 'btn', href: '#week' }, 'This week'),
      start < mondayOf(today()) ? h('a', { class: 'btn', href: `#week/${shiftDay(start, 7)}`, 'aria-label': 'Next week' }, '›') : null,
    ),
  );

  const stats = h(
    'div',
    { class: 'stats' },
    stat('Focused a day', avg(t.focusMs), [t.focusMs ? `over ${t.focusMs.days} day${t.focusMs.days === 1 ? '' : 's'} ` : null, delta(t.focusMs, p.focusMs)]),
    stat('Sleep a night', avg(t.sleepMs), [t.sleepMs ? `${t.sleepMs.days} night${t.sleepMs.days === 1 ? '' : 's'} known ` : 'log it on the morning page', delta(t.sleepMs, p.sleepMs, { min: 5 * 60000 })]),
    stat('Mood', t.mood ? `${rating(t.mood)} ${MOODS[Math.round(t.mood.value) - 1][0]}` : '—', [t.mood ? `${moodWord(t.mood.value)} on average ` : 'no check-ins yet', delta(t.mood, p.mood, { format: (v) => Math.abs(v).toFixed(1), min: 0.2 })]),
    stat('Energy', t.energy ? `${rating(t.energy)} / 5` : '—', delta(t.energy, p.energy, { format: (v) => Math.abs(v).toFixed(1), min: 0.2 })),
    stat('Goals met', t.goalsTotal ? `${t.goalsMet}/${t.goalsTotal}` : '—', t.goalsPartly ? `${t.goalsPartly} partly` : null),
    stat('On the phone a day', avg(t.phoneMs), t.phoneMs ? `${t.phoneMs.days} day${t.phoneMs.days === 1 ? '' : 's'} logged ` : 'log it in the evening'),
    stat('Tasks done', t.tasksTotal ? `${t.tasksDone}/${t.tasksTotal}` : '—', t.tasksTotal ? `${Math.round((t.tasksDone / t.tasksTotal) * 100)}%` : null),
  );

  const maxFocus = Math.max(1, ...week.days.map((d) => d.focusMs));
  const table = card(
    'Day by day',
    'Click a day to open it',
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'week-table' },
        h('thead', {}, h('tr', {}, ['Day', 'Sleep', 'Mood', 'Energy', 'Focused', 'Distractions', 'Phone', 'On the PC', 'Goals', 'Tasks', 'Unlogged'].map((c) => h('th', {}, c)))),
        h(
          'tbody',
          {},
          week.days.map((d) =>
            h(
              'tr',
              { class: !d.past ? 'future' : d.date === today() ? 'today' : '' },
              h('td', {}, h('a', { href: `#today/${d.date}` }, WEEKDAY_SHORT(d.date))),
              h('td', { title: d.sleep.night ? `${span(d.sleep.night.start, d.sleep.night.end)}${d.sleep.night.source === 'estimated' ? ' (estimated)' : ''}` : '' }, d.sleep.night ? `${duration(d.sleep.totalMs)}${d.sleep.night.source === 'estimated' ? ' ~' : ''}` : '—'),
              h('td', { title: moodWord(d.mood) }, d.mood ? MOODS[Math.round(d.mood) - 1][0] : '—'),
              h('td', {}, d.energy ? `${d.energy.toFixed(d.energy % 1 ? 1 : 0)}/5` : '—'),
              h('td', {}, h('span', { class: 'minibar', style: { width: `${Math.round((d.focusMs / maxFocus) * 60)}px` } }), duration(d.focusMs)),
              h('td', {}, duration(d.distractionMs)),
              h('td', {}, d.phoneMs ? duration(d.phoneMs) : '—'),
              h('td', {}, duration(d.activeMs)),
              h('td', {}, d.goalsTotal ? `${d.goalsMet}/${d.goalsTotal}` : '—'),
              h('td', {}, d.tasksTotal ? `${d.tasksDone}/${d.tasksTotal}` : '—'),
              h('td', { title: d.activeMs ? '' : 'The PC wasn’t used this day' }, d.past && d.activeMs && d.gapMs ? duration(d.gapMs) : '—'),
            ),
          ),
        ),
      ),
    ),
    h('p', { class: 'hint', style: { marginTop: '8px' } }, '~ sleep estimated from the PC; log it on the morning page to make it exact.'),
  );

  const byHour = Array.from({ length: 24 }, (_, i) => week.days.reduce((s, d) => s + (d.focusByHour[i] ?? 0), 0));
  const maxHour = Math.max(1, ...byHour);
  const heat = card(
    'When you focus',
    'Focused time by hour, all week',
    h('div', { class: 'heat' }, byHour.map((ms, i) => h('div', { title: `${pad(i)}:00–${pad(i + 1)}:00 · ${duration(ms)}`, style: ms ? { background: `color-mix(in srgb, var(--accent) ${Math.round(15 + (ms / maxHour) * 85)}%, var(--panel-2))` } : {} }))),
    h('div', { class: 'heat-axis' }, byHour.map((_, i) => h('span', {}, i % 3 === 0 ? pad(i) : ''))),
  );

  const sleepBox = card(
    'Sleep rhythm',
    null,
    t.bedtime
      ? h(
          'div',
          { class: 'stats', style: { marginBottom: 0 } },
          stat('Bedtime', hhmm(t.bedtime.minutes), t.sleepMs.days > 1 ? `±${duration(t.bedtime.spread * 60000)} night to night` : 'one night so far'),
          stat('Waking', hhmm(t.wake.minutes), t.sleepMs.days > 1 ? `±${duration(t.wake.spread * 60000)}` : null),
        )
      : h('p', { class: 'empty' }, 'No nights known yet this week.'),
  );

  const noticed = card(
    'What stood out',
    null,
    week.observations.length ? h('ul', { class: 'observations' }, week.observations.map((o) => h('li', {}, o))) : h('p', { class: 'empty' }, 'Not enough yet to say much. Check in each day and it fills up.'),
  );

  const wentWell = h('textarea', { 'aria-label': 'What went well', placeholder: 'What went well this week?' }, week.review?.wentWell ?? '');
  const toChange = h('textarea', { 'aria-label': 'What to change', placeholder: 'What will you do differently next week?' }, week.review?.toChange ?? '');
  const reflect = card(
    'Your review',
    week.review ? `Saved ${new Date(week.review.updatedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : null,
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, 'What went well'), wentWell),
      h('label', { class: 'field' }, h('span', {}, 'What to change next week'), toChange),
      h('div', { class: 'row' }, h('button', {
        class: 'btn primary',
        onclick: async () => {
          try {
            await api(`/reviews/${week.start}`, { method: 'PUT', body: { wentWell: wentWell.value, toChange: toChange.value } });
            say('Review saved');
          } catch (error) {
            handle(error);
          }
        },
      }, 'Save review')),
    ),
  );

  return [
    head,
    stats,
    h('div', { class: 'grid' }, table),
    h(
      'div',
      { class: 'grid cols-2', style: { marginTop: '16px' } },
      h('div', { class: 'stack' }, noticed, heat, reflect),
      h(
        'div',
        { class: 'stack' },
        sleepBox,
        card('Where the PC time went', null, bars(week.categories.map((c) => ({ name: c.category, ms: c.ms })), (i) => colorOf(i.name))),
        card('Biggest distractions', null, bars(week.distractions, () => colorOf('video'))),
        uncategorisedCard(week),
      ),
    ),
    weekProjectsCard(week),
  ];
}

/**
 * Sites and apps that no category rule matched, so they sit in "other" and count as
 * neither focus nor distraction. Picking a category adds them to categories.json,
 * which also re-sorts every past day.
 */
function uncategorisedCard(week) {
  const items = week.uncategorised ?? [];
  if (!items.length) return null;
  return card(
    'Not in any category',
    'Counted as neither focus nor distraction',
    h(
      'ul',
      { class: 'list' },
      items.map((item) => {
        const pick = h(
          'select',
          { 'aria-label': `Category for ${item.name}` },
          h('option', { value: '' }, 'Put in…'),
          week.screenCategories.map((c) => h('option', { value: c }, c)),
        );
        pick.addEventListener(
          'change',
          oneAtATime(async () => {
            if (!pick.value) return;
            try {
              await api('/categories', { method: 'POST', body: { category: pick.value, kind: item.kind, value: item.name } });
              say(`${item.name} now counts as ${pick.value}, on every day`);
              await render();
            } catch (error) {
              handle(error);
            }
          }),
        );
        return h(
          'li',
          {},
          h('span', { class: 'grow', title: item.kind === 'domain' ? 'Website' : 'App' }, item.name),
          h('span', { class: 'time' }, duration(item.ms)),
          pick,
        );
      }),
    ),
  );
}

/** What each project did that week: what moved, days worked, targets met. */
function weekProjectsCard(week) {
  if (!week.projects?.length) return null;
  const idle = week.projects.filter((p) => p.status === 'active' && p.moved.length === 0);
  return h(
    'div',
    { class: 'grid', style: { marginTop: '16px' } },
    card(
      'Projects this week',
      idle.length ? `${idle.length} not touched` : `${week.projects.length} project${week.projects.length === 1 ? '' : 's'}`,
      h(
        'ul',
        { class: 'list week-projects' },
        week.projects.map((p) => {
          const color = projectColor(p);
          const bits = [`${p.daysWorked} day${p.daysWorked === 1 ? '' : 's'} worked`];
          if (p.pcMs) bits.push(`${duration(p.pcMs)} on the PC`);
          if (p.targetDays) bits.push(`targets met ${p.targetsMet} of ${p.targetDays}`);
          if (p.daysSkipped) bits.push(`${p.daysSkipped} “nothing today”`);
          return h(
            'li',
            {},
            h('i', { class: 'dot', style: { background: color } }),
            h(
              'div',
              { class: 'grow' },
              h('div', { class: 'wp-head' }, h('a', { href: `#projects/${p.id}`, dir: 'auto' }, p.name), p.status !== 'active' ? h('span', { class: 'badge' }, p.status === 'paused' ? 'Paused' : 'Finished') : null, h('span', { class: 'hint' }, bits.join(' · '))),
              p.moved.length
                ? h('div', { class: 'chips', style: { marginTop: '6px' } }, p.moved.map((m) => h('span', { class: 'chip static', dir: 'auto' }, m.checkbox ? `✓ ${m.title}` : `${m.amount > 0 ? '+' : ''}${amountText(m.amount, m.unit)} · ${m.title}`)))
                : h('p', { class: `hint${p.status === 'active' ? ' wp-idle' : ''}`, style: { marginTop: '4px' } }, p.status === 'active' ? 'Nothing moved this week.' : 'Nothing moved.'),
            ),
            progressBar(p.fraction, color, `${p.name}: ${pct(p.fraction)} done`, 'mini'),
            h('span', { class: 'num pc-count' }, pct(p.fraction)),
          );
        }),
      ),
    ),
  );
}

const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function describeSchedule(s) {
  const days =
    s.days.length === 0 || s.days.length === 7
      ? 'every day'
      : s.days.join() === '1,2,3,4,5'
        ? 'weekdays'
        : s.days.map((d) => DAY_FULL[d]).join(', ');
  if (s.type === 'at') return `At ${s.times.join(', ')} · ${days}`;
  const every = s.minutes % 60 === 0 ? (s.minutes === 60 ? 'hour' : `${s.minutes / 60} hours`) : s.minutes === 1 ? 'minute' : `${s.minutes} minutes`;
  const window = s.from === '00:00' && s.until === '24:00' ? '' : `, ${s.from}–${s.until}`;
  return `Every ${every}${window} · ${days}`;
}

/** existing: a saved reminder to edit, or a preset to start a new one from, or null. */
function reminderForm(existing, onDone) {
  const editing = Boolean(existing && existing.id);
  const state = existing
    ? structuredClone({ text: existing.text, schedule: existing.schedule })
    : { text: '', schedule: { type: 'every', minutes: 60, from: '09:00', until: '22:00', days: [] } };
  const s = state.schedule;
  if (s.type === 'every') s.times ??= ['09:00'];
  const box = h('div', { class: 'form-grid' });

  const draw = () => {
    box.replaceChildren();
    const text = h('input', { type: 'text', value: state.text, placeholder: 'Take your medicine', 'aria-label': 'Reminder text', oninput: (e) => (state.text = e.target.value) });
    const kind = h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Kind of schedule' },
      h('button', { type: 'button', class: s.type === 'every' ? 'on' : '', onclick: () => { s.type = 'every'; s.minutes ??= 60; s.from ??= '09:00'; s.until ??= '22:00'; draw(); } }, 'Repeat every…'),
      h('button', { type: 'button', class: s.type === 'at' ? 'on' : '', onclick: () => { s.type = 'at'; s.times ??= ['09:00']; draw(); } }, 'At set times'),
    );
    let detail;
    if (s.type === 'every') {
      const hours = s.minutes % 60 === 0;
      const amount = h('input', { type: 'number', min: 1, value: hours ? s.minutes / 60 : s.minutes, style: { width: '80px' }, 'aria-label': 'How often' });
      const unit = h('select', { 'aria-label': 'Unit' }, h('option', { value: '1' }, 'minutes'), h('option', { value: '60' }, 'hours'));
      unit.value = hours ? '60' : '1';
      const sync = () => (s.minutes = Math.round(Number(amount.value) * Number(unit.value)));
      amount.addEventListener('input', sync);
      unit.addEventListener('change', sync);
      const from = h('input', { type: 'time', value: s.from, oninput: (e) => (s.from = e.target.value), 'aria-label': 'From' });
      const until = h('input', { type: 'time', value: s.until === '24:00' ? '23:59' : s.until, oninput: (e) => (s.until = e.target.value === '23:59' ? '24:00' : e.target.value), 'aria-label': 'Until' });
      detail = h('div', { class: 'row' }, 'Every', amount, unit, 'between', from, 'and', until);
    } else {
      const list = s.times.map((t, i) =>
        h('span', { class: 'row', style: { gap: '2px' } },
          h('input', { type: 'time', value: t, oninput: (e) => (s.times[i] = e.target.value), 'aria-label': `Time ${i + 1}` }),
          s.times.length > 1 ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove time', onclick: () => { s.times.splice(i, 1); draw(); } }, '×') : null,
        ),
      );
      detail = h('div', { class: 'row' }, list, h('button', { class: 'btn', type: 'button', onclick: () => { s.times.push('12:00'); draw(); } }, '+ time'));
    }
    const days = h(
      'div',
      { class: 'days', role: 'group', 'aria-label': 'Days' },
      DAY_NAMES.map((name, d) =>
        h('button', {
          type: 'button',
          class: s.days.length === 0 || s.days.includes(d) ? 'on' : '',
          title: DAY_FULL[d],
          'aria-pressed': String(s.days.length === 0 || s.days.includes(d)),
          onclick: () => {
            const set = new Set(s.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : s.days);
            if (set.has(d)) set.delete(d);
            else set.add(d);
            s.days = set.size === 7 ? [] : [...set].sort();
            if (set.size === 0) s.days = [d === 0 ? 1 : 0]; // Never no days at all.
            draw();
          },
        }, name),
      ),
    );
    const save = oneAtATime(async () => {
      if (!state.text.trim()) {
        say('Write what to remind you of', true);
        return;
      }
      const schedule = s.type === 'every'
        ? { type: 'every', minutes: s.minutes, from: s.from, until: s.until, days: s.days }
        : { type: 'at', times: s.times, days: s.days };
      try {
        if (editing) await api(`/reminders/${existing.id}`, { method: 'PATCH', body: { text: state.text.trim(), schedule } });
        else await api('/reminders', { method: 'POST', body: { text: state.text.trim(), schedule } });
        say(editing ? 'Reminder saved' : 'Reminder added');
        onDone();
      } catch (error) {
        handle(error);
      }
    });
    box.append(
      h('label', { class: 'field' }, h('span', {}, 'Remind me to'), text),
      h('div', { class: 'field' }, h('span', {}, 'When'), kind, detail),
      h('div', { class: 'field' }, h('span', {}, 'On'), days),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, editing ? 'Save' : 'Add reminder'), h('button', { class: 'btn ghost', onclick: onDone }, 'Cancel')),
    );
    if (!editing && !state.text) text.focus();
  };
  draw();
  return box;
}

const PRESETS = [
  { text: 'Take your medicine', schedule: { type: 'at', times: ['09:00', '21:00'], days: [] } },
  { text: 'Drink some water', schedule: { type: 'every', minutes: 60, from: '09:00', until: '23:00', days: [] } },
  { text: 'Stand up and stretch', schedule: { type: 'every', minutes: 45, from: '09:00', until: '22:00', days: [] } },
  { text: 'Rest your eyes: look 6 m away for 20 s', schedule: { type: 'every', minutes: 20, from: '09:00', until: '23:00', days: [] } },
];

async function remindersPage() {
  const reminders = await api('/reminders');
  const formSlot = h('div');
  const openForm = (existing) => {
    formSlot.replaceChildren(card(existing?.id ? 'Edit reminder' : 'New reminder', null, reminderForm(existing, () => render())));
    formSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const list = reminders.length
    ? h(
        'div',
        { class: 'stack' },
        reminders.map((r) =>
          h(
            'section',
            { class: `card reminder${r.enabled ? '' : ' off'}` },
            h('span', { class: 'ic-box' }, icon(/medic|pill|دواء/i.test(r.text) ? 'pill' : /water|drink|ماء/i.test(r.text) ? 'drop' : 'reminders')),
            h(
              'div',
              {},
              h('div', { class: 'what', dir: 'auto' }, r.text),
              h('div', { class: 'when' }, describeSchedule(r.schedule)),
              h('div', { class: 'next' }, r.enabled ? (r.next ? `Next at ${dayKey(r.next) === today() ? clock(r.next) : `${new Date(r.next).toLocaleDateString('en-GB', { weekday: 'short' })} ${clock(r.next)}`}` : 'Nothing more today') : 'Off'),
            ),
            h(
              'div',
              { class: 'row' },
              h('button', { class: 'btn ghost sm', onclick: async () => { try { await api(`/reminders/${r.id}/test`, { method: 'POST' }); say('Sent: look for the notification'); } catch (error) { handle(error); } } }, 'Test'),
              h('button', { class: 'btn ghost sm', onclick: () => openForm(r) }, 'Edit'),
              h('button', {
                class: 'btn ghost sm danger',
                onclick: async () => {
                  if (!confirm(`Delete the reminder "${r.text}"?`)) return;
                  try {
                    await api(`/reminders/${r.id}`, { method: 'DELETE' });
                    await render();
                  } catch (error) {
                    handle(error);
                  }
                },
              }, 'Delete'),
            ),
            h('label', { class: 'switch', title: r.enabled ? 'On' : 'Off' },
              h('input', {
                type: 'checkbox',
                checked: r.enabled,
                'aria-label': `${r.text}: ${r.enabled ? 'on' : 'off'}`,
                onchange: async (e) => {
                  try {
                    await api(`/reminders/${r.id}`, { method: 'PATCH', body: { enabled: e.target.checked } });
                    await render();
                  } catch (error) {
                    handle(error);
                  }
                },
              }),
              h('span', { class: 'knob' }),
            ),
          ),
        ),
      )
    : card('No reminders yet', null, h('p', { class: 'hint' }, 'Start from one of these, or add your own.'));

  const presets = h(
    'div',
    { class: 'chips', style: { marginTop: '8px' } },
    PRESETS.map((p) => h('button', { class: 'chip', onclick: () => openForm(structuredClone(p)) }, p.text)),
  );

  return [
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Reminders'), h('p', {}, 'رقيب pings you with a notification. Snooze it, or press Done.')), h('button', { class: 'btn primary', onclick: () => openForm(null) }, icon('plus'), 'New reminder')),
    list,
    h('div', { style: { margin: '16px 0' } }, h('h3', {}, 'Quick start'), presets),
    formSlot,
  ];
}

async function settingsPage() {
  const s = await api('/settings');
  const save = async (change, message = 'Saved') => {
    try {
      await api('/settings', { method: 'PUT', body: change });
      say(message);
    } catch (error) {
      handle(error);
      await render();
    }
  };
  const toggle = (checked, label, onchange) =>
    h('label', { class: 'inline' }, h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span', { class: 'knob' })), label);
  const time = (value, onchange, label) => h('input', { type: 'time', value, 'aria-label': label, onchange: (e) => onchange(e.target.value) });

  return [
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'), h('p', {}, 'Changes apply straight away.'))),
    h(
      'section',
      { class: 'privacy' },
      h('span', { class: 'ic-box' }, icon('shield')),
      h('div', {}, h('h2', {}, 'Everything stays on this PC.'), h('p', {}, 'رقيب has no account and no server. Your day is kept in its own folder on this computer, and nothing is sent anywhere.')),
    ),
    h(
      'div',
      { class: 'stack' },
      card(
        'Morning page',
        null,
        h('p', { class: 'hint', style: { marginBottom: '12px' } }, "Opens by itself the first time you're at the PC in this window each day: yesterday's summary, then today's tasks."),
        h('div', { class: 'row' },
          toggle(s.morning.enabled, 'Open the morning page', (v) => save({ morning: { enabled: v } })),
          h('span', { class: 'hint' }, 'between'), time(s.morning.from, (v) => save({ morning: { from: v } }), 'Morning from'),
          h('span', { class: 'hint' }, 'and'), time(s.morning.until, (v) => save({ morning: { until: v } }), 'Morning until'),
        ),
        h('div', { class: 'row', style: { marginTop: '12px' } }, h('a', { class: 'btn', href: '#morning' }, 'Show it now')),
      ),
      strengthStandardsCard(),
      card(
        'Evening log',
        null,
        h('p', { class: 'hint', style: { marginBottom: '12px' } }, "A notification with your day so far, asking you to fill in the gaps. If the PC is off at that time, it comes the next time you use it that evening, until the cut-off. After that, the morning page asks about yesterday instead: how it went, your goals, and your projects."),
        h('div', { class: 'row' },
          toggle(s.evening.enabled, 'Send the evening log at', (v) => save({ evening: { enabled: v } })),
          time(s.evening.at, (v) => save({ evening: { at: v } }), 'Evening time'),
        ),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          h('span', {}, 'Not after'),
          time(s.evening.lateAfter ?? '23:00', (v) => save({ evening: { lateAfter: v } }), 'Evening cut-off'),
          h('span', { class: 'hint' }, 'later than this, it waits for the morning'),
        ),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          h('button', { class: 'btn', onclick: async () => { try { await api('/evening/test', { method: 'POST' }); say('Sent: look for the notification'); } catch (error) { handle(error); } } }, 'Send it now'),
        ),
      ),
      card(
        'Projects',
        null,
        h('p', { class: 'hint', style: { marginBottom: '12px' } }, 'The evening log always asks what you did on each active project. Switch this on for a separate reminder on days you skip it: it only comes when a project is still unanswered, and not after the evening log has gone out.'),
        h('div', { class: 'row' },
          toggle(s.projects.reminder.enabled, 'Remind me about my projects at', (v) => save({ projects: { reminder: { enabled: v } } })),
          time(s.projects.reminder.at, (v) => save({ projects: { reminder: { at: v } } }), 'Project reminder time'),
        ),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          h('span', {}, 'Flag a project after'),
          h('input', { type: 'number', min: 1, max: 60, value: s.projects.neglectAfterDays, style: { width: '80px' }, 'aria-label': 'Days without work', onchange: (e) => save({ projects: { neglectAfterDays: Number(e.target.value) } }) }),
          h('span', {}, 'days without work'),
        ),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          h('button', { class: 'btn', onclick: async () => { try { const r = await api('/projects/reminder/test', { method: 'POST' }); say(r.sent ? 'Sent: look for the notification' : 'Nothing to ask: every active project is answered for today'); } catch (error) { handle(error); } } }, 'Send it now'),
          h('a', { class: 'btn ghost', href: '#projects' }, 'Your projects'),
        ),
      ),
      card(
        'Job hours',
        null,
        h('p', { class: 'hint', style: { marginBottom: '12px' } }, "Shaded on the day's timeline, so you can see your working hours against everything else."),
        h('div', { class: 'row' },
          toggle(s.job.enabled, 'Highlight my job from', (v) => save({ job: { enabled: v } })),
          time(s.job.from, (v) => save({ job: { from: v } }), 'Job starts'),
          h('span', { class: 'hint' }, 'to'), time(s.job.until, (v) => save({ job: { until: v } }), 'Job ends'),
        ),
        (() => {
          let picked = s.job.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : [...s.job.days];
          const box = h('div', { class: 'days', role: 'group', 'aria-label': 'Job days' });
          const draw = () =>
            box.replaceChildren(
              ...DAY_NAMES.map((name, d) =>
                h('button', {
                  type: 'button', class: picked.includes(d) ? 'on' : '', title: DAY_FULL[d], 'aria-pressed': String(picked.includes(d)),
                  onclick: () => {
                    const next = picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d].sort();
                    if (next.length === 0) return; // Never no days at all.
                    picked = next;
                    draw();
                    save({ job: { days: picked.length === 7 ? [] : picked } });
                  },
                }, name),
              ),
            );
          draw();
          return h('div', { class: 'row', style: { marginTop: '12px' } }, h('span', {}, 'On'), box);
        })(),
      ),
      card(
        'Gaps',
        null,
        h('div', { class: 'row' },
          h('span', {}, 'Ask about stretches without PC use of at least'),
          h('input', { type: 'number', min: 1, max: 240, value: s.gaps.minMinutes, style: { width: '80px' }, 'aria-label': 'Minutes', onchange: (e) => save({ gaps: { minMinutes: Number(e.target.value) } }) }),
          h('span', {}, 'minutes'),
        ),
      ),
      card(
        'When you come back',
        null,
        h('p', { class: 'hint', style: { marginBottom: '12px' } }, "When you return to the PC after a gap, رقيب asks what you were doing while it's fresh. A gap counts after the shortest gap above if the screen was locked or the PC asleep or off, or after 45 minutes if it was left on (you may have been reading). Skipped when you've already logged it, and when the morning page or evening log opens instead."),
        h(
          'div',
          { class: 'seg', role: 'group', 'aria-label': 'How to ask' },
          [['window', 'Open a small window'], ['toast', 'Show a notification'], ['off', "Don't ask"]].map(([mode, label]) =>
            h('button', { type: 'button', class: s.back.mode === mode ? 'on' : '', onclick: async () => { await save({ back: { mode } }); await render(); } }, label),
          ),
        ),
      ),
      card(
        'Multitasking',
        null,
        h('p', { class: 'hint', style: { marginBottom: '12px' } }, "Records which apps are playing sound (music, podcasts, videos, calls) alongside what's in front, so the day shows when you worked while listening. The same exclusions as for windows apply, and nothing is recorded while locked or paused. For Chrome tabs, update the extension so it can say which tab is playing."),
        toggle(s.audio.enabled, 'Record background sound', (v) => save({ audio: { enabled: v } })),
      ),
      card(
        'Other screens',
        null,
        h('p', { class: 'hint', style: { marginBottom: '12px' } }, "With more than one monitor, records the window on top of each screen you aren't typing on, so the day shows the notes or video you kept up beside your work. It doesn't count toward active time. The same exclusions as for windows apply, and nothing is recorded while locked or paused. Chrome windows are named only once the extension is updated, since private windows can't be told apart otherwise."),
        s.screens ? toggle(s.screens.enabled, 'Record what is on the other screens', (v) => save({ screens: { enabled: v } })) : null,
      ),
    ),
  ];
}

// ------------------------------------------------------------------ projects

// Colours a project can take: the category hues, readable in light and dark.
const PROJECT_COLORS = ['#0f766e', '#2f6bd8', '#6b4fc8', '#c23b78', '#c8402f', '#b8650f', '#5b7a99'];
const projectColor = (p) => p.color ?? 'var(--accent)';
const amountText = (n, unit) => (unit ? `${n} ${unit}` : String(n));
const pct = (f) => `${Math.round(f * 100)}%`;
const daysFrom = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86_400_000);
const shortDay = (key) => new Date(parseDay(key)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const answeredToday = (p) => Boolean(p.today?.note || p.today?.skipped || p.subtasks.some((s) => s.doneToday !== 0));
const planText = (s) => (s.plan.ahead === 0 ? 'on plan' : s.plan.ahead > 0 ? `${amountText(s.plan.ahead, s.unit)} ahead of plan` : `${amountText(-s.plan.ahead, s.unit)} behind plan`);
// Which tab each project was last showing, so redraws keep it and a new one starts on its sub-tasks.
const projectTabs = new Map();

function dueText(due, key) {
  const d = daysFrom(key, due);
  if (d < 0) return `was due ${shortDay(due)}`;
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  return `due ${shortDay(due)} · ${d} days left`;
}

function workedText(p, key) {
  if (!p.lastWorked) return 'not worked on yet';
  const d = daysFrom(p.lastWorked, key);
  return d <= 0 ? 'worked on today' : d === 1 ? 'worked on yesterday' : `last worked ${d} days ago`;
}

function progressBar(fraction, color, label, cls = '') {
  const value = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return h(
    'div',
    { class: `pbar ${cls}`, role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': value },
    h('div', { class: 'pfill', style: { width: `${value}%`, background: color } }),
  );
}

/** Runs a change, then redraws the page; errors go to the snackbar. */
async function act(change) {
  try {
    await change();
    await render();
  } catch (error) {
    handle(error);
  }
}

const subtaskSummary = (s) => (s.total === null ? (s.done >= 1 ? 'Done' : 'Not done') : `${s.done} / ${amountText(s.total, s.unit)}`);

function colorPicker(current, onPick) {
  const box = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' });
  const draw = (selected) =>
    box.replaceChildren(
      ...PROJECT_COLORS.map((c) =>
        h('button', {
          type: 'button',
          class: `swatch${c === selected ? ' on' : ''}`,
          style: { background: c },
          role: 'radio',
          'aria-checked': c === selected ? 'true' : 'false',
          'aria-label': `Colour ${c}`,
          onclick: () => {
            draw(c);
            onPick(c);
          },
        }),
      ),
    );
  draw(current);
  return box;
}

// The list ---------------------------------------------------------------------

function projectCard(p, key) {
  const color = projectColor(p);
  const targets = p.subtasks.filter((s) => s.todayTarget !== null);
  return h(
    'a',
    { class: `card project-card${p.status === 'active' ? '' : ' muted'}`, href: `#projects/${p.id}` },
    h(
      'div',
      { class: 'pc-head' },
      h('i', { class: 'dot', style: { background: color } }),
      h('h2', { dir: 'auto', class: 'grow' }, p.name),
      p.status !== 'active' ? h('span', { class: 'badge' }, p.status === 'paused' ? 'Paused' : 'Finished') : null,
      h('span', { class: 'pc-pct num' }, pct(p.fraction)),
    ),
    progressBar(p.fraction, color, `${p.name}: ${pct(p.fraction)} done`),
    h(
      'p',
      { class: 'pc-meta' },
      [p.due ? dueText(p.due, key) : null, workedText(p, key), p.match?.length ? `${duration(p.pcMs ?? 0)} on the PC` : null, p.status === 'active' ? (answeredToday(p) ? 'today answered' : 'today not answered yet') : null].filter(Boolean).join(' · '),
    ),
    p.neglectedDays !== null ? h('p', { class: 'pc-warn' }, `Not touched in ${p.neglectedDays} days`) : null,
    p.subtasks.length
      ? h(
          'ul',
          { class: 'pc-subs' },
          p.subtasks.slice(0, 6).map((s) =>
            h(
              'li',
              {},
              h('span', { class: 'grow', dir: 'auto' }, s.title),
              s.total === null ? h('span', { class: `tick${s.done >= 1 ? ' on' : ''}`, 'aria-label': s.done >= 1 ? 'done' : 'not done' }, s.done >= 1 ? '✓' : '') : progressBar(s.fraction, color, s.title, 'mini'),
              h('span', { class: 'num pc-count' }, s.total === null ? '' : `${s.done}/${s.total}`),
            ),
          ),
          p.subtasks.length > 6 ? h('li', { class: 'hint' }, `and ${p.subtasks.length - 6} more`) : null,
        )
      : h('p', { class: 'hint' }, 'No sub-tasks yet.'),
    targets.length
      ? h(
          'div',
          { class: 'chips pc-targets' },
          targets.map((s) => {
            const met = (s.total === null ? s.done : s.doneToday) >= s.todayTarget;
            return h('span', { class: `chip static${met ? ' on' : ''}` }, `Today: ${s.total === null ? s.title : `${Math.max(0, s.doneToday)} of ${amountText(s.todayTarget, s.unit)}`}`);
          }),
        )
      : null,
  );
}

function newProjectForm(onCancel) {
  const name = h('input', { type: 'text', dir: 'auto', placeholder: 'Anatomy exam, side project, a book…', 'aria-label': 'Project name', maxlength: 100 });
  const due = h('input', { type: 'date', 'aria-label': 'Deadline' });
  let color = PROJECT_COLORS[0];
  const save = oneAtATime(() =>
    act(async () => {
      if (!name.value.trim()) throw new Error('Give the project a name');
      const made = await api('/projects', { method: 'POST', body: { name: name.value, due: due.value || null, color } });
      location.hash = `#projects/${made.id}`;
    }));
  name.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  setTimeout(() => name.focus(), 0);
  return card(
    'New project',
    null,
    h(
      'div',
      { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h(
        'div',
        { class: 'row', style: { gap: '24px', alignItems: 'flex-end' } },
        h('label', { class: 'field' }, h('span', {}, 'Deadline (optional)'), due),
        h('div', { class: 'field' }, h('span', {}, 'Colour'), colorPicker(color, (c) => (color = c))),
      ),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Create'), h('button', { class: 'btn ghost', onclick: onCancel }, 'Cancel')),
      h('p', { class: 'hint' }, 'Tip: ask Claude to plan it. Say what it is, the deadline, and how much there is (slides, pages, chapters), and it sets up the sub-tasks and daily targets for you.'),
    ),
  );
}

async function projectsPage(arg) {
  if (arg && /^\d+$/.test(arg)) return projectPage(Number(arg));
  const { today: key, projects } = await api('/projects');
  const active = projects.filter((p) => p.status === 'active');
  const paused = projects.filter((p) => p.status === 'paused');
  const done = projects.filter((p) => p.status === 'done');
  const formSlot = h('div', { class: 'form-slot' });
  const closeForm = () => formSlot.replaceChildren();
  const openForm = () => formSlot.replaceChildren(newProjectForm(closeForm));
  const neglected = active.filter((p) => p.neglectedDays !== null);

  const head = h(
    'div',
    { class: 'page-head' },
    h(
      'div',
      {},
      h('h1', {}, 'Projects'),
      h('p', {}, active.length ? `${active.length} active · ${active.filter(answeredToday).length} of ${active.length} answered today` : 'The longer things you’re working on, step by step.'),
    ),
    h('button', { class: 'btn primary', onclick: openForm }, icon('plus'), 'New project'),
  );

  if (projects.length === 0) {
    return [
      head,
      formSlot,
      card(
        'No projects yet',
        null,
        h('p', { class: 'hint' }, 'A project is something that runs for weeks: an exam, a side project, a tournament. Split it into sub-tasks, measured (“120 slides”) or done-or-not (“Book the venue”), and track what you do on it each day.'),
        h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn soft', onclick: openForm }, icon('plus'), 'Start a project')),
      ),
    ];
  }

  const grid = (list) => h('div', { class: 'project-grid' }, list.map((p) => projectCard(p, key)));
  return [
    head,
    formSlot,
    neglected.length
      ? h(
          'div',
          { class: 'callout', style: { marginBottom: '16px' } },
          'Not touched lately: ',
          neglected.flatMap((p, i) => [i ? ', ' : '', h('a', { href: `#projects/${p.id}`, dir: 'auto' }, p.name), ` (${p.neglectedDays} days)`]),
          '. Pause one if it’s on hold for now.',
        )
      : null,
    active.length ? grid(active) : h('p', { class: 'empty' }, 'No active projects.'),
    paused.length ? [h('h3', { class: 'section-title' }, 'Paused'), grid(paused)] : null,
    done.length ? h('details', { class: 'finished' }, h('summary', {}, `Finished (${done.length})`), grid(done)) : null,
  ];
}

// One project --------------------------------------------------------------------

function subtaskEditor(s) {
  const title = h('input', { type: 'text', dir: 'auto', value: s.title, 'aria-label': 'Title', maxlength: 200 });
  const total = h('input', { type: 'number', min: 1, value: s.total ?? '', placeholder: 'How many', 'aria-label': 'How many (empty for a checkbox)', style: { width: '110px' } });
  const unit = h('input', { type: 'text', value: s.unit ?? '', placeholder: 'slides', 'aria-label': 'Unit', style: { width: '110px' }, maxlength: 30 });
  const due = h('input', { type: 'date', value: s.due ?? '', 'aria-label': 'Due date' });
  const save = () =>
    act(() =>
      api(`/subtasks/${s.id}`, {
        method: 'PATCH',
        body: { title: title.value, total: total.value ? Number(total.value) : null, unit: total.value ? unit.value || null : null, due: due.value || null },
      }),
    );
  return h(
    'li',
    { class: 'sub-edit' },
    h('div', { class: 'row' }, title, total, unit, due),
    h('div', { class: 'row' }, h('button', { class: 'btn primary sm', onclick: save }, 'Save'), h('button', { class: 'btn ghost sm', onclick: () => render() }, 'Cancel')),
  );
}

/** Element.append writes null as text; h() skips it, and so does this. */
const append = (el, ...children) => el.append(...children.filter((c) => c !== null && c !== undefined && c !== false));

function subtaskRow(s, p, key) {
  const color = projectColor(p);
  const row = h('li', { class: 'sub-row' });
  const remove = () => {
    if (!confirm(`Delete "${s.title}" with its progress and plan? This can't be undone.`)) return;
    act(() => api(`/subtasks/${s.id}`, { method: 'DELETE' }));
  };
  const tools = h(
    'div',
    { class: 'row sub-tools' },
    h('button', { class: 'btn ghost sm', onclick: () => row.replaceWith(subtaskEditor(s)) }, 'Edit'),
    h('button', { class: 'icon-btn', title: 'Delete sub-task', 'aria-label': `Delete ${s.title}`, onclick: remove }, '×'),
  );
  const notes = [];
  if (s.due) notes.push(dueText(s.due, key));
  if (s.total !== null && s.remaining > 0 && s.pace?.perDay) notes.push(`about ${amountText(s.pace.perDay, s.unit)} a day to make it`);
  if (s.plan) notes.push(planText(s));
  const notesLine = notes.length ? h('div', { class: 'sub-notes' }, notes.join(' · ')) : null;

  if (s.total === null) {
    append(
      row,
      h('input', {
        type: 'checkbox',
        checked: s.done >= 1,
        'aria-label': `Done: ${s.title}`,
        onchange: (e) => act(() => api(`/subtasks/${s.id}`, { method: 'PATCH', body: { done: e.target.checked, day: key } })),
      }),
      h('div', { class: 'grow' }, h('div', { class: `sub-title${s.done >= 1 ? ' done' : ''}`, dir: 'auto' }, s.title), notesLine),
      s.todayTarget !== null && s.done < 1 ? h('span', { class: 'badge accent' }, 'planned today') : null,
      tools,
    );
    return row;
  }

  const input = h('input', { type: 'number', min: 0, value: s.doneToday > 0 ? s.doneToday : '', placeholder: '0', 'aria-label': `${s.title}: how many today` });
  const saveToday = () => {
    const n = input.value === '' ? 0 : Number(input.value);
    if (!Number.isInteger(n) || n < 0) return say('Give a whole number', true);
    if (n === Math.max(0, s.doneToday)) return;
    act(() => api(`/subtasks/${s.id}/progress`, { method: 'PUT', body: { day: key, amount: n } }));
  };
  input.addEventListener('change', saveToday);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  append(
    row,
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 'sub-line' }, h('span', { class: 'sub-title', dir: 'auto' }, s.title), h('span', { class: 'num sub-count' }, subtaskSummary(s))),
      progressBar(s.fraction, color, `${s.title}: ${subtaskSummary(s)}`),
      notesLine,
    ),
    h(
      'label',
      { class: 'today-box', title: 'How many you did today' },
      h('span', { class: 'lbl' }, 'Today'),
      input,
      s.todayTarget !== null ? h('span', { class: 'target num' }, `of ${s.todayTarget}`) : null,
    ),
    tools,
  );
  return row;
}

function addSubtaskForm(p) {
  const title = h('input', { type: 'text', dir: 'auto', placeholder: 'Lecture slides, past papers, book the venue…', 'aria-label': 'New sub-task', maxlength: 200 });
  const total = h('input', { type: 'number', min: 1, placeholder: 'How many', 'aria-label': 'How many (leave empty for a checkbox)', style: { width: '110px' } });
  const unit = h('input', { type: 'text', placeholder: 'slides', 'aria-label': 'Unit', style: { width: '110px' }, maxlength: 30 });
  const due = h('input', { type: 'date', 'aria-label': 'Due date (optional)' });
  const add = oneAtATime(() =>
    act(async () => {
      if (!title.value.trim()) throw new Error('Give the sub-task a title');
      await api(`/projects/${p.id}/subtasks`, {
        method: 'POST',
        body: { title: title.value, total: total.value ? Number(total.value) : null, unit: total.value ? unit.value || null : null, due: due.value || null },
      });
    }));
  for (const input of [title, total, unit]) input.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  return h(
    'div',
    { class: 'add-sub' },
    h('div', { class: 'row' }, h('div', { class: 'grow-input' }, title), total, unit, due, h('button', { class: 'btn primary', onclick: add }, 'Add')),
    h('p', { class: 'hint' }, 'Give how many (120 slides, 300 pages) for a progress bar, or leave it empty for something that’s just done or not.'),
  );
}

function todayNoteCard(p, key) {
  const note = h('textarea', { dir: 'auto', placeholder: 'What did you do on it today?', 'aria-label': 'What you did today', maxlength: 1000 });
  note.value = p.today?.note ?? '';
  const skipped = Boolean(p.today?.skipped);
  return card(
    'Today',
    skipped ? 'Nothing today' : p.today?.note ? 'Saved' : 'Not answered yet',
    note,
    h(
      'div',
      { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn primary sm', onclick: () => act(() => api(`/projects/${p.id}/days/${key}`, { method: 'PUT', body: { note: note.value } })) }, 'Save'),
      h(
        'button',
        { class: `btn sm${skipped ? ' soft' : ''}`, onclick: () => act(() => api(`/projects/${p.id}/days/${key}`, { method: 'PUT', body: { note: null, skipped: !skipped } })) },
        skipped ? 'Undo “nothing today”' : 'Nothing today',
      ),
    ),
  );
}

function planTab(p, key) {
  const marks = { met: '✓', partly: '~', missed: '✗', pending: '' };
  const words = { met: 'Met', partly: 'Partly', missed: 'Missed', pending: 'To do' };
  const planned = p.subtasks.filter((s) => s.plan);
  const cards = p.subtasks.map((s) => {
    const days = s.plan?.days ?? [];
    const past = days.filter((d) => d.day < key);
    const shown = [...past.slice(-7), ...days.filter((d) => d.day >= key)];
    const day = h('input', { type: 'date', min: key, 'aria-label': `Day to plan for ${s.title}` });
    const amount = h('input', { type: 'number', min: 1, value: s.total === null ? 1 : '', placeholder: s.unit ?? 'how many', 'aria-label': 'How many', style: { width: '100px' }, disabled: s.total === null });
    const addDay = () =>
      act(async () => {
        if (!day.value) throw new Error('Pick a day');
        const n = Number(amount.value);
        if (!Number.isInteger(n) || n < 1) throw new Error('Give how many to do that day');
        await api(`/subtasks/${s.id}/targets/${day.value}`, { method: 'PUT', body: { amount: n } });
      });
    return card(
      s.title,
      s.plan ? cap(planText(s)) : 'No plan yet',
      shown.length
        ? h(
            'table',
            { class: 'plan-table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th', {}, 'Target'), h('th', {}, 'Done'), h('th', {}, h('span', { class: 'sr' }, 'Result')))),
            h(
              'tbody',
              {},
              shown.map((d) => {
                const input = h('input', { type: 'number', min: 0, value: d.target, 'aria-label': `Target for ${shortDay(d.day)}` });
                input.addEventListener('change', () => act(() => api(`/subtasks/${s.id}/targets/${d.day}`, { method: 'PUT', body: { amount: Number(input.value) || 0 } })));
                return h(
                  'tr',
                  { class: d.day === key ? 'is-today' : '' },
                  h('td', {}, d.day === key ? 'Today' : shortDay(d.day)),
                  h('td', {}, s.total === null ? 'Do it' : input),
                  h('td', { class: 'num' }, s.total === null ? (d.done >= 1 ? 'Done' : '—') : d.done),
                  h('td', { class: `mark ${d.result}`, title: words[d.result] }, marks[d.result]),
                );
              }),
            ),
          )
        : h('p', { class: 'empty' }, 'Nothing planned for it.'),
      past.length > 7 ? h('p', { class: 'hint' }, `And ${past.length - 7} earlier day(s).`) : null,
      s.remaining > 0 ? h('div', { class: 'row', style: { marginTop: '12px' } }, day, amount, h('button', { class: 'btn sm', onclick: addDay }, 'Plan a day')) : null,
    );
  });
  return [
    planned.length === 0
      ? h('div', { class: 'callout', style: { marginBottom: '16px' } }, 'No plan yet. Plan days below, or ask Claude to “plan my ', h('span', { dir: 'auto' }, p.name), '”: it asks how much time you have and spreads the work over the days left.')
      : h('p', { class: 'hint', style: { marginBottom: '12px' } }, 'Change a target and it saves; 0 removes the day. If you fall behind, ask Claude to re-plan.'),
    p.subtasks.length ? h('div', { class: 'project-grid wide' }, cards) : h('p', { class: 'empty' }, 'Add sub-tasks first.'),
  ];
}

async function historyTab(p) {
  const days = await api(`/projects/${p.id}/history`);
  const byId = new Map(p.subtasks.map((s) => [s.id, s]));
  if (days.length === 0) return card('History', null, h('p', { class: 'empty' }, 'Nothing yet. What you do each day shows up here.'));
  return card(
    'History',
    'The last 90 days',
    h(
      'ul',
      { class: 'list history' },
      days.map((d) =>
        h(
          'li',
          {},
          h('span', { class: 'time' }, shortDay(d.day)),
          h(
            'div',
            { class: 'grow' },
            h(
              'div',
              { class: 'chips' },
              d.progress.map((x) => {
                const s = byId.get(x.subtaskId);
                const what = !s ? String(x.amount) : s.total === null ? `✓ ${s.title}` : `${x.amount > 0 ? '+' : ''}${amountText(x.amount, s.unit)} · ${s.title}`;
                return h('span', { class: 'chip static', dir: 'auto' }, what);
              }),
              d.skipped ? h('span', { class: 'chip static' }, 'Nothing today') : null,
            ),
            d.note ? h('p', { class: 'history-note', dir: 'auto' }, d.note) : null,
          ),
        ),
      ),
    ),
  );
}

/** The words that make PC time count toward a project, with today's total. */
function matchCard(p, patch) {
  const input = h('input', {
    type: 'text',
    dir: 'auto',
    value: (p.match ?? []).join(', '),
    placeholder: 'AWS Certified, aws.amazon.com, FoxitPDFReader',
    'aria-label': 'Words that count toward this project',
  });
  input.addEventListener('change', () => patch({ match: input.value }));
  input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  return card(
    'Counts automatically',
    p.match?.length ? `${duration(p.pcMs ?? 0)} on the PC today` : 'Off',
    h('p', { class: 'hint' }, 'PC time counts toward this project when a window title contains one of these, or the site, app, or editor workspace is one. Separate them with commas. Idle time never counts.'),
    h('div', { class: 'add-row' }, input),
  );
}

async function projectPage(id) {
  const key = today();
  const p = await api(`/projects/${id}?date=${key}`);
  const color = projectColor(p);
  const patch = (body) => act(() => api(`/projects/${p.id}`, { method: 'PATCH', body }));
  const rename = () => {
    const name = prompt('Rename the project', p.name);
    if (name && name.trim() && name.trim() !== p.name) patch({ name });
  };
  const remove = () => {
    if (!confirm(`Delete "${p.name}" with all its sub-tasks, progress, and plan? This can't be undone.`)) return;
    act(async () => {
      await api(`/projects/${p.id}`, { method: 'DELETE' });
      location.hash = '#projects';
    });
  };
  const due = h('input', { type: 'date', value: p.due ?? '', 'aria-label': 'Deadline' });
  due.addEventListener('change', () => patch({ due: due.value || null }));
  const statusSeg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Status' },
    [['active', 'Active'], ['paused', 'Paused'], ['done', 'Finished']].map(([value, label]) =>
      h('button', { class: p.status === value ? 'on' : '', 'aria-pressed': p.status === value ? 'true' : 'false', onclick: () => p.status !== value && patch({ status: value }) }, label),
    ),
  );
  const tab = projectTabs.get(p.id) ?? 'overview';
  const tabs = h(
    'div',
    { class: 'seg tabs', role: 'tablist', 'aria-label': 'Project view' },
    [['overview', 'Sub-tasks'], ['plan', 'Plan'], ['history', 'History']].map(([value, label]) =>
      h('button', { role: 'tab', class: tab === value ? 'on' : '', 'aria-selected': tab === value ? 'true' : 'false', onclick: () => (projectTabs.set(p.id, value), render()) }, label),
    ),
  );

  const planned = p.subtasks.filter((s) => s.plan);
  const behind = planned.filter((s) => s.plan.ahead < 0).length;
  const late = Boolean(p.due && p.projectedFinish && p.projectedFinish > p.due);

  let body;
  if (tab === 'plan') body = planTab(p, key);
  else if (tab === 'history') body = await historyTab(p);
  else
    body = h(
      'div',
      { class: 'grid cols-2' },
      card(
        'Sub-tasks',
        p.subtasks.length ? `${p.subtasks.filter((s) => s.fraction >= 1).length} of ${p.subtasks.length} finished` : null,
        p.subtasks.length ? h('ul', { class: 'list subs' }, p.subtasks.map((s) => subtaskRow(s, p, key))) : h('p', { class: 'empty' }, 'No sub-tasks yet. Add the first one below.'),
        addSubtaskForm(p),
      ),
      h('div', { class: 'stack' }, todayNoteCard(p, key), matchCard(p, patch)),
    );

  return [
    h('a', { class: 'btn ghost sm back-link', href: '#projects' }, icon('left'), 'All projects'),
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', { dir: 'auto', class: 'project-title' }, h('i', { class: 'dot', style: { background: color } }), p.name), h('p', {}, [p.due ? dueText(p.due, key) : 'no deadline', workedText(p, key)].join(' · '))),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: rename }, 'Rename'), h('button', { class: 'btn ghost sm danger', onclick: remove }, 'Delete')),
    ),
    h(
      'div',
      { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Done'), h('div', { class: 'value' }, pct(p.fraction)), progressBar(p.fraction, color, `${pct(p.fraction)} done`)),
      stat(
        'Finish at this pace',
        p.fraction >= 1 ? 'Finished' : p.projectedFinish ? shortDay(p.projectedFinish) : '—',
        p.fraction >= 1 ? null : p.projectedFinish ? (p.due ? (late ? 'after the deadline' : 'before the deadline') : 'from the last 7 days') : 'nothing done in the last week',
        late ? 'dawn' : '',
      ),
      stat('Plan', planned.length ? (behind ? `${behind} sub-task${behind === 1 ? '' : 's'} behind` : 'On track') : '—', planned.length ? `${planned.length} sub-task${planned.length === 1 ? '' : 's'} planned` : 'no plan yet', behind ? 'dawn' : ''),
      p.neglectedDays !== null
        ? stat('Not touched', `${p.neglectedDays} days`, 'pause it if it’s on hold', 'dawn')
        : stat('Last worked', p.lastWorked ? (p.lastWorked === key ? 'Today' : shortDay(p.lastWorked)) : '—'),
    ),
    h(
      'div',
      { class: 'project-controls' },
      tabs,
      h('span', { class: 'spacer' }),
      h('label', { class: 'row control' }, h('span', {}, 'Deadline'), due),
      statusSeg,
      colorPicker(p.color ?? PROJECT_COLORS[0], (c) => patch({ color: c })),
    ),
    body,
  ];
}

// Projects in the daily rhythm ----------------------------------------------------

/**
 * The evening question: what did you do on each active project today? Saves as you go
 * and updates in place (no redraw), so Tab from the count to the note keeps your place.
 */
function eveningProjectsCard(key, projects) {
  const active = projects.filter((p) => p.status === 'active');
  if (active.length === 0) return null;
  const note = h('p', {});
  const answered = new Map(active.map((p) => [p.id, answeredToday(p)]));
  const sayCount = () => {
    const n = [...answered.values()].filter(Boolean).length;
    note.textContent = n === active.length ? 'All answered' : `${n} of ${active.length} answered`;
  };
  sayCount();
  const blocks = active.map((p) =>
    eveningProjectBlock(p, key, (updated) => {
      answered.set(updated.id, answeredToday(updated));
      sayCount();
    }),
  );
  const isToday = key === today();
  return h(
    'section',
    { class: 'card evening-projects' },
    h('header', {}, h('h2', {}, isToday ? 'What did you do on your projects today?' : 'Your projects that day'), note),
    h('div', { class: 'ep-list' }, blocks),
  );
}

function eveningProjectBlock(project, key, onChange) {
  let p = project;
  const color = projectColor(p);
  const bar = progressBar(p.fraction, color, `${p.name}: ${pct(p.fraction)} done`, 'mini');
  const percent = h('span', { class: 'num ep-pct' }, pct(p.fraction));
  const status = h('span', { class: 'ep-status' });
  const skip = h('button', { class: 'btn sm' });
  const noteInput = h('input', { type: 'text', dir: 'auto', placeholder: 'What did you do on it? (optional)', 'aria-label': `${p.name}: what you did`, maxlength: 1000 });
  noteInput.value = p.today?.note ?? '';
  const counts = new Map();

  const sync = (updated) => {
    p = updated;
    const value = Math.round(p.fraction * 100);
    bar.firstChild.style.width = `${value}%`;
    bar.setAttribute('aria-valuenow', value);
    percent.textContent = pct(p.fraction);
    for (const s of p.subtasks) counts.get(s.id)?.(s);
    const worked = p.subtasks.some((s) => s.doneToday !== 0) || Boolean(p.today?.note);
    status.textContent = p.today?.skipped ? 'Nothing today' : worked ? '✓ Answered' : '';
    status.className = `ep-status${p.today?.skipped ? ' skipped' : worked ? ' done' : ''}`;
    skip.textContent = p.today?.skipped ? 'Undo' : 'Nothing today';
    skip.classList.toggle('soft', Boolean(p.today?.skipped));
    onChange(p);
  };
  const save = async (path, body, method = 'PUT') => {
    try {
      sync(await api(path, { method, body }));
    } catch (error) {
      handle(error);
    }
  };
  noteInput.addEventListener('change', () => save(`/projects/${p.id}/days/${key}`, { note: noteInput.value }));
  noteInput.addEventListener('keydown', (e) => e.key === 'Enter' && noteInput.blur());
  skip.addEventListener('click', () => {
    if (!p.today?.skipped) noteInput.value = '';
    save(`/projects/${p.id}/days/${key}`, { note: null, skipped: !p.today?.skipped });
  });

  // Sub-tasks still open, plus any you finished today: the rest needs no answer.
  const open = p.subtasks.filter((s) => s.remaining > 0 || s.doneToday !== 0);
  const rows = open.map((s) => {
    if (s.total === null) {
      const box = h('input', {
        type: 'checkbox',
        checked: s.done >= 1,
        'aria-label': `Done: ${s.title}`,
        onchange: (e) => save(`/subtasks/${s.id}`, { done: e.target.checked, day: key }, 'PATCH'),
      });
      return h('label', { class: 'ep-sub check' }, box, h('span', { class: 'grow', dir: 'auto' }, s.title), s.todayTarget !== null ? h('span', { class: 'badge accent' }, 'planned today') : null);
    }
    const count = h('span', { class: 'num ep-count' });
    const target = h('span', { class: 'num ep-target' });
    counts.set(s.id, (x) => {
      count.textContent = `${x.done} / ${amountText(x.total, x.unit)}`;
      target.textContent = x.todayTarget !== null ? `of ${x.todayTarget}` : '';
      target.classList.toggle('met', x.todayTarget !== null && x.doneToday >= x.todayTarget);
    });
    counts.get(s.id)(s);
    const input = h('input', { type: 'number', min: 0, value: s.doneToday > 0 ? s.doneToday : '', placeholder: '0', 'aria-label': `${s.title}: how many ${s.unit ?? ''} today` });
    input.addEventListener('change', () => {
      const n = input.value === '' ? 0 : Number(input.value);
      if (!Number.isInteger(n) || n < 0) return say('Give a whole number', true);
      save(`/subtasks/${s.id}/progress`, { day: key, amount: n });
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
    return h('div', { class: 'ep-sub' }, h('span', { class: 'grow', dir: 'auto' }, s.title, h('small', {}, count)), h('label', { class: 'ep-today' }, input, h('span', { class: 'unit' }, s.unit ?? ''), target));
  });

  const block = h(
    'div',
    { class: 'ep-block' },
    h('div', { class: 'ep-head' }, h('i', { class: 'dot', style: { background: color } }), h('a', { href: `#projects/${p.id}`, dir: 'auto', class: 'grow' }, p.name), status, bar, percent),
    p.neglectedDays !== null && !answeredToday(p) ? h('p', { class: 'pc-warn' }, `Not touched in ${p.neglectedDays} days`) : null,
    // The PC already knows how long you spent on it; you only say how far you got.
    project.pcMs ? h('p', { class: 'hint' }, `${duration(project.pcMs)} on it at the PC today. How far did you get?`) : null,
    rows.length ? h('div', { class: 'ep-subs' }, rows) : null,
    h('div', { class: 'ep-note' }, noteInput, skip),
  );
  sync(p);
  return block;
}

/** A short look at your projects for the morning page and Today: targets, warnings, progress. */
function projectsGlanceCard(key, projects, { title = 'Projects', morning = false } = {}) {
  const active = projects.filter((p) => p.status === 'active');
  if (active.length === 0) return null;
  const targets = active.flatMap((p) => p.subtasks.filter((s) => s.todayTarget !== null && (s.total !== null || s.done < 1)).map((s) => ({ p, s })));
  const neglected = active.filter((p) => p.neglectedDays !== null && !answeredToday(p));
  const answered = active.filter(answeredToday).length;
  return card(
    title,
    morning ? `${active.length} active` : `${answered} of ${active.length} answered today`,
    targets.length
      ? h(
          'div',
          { class: 'glance-targets' },
          h('h3', {}, morning ? "Today's targets" : 'Targets today'),
          h(
            'ul',
            { class: 'list' },
            targets.map(({ p, s }) => {
              const met = (s.total === null ? s.done : s.doneToday) >= s.todayTarget;
              return h(
                'li',
                { class: `task${met ? ' done' : ''}` },
                h('i', { class: 'dot', style: { background: projectColor(p) } }),
                h('span', { class: 'grow text', dir: 'auto' }, s.total === null ? s.title : `${amountText(s.todayTarget, s.unit)} · ${s.title}`),
                h('span', { class: 'time' }, s.total === null ? (met ? 'done' : '') : `${Math.max(0, s.doneToday)} done`),
              );
            }),
          ),
        )
      : null,
    neglected.length ? h('p', { class: 'pc-warn glance-warn' }, `Not touched lately: ${neglected.map((p) => `${p.name} (${p.neglectedDays} days)`).join(', ')}`) : null,
    h(
      'ul',
      { class: 'pc-subs glance-list' },
      active.map((p) =>
        h(
          'li',
          {},
          h('i', { class: 'dot', style: { background: projectColor(p) } }),
          h('a', { class: 'grow', href: `#projects/${p.id}`, dir: 'auto' }, p.name),
          progressBar(p.fraction, projectColor(p), `${p.name}: ${pct(p.fraction)} done`, 'mini'),
          h('span', { class: 'num pc-count' }, pct(p.fraction)),
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------------ health

const MEAL_NAMES = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };
const mealForNow = () => {
  const hour = new Date().getHours();
  return hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 22 ? 'dinner' : 'snack';
};
const round1 = (n) => Math.round(n * 10) / 10;
const kcal = (n) => `${Math.round(n).toLocaleString('en-GB')} kcal`;
const grams = (n) => `${round1(n)} g`;
const kg = (n) => `${n.toFixed(1)} kg`;
const signed = (n, unit) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(round1(n)).toFixed(1)} ${unit}`;
/** A number from an input, or null when it's empty. */
const numberOf = (input) => (input.value.trim() === '' ? null : Number(input.value));
const macros = (f) =>
  [f.calories !== null ? kcal(f.calories) : null, f.protein !== null ? `${round1(f.protein)} g protein` : null, f.carbs !== null ? `${round1(f.carbs)} g carbs` : null, f.fat !== null ? `${round1(f.fat)} g fat` : null]
    .filter(Boolean)
    .join(' · ');

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function targetSub(value, target, format) {
  if (!target) return 'set a daily target below';
  const left = target - value;
  return [progressBar(value / target, left < 0 ? 'var(--dawn)' : 'var(--accent)', 'Of the target'), left >= 0 ? `${format(left)} left of ${format(target)}` : `${format(-left)} over ${format(target)}`];
}

function healthStats(v, key) {
  const latest = v.weights.at(-1) ?? null;
  const monthAgo = v.weights.find((w) => w.day >= shiftDay(key, -30) && w.day !== latest?.day);
  const weightSub = latest
    ? [latest.day === key ? 'today' : `on ${shortDay(latest.day)}`, monthAgo ? ` · ${signed(latest.weight - monthAgo.weight, 'kg')} since ${shortDay(monthAgo.day)}` : null]
    : 'not weighed yet';
  return h(
    'div',
    { class: 'stats' },
    stat('Calories', kcal(v.totals.calories), targetSub(v.totals.calories, v.targets.calories, kcal)),
    stat('Protein', grams(v.totals.protein), targetSub(v.totals.protein, v.targets.protein, grams)),
    stat('Carbs · fat', v.foods.some((f) => f.carbs !== null || f.fat !== null) ? `${Math.round(v.totals.carbs)} · ${Math.round(v.totals.fat)} g` : '—', v.foods.length ? `${v.foods.length} thing${v.foods.length === 1 ? '' : 's'} logged` : 'nothing logged yet'),
    stat('Weight', latest ? kg(latest.weight) : '—', weightSub),
  );
}

function foodCard(v, key) {
  let meal = mealForNow();
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Meal' });
  const drawSeg = () =>
    seg.replaceChildren(
      ...Object.entries(MEAL_NAMES).map(([m, name]) => h('button', { type: 'button', class: m === meal ? 'on' : '', 'aria-pressed': String(m === meal), onclick: () => { meal = m; drawSeg(); } }, name.replace(/s$/, ''))),
    );
  drawSeg();
  const name = h('input', { type: 'text', dir: 'auto', placeholder: 'What you ate: 2 eggs and toast', 'aria-label': 'What you ate' });
  const field = (label, unit, step = 1) => h('input', { type: 'number', min: 0, step, inputmode: 'decimal', placeholder: unit, 'aria-label': label, class: 'num-in' });
  const cal = field('Calories', 'kcal');
  const protein = field('Protein in grams', 'protein g', 0.1);
  const carbs = field('Carbs in grams', 'carbs g', 0.1);
  const fat = field('Fat in grams', 'fat g', 0.1);

  const send = oneAtATime(async (food) => {
    try {
      await api('/health/foods', { method: 'POST', body: { day: key, meal, ...food } });
      say(`Logged: ${food.name}`);
      await render();
    } catch (error) {
      handle(error);
    }
  });
  const add = () => {
    if (!name.value.trim()) {
      say('Write what you ate', true);
      name.focus();
      return;
    }
    send({ name: name.value.trim(), calories: numberOf(cal), protein: numberOf(protein), carbs: numberOf(carbs), fat: numberOf(fat) });
  };
  for (const input of [name, cal, protein, carbs, fat]) input.addEventListener('keydown', (e) => e.key === 'Enter' && add());

  const recent = v.recent.length
    ? h(
        'div',
        { class: 'field', style: { marginTop: '12px' } },
        h('span', {}, 'Again'),
        h('div', { class: 'chips' }, v.recent.map((f) => h('button', { class: 'chip', dir: 'auto', title: macros(f) || 'No amounts', onclick: () => send({ name: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat }) }, icon('plus'), f.name))),
      )
    : null;

  const groups = Object.keys(MEAL_NAMES)
    .map((m) => [m, v.foods.filter((f) => f.meal === m)])
    .filter(([, list]) => list.length);
  const list = groups.length
    ? groups.map(([m, foods]) => {
        const sub = foods.reduce((s, f) => s + (f.calories ?? 0), 0);
        return h(
          'div',
          { class: 'meal-group' },
          h('div', { class: 'meal-head' }, h('h3', {}, MEAL_NAMES[m]), sub ? h('span', { class: 'time' }, kcal(sub)) : null),
          h(
            'ul',
            { class: 'list' },
            foods.map((f) =>
              h(
                'li',
                { class: 'task' },
                h('span', { class: 'grow' }, h('span', { class: 'text', dir: 'auto' }, f.name), h('div', { class: 'hint' }, macros(f) || 'no amounts')),
                h('span', { class: 'time' }, clock(f.at)),
                h('button', {
                  class: 'icon-btn',
                  title: 'Delete',
                  'aria-label': `Delete ${f.name}`,
                  onclick: async () => {
                    try {
                      await api(`/health/foods/${f.id}`, { method: 'DELETE' });
                      await render();
                    } catch (error) {
                      handle(error);
                    }
                  },
                }, '×'),
              ),
            ),
          ),
        );
      })
    : h('p', { class: 'empty' }, key === today() ? 'Nothing logged yet today.' : 'Nothing was logged this day.');

  return card(
    'Food',
    'Log what you ate. Amounts are optional: put in what you know.',
    h(
      'div',
      { class: 'form-grid', style: { gap: '10px' } },
      seg,
      name,
      h('div', { class: 'row food-amounts' }, cal, protein, carbs, fat, h('button', { class: 'btn primary', onclick: add }, icon('plus'), 'Add')),
    ),
    recent,
    h('div', { style: { marginTop: '16px' } }, list),
  );
}

function weightChart(weights) {
  if (weights.length < 2) return h('p', { class: 'empty' }, weights.length ? 'Weigh in on another day to see the trend.' : 'No weigh-ins in the last 90 days.');
  const W = 380, H = 160, L = 38, R = 8, T = 10, B = 22;
  const t = weights.map((w) => parseDay(w.day));
  const ys = weights.map((w) => w.weight);
  const t0 = t[0], t1 = t.at(-1);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const padY = Math.max(0.5, (hi - lo) * 0.15);
  lo -= padY;
  hi += padY;
  const x = (ms) => L + ((ms - t0) / (t1 - t0)) * (W - L - R);
  const y = (kgValue) => T + (1 - (kgValue - lo) / (hi - lo)) * (H - T - B);
  const points = weights.map((w, i) => `${x(t[i]).toFixed(1)},${y(w.weight).toFixed(1)}`).join(' ');
  const ticks = [hi - padY, (hi + lo) / 2, lo + padY];
  return svg(
    'svg',
    { class: 'weight-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Weight from ${kg(ys[0])} to ${kg(ys.at(-1))}` },
    ticks.map((v) => [
      svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid-line' }),
      svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-text' }, v.toFixed(1)),
    ]),
    svg('text', { x: L, y: H - 6, class: 'axis-text' }, shortDay(weights[0].day)),
    svg('text', { x: W - R, y: H - 6, 'text-anchor': 'end', class: 'axis-text' }, shortDay(weights.at(-1).day)),
    svg('polyline', { points, class: 'trend' }),
    weights.map((w, i) => svg('circle', { cx: x(t[i]), cy: y(w.weight), r: 3.5, class: 'pt' }, svg('title', {}, `${shortDay(w.day)}: ${kg(w.weight)}`))),
  );
}

function weightCard(v, key) {
  const w = v.weighIn;
  const input = (label, unit, value, step = 0.1) => h('label', { class: 'field' }, h('span', {}, label), h('input', { type: 'number', min: 0, step, inputmode: 'decimal', value: value ?? '', placeholder: unit, class: 'num-in' }));
  const weight = input('Weight (kg)', 'kg', w?.weight);
  const fatPct = input('Body fat (%)', '%', w?.bodyFat);
  const waist = input('Waist (cm)', 'cm', w?.waist, 0.5);
  const read = (label) => numberOf(label.querySelector('input'));
  const save = oneAtATime(async () => {
    const value = read(weight);
    if (!value) {
      say('Put in your weight', true);
      return;
    }
    try {
      await api(`/health/weight/${key}`, { method: 'PUT', body: { weight: value, bodyFat: read(fatPct), waist: read(waist) } });
      say('Weigh-in saved');
      await render();
    } catch (error) {
      handle(error);
    }
  });
  for (const label of [weight, fatPct, waist]) label.querySelector('input').addEventListener('keydown', (e) => e.key === 'Enter' && save());

  const recent = [...v.weights].reverse().slice(0, 6);
  return card(
    'Weight and measurements',
    key === today() ? 'One weigh-in a day. Weighing again today replaces it.' : `For ${longDate(key)}.`,
    h(
      'div',
      { class: 'row weigh-row' },
      weight,
      fatPct,
      waist,
      h('button', { class: 'btn primary', onclick: save }, icon('scale'), w ? 'Update' : 'Save'),
      w
        ? h('button', {
            class: 'btn ghost danger',
            onclick: async () => {
              if (!confirm(`Delete the weigh-in for ${longDate(key)}?`)) return;
              try {
                await api(`/health/weight/${key}`, { method: 'DELETE' });
                await render();
              } catch (error) {
                handle(error);
              }
            },
          }, 'Delete')
        : null,
    ),
    h('div', { style: { marginTop: '16px' } }, weightChart(v.weights)),
    recent.length
      ? h(
          'ul',
          { class: 'list', style: { marginTop: '8px' } },
          recent.map((r, i) => {
            const before = recent[i + 1];
            return h(
              'li',
              {},
              h('a', { class: 'grow', href: `#health/${r.day}` }, shortDay(r.day)),
              h('span', { class: 'time' }, [r.bodyFat !== null ? `${round1(r.bodyFat)}% fat` : null, r.waist !== null ? `${round1(r.waist)} cm waist` : null].filter(Boolean).join(' · ')),
              before ? h('span', { class: 'time' }, signed(r.weight - before.weight, 'kg')) : null,
              h('strong', { class: 'num' }, kg(r.weight)),
            );
          }),
        )
      : null,
  );
}

function caloriesWeekCard(v) {
  const target = v.targets.calories;
  const max = Math.max(target ?? 0, ...v.week.map((d) => d.calories), 1);
  const logged = v.week.filter((d) => d.items > 0);
  const avg = logged.length ? logged.reduce((s, d) => s + d.calories, 0) / logged.length : null;
  return card(
    'Last 7 days',
    avg !== null ? `${kcal(avg)} a day on average, over ${logged.length} day${logged.length === 1 ? '' : 's'} logged` : 'Nothing logged this week yet.',
    h(
      'div',
      { class: 'cal-week' },
      v.week.map((d) =>
        h(
          'a',
          { class: `cal-day${d.day === v.day ? ' on' : ''}`, href: `#health/${d.day}`, title: d.items ? `${shortDay(d.day)}: ${kcal(d.calories)}, ${grams(d.protein)} protein` : `${shortDay(d.day)}: nothing logged` },
          h('div', { class: 'cal-bar-box' }, target ? h('div', { class: 'cal-target', style: { bottom: `${(target / max) * 100}%` } }) : null, h('div', { class: `cal-bar${target && d.calories > target ? ' over' : ''}`, style: { height: `${(d.calories / max) * 100}%` } })),
          h('span', {}, WEEKDAY_SHORT(d.day)),
        ),
      ),
    ),
  );
}

function targetsCard(v) {
  const cal = h('input', { type: 'number', min: 1, step: 50, value: v.targets.calories ?? '', placeholder: 'e.g. 2200', class: 'num-in', 'aria-label': 'Calories a day' });
  const protein = h('input', { type: 'number', min: 1, step: 5, value: v.targets.protein ?? '', placeholder: 'e.g. 140', class: 'num-in', 'aria-label': 'Protein grams a day' });
  const save = oneAtATime(async () => {
    try {
      await api('/health/targets', { method: 'PUT', body: { calories: numberOf(cal), protein: numberOf(protein) } });
      say('Targets saved');
      await render();
    } catch (error) {
      handle(error);
    }
  });
  return card(
    'Daily targets',
    'Leave one empty to not track it.',
    h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, 'Calories'), cal), h('label', { class: 'field' }, h('span', {}, 'Protein (g)'), protein), h('button', { class: 'btn', style: { alignSelf: 'end' }, onclick: save }, 'Save')),
  );
}

// Exercise: workouts and their sets, on the Health page's second tab.

const WORKOUT_KINDS = [['strength', 'Strength'], ['run', 'Run'], ['walk', 'Walk'], ['cycle', 'Cycle'], ['swim', 'Swim'], ['sport', 'Sport'], ['other', 'Other']];
const kindName = (k) => WORKOUT_KINDS.find(([v]) => v === k)?.[1] ?? cap(k);
const n1 = (n) => String(round1(n));
const setAmount = (s) =>
  s.reps !== null ? String(s.reps) : s.seconds !== null ? (s.seconds >= 120 && s.seconds % 60 === 0 ? `${s.seconds / 60} min` : `${n1(s.seconds)} s`) : s.distance !== null ? (s.distance >= 1000 ? `${n1(s.distance / 1000)} km` : `${n1(s.distance)} m`) : '?';
const sameSet = (a, b) => a.reps === b.reps && a.weight === b.weight && a.seconds === b.seconds && a.distance === b.distance;
function setRuns(sets) {
  const out = [];
  for (const s of sets) {
    const last = out.at(-1);
    if (last && sameSet(last[1], s)) last[0]++;
    else out.push([1, s]);
  }
  return out;
}
/** "3×8 @ 60 kg, 1×6 @ 62.5 kg": the same as the command line writes them. */
const setsText = (sets) => setRuns(sets).map(([n, s]) => `${n}×${setAmount(s)}${s.weight !== null ? ` @ ${n1(s.weight)} kg` : ''}`).join(', ');
/** The short way, to log the same again: "3x8@60 6@62.5". */
const setsSpec = (sets) =>
  setRuns(sets)
    .map(([n, s]) => `${n > 1 ? `${n}x` : ''}${s.reps !== null ? s.reps : s.seconds !== null ? `${n1(s.seconds)}s` : s.distance !== null ? `${n1(s.distance)}m` : ''}${s.weight !== null ? `@${n1(s.weight)}` : ''}`)
    .join(' ');
const volumeOf = (sets) => sets.reduce((v, s) => v + (s.reps ?? 0) * (s.weight ?? 0), 0);
const kgText = (n) => `${Math.round(n).toLocaleString('en-GB')} kg`;

function exerciseStats(v) {
  const sum = (pick) => v.week.reduce((s, d) => s + pick(d), 0);
  const days = v.week.filter((d) => d.sessions > 0).length;
  const dayVolume = v.workouts.reduce((s, w) => s + volumeOf(w.sets), 0);
  return h(
    'div',
    { class: 'stats' },
    stat('Sessions', String(sum((d) => d.sessions)), `last 7 days · ${days} day${days === 1 ? '' : 's'} trained`),
    stat('Minutes', String(Math.round(sum((d) => d.minutes))), 'last 7 days'),
    stat('Volume', kgText(sum((d) => d.volume)), 'last 7 days · reps × kg'),
    stat(v.day === today() ? 'Today' : 'This day', v.workouts.length ? `${v.workouts.length} workout${v.workouts.length === 1 ? '' : 's'}` : '—', dayVolume ? `${kgText(dayVolume)} volume` : v.workouts.length ? null : 'no workout logged'),
  );
}

function newWorkoutCard(v, key) {
  let kind = 'strength';
  const seg = h('div', { class: 'seg wrap', role: 'group', 'aria-label': 'Kind of workout' });
  const drawSeg = () => seg.replaceChildren(...WORKOUT_KINDS.map(([k, name]) => h('button', { type: 'button', class: k === kind ? 'on' : '', 'aria-pressed': String(k === kind), onclick: () => { kind = k; drawSeg(); } }, name)));
  drawSeg();
  const name = h('input', { type: 'text', dir: 'auto', placeholder: 'Push day, Legs, 5 km run…', 'aria-label': 'Workout name' });
  const minutes = h('input', { type: 'number', min: 0, step: 5, placeholder: 'minutes', class: 'num-in', 'aria-label': 'Minutes' });
  const at = h('input', { type: 'time', 'aria-label': 'Started at' });
  const add = oneAtATime(async () => {
    if (!name.value.trim()) {
      say('Name the workout', true);
      name.focus();
      return;
    }
    try {
      await api('/exercise/workouts', { method: 'POST', body: { day: key, name: name.value.trim(), kind, minutes: numberOf(minutes), start: at.value ? onDay(key, at.value) : null } });
      say('Workout logged: add its exercises below');
      await render();
    } catch (error) {
      handle(error);
    }
  });
  for (const input of [name, minutes, at]) input.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  return card(
    'Log a workout',
    'Then add each exercise with its sets.',
    h('div', { class: 'form-grid', style: { gap: '10px' } }, seg, name, h('div', { class: 'row' }, minutes, h('span', { class: 'hint' }, 'started'), at, h('button', { class: 'btn primary', style: { marginLeft: 'auto' }, onclick: add }, icon('plus'), 'Add workout'))),
  );
}

function workoutCard(w, v) {
  const del = async () => {
    if (!confirm(`Delete "${w.name}" and its ${w.sets.length} set${w.sets.length === 1 ? '' : 's'}?`)) return;
    try {
      await api(`/exercise/workouts/${w.id}`, { method: 'DELETE' });
      await render();
    } catch (error) {
      handle(error);
    }
  };
  const names = [...new Set(w.sets.map((s) => s.exercise))];
  const exercises = names.length
    ? h(
        'ul',
        { class: 'list' },
        names.map((name) => {
          const sets = w.sets.filter((s) => s.exercise === name);
          return h(
            'li',
            { class: 'exercise-row' },
            h('div', { class: 'grow' }, h('div', { class: 'text', dir: 'auto' }, name), h('div', { class: 'hint' }, setsText(sets))),
            h(
              'div',
              { class: 'set-pills' },
              sets.map((s) =>
                h('button', {
                  class: 'set-pill',
                  title: 'Remove this set',
                  'aria-label': `Remove set ${s.setNo} of ${name}`,
                  onclick: async () => {
                    try {
                      await api(`/exercise/sets/${s.id}`, { method: 'DELETE' });
                      await render();
                    } catch (error) {
                      handle(error);
                    }
                  },
                }, `${setAmount(s)}${s.weight !== null ? ` @ ${n1(s.weight)}` : ''}`),
              ),
            ),
          );
        }),
      )
    : h('p', { class: 'empty' }, 'No exercises yet.');

  const exercise = h('input', { type: 'text', dir: 'auto', placeholder: 'Exercise', list: 'exercise-names', 'aria-label': 'Exercise' });
  const spec = h('input', { type: 'text', placeholder: '3x8@60', class: 'spec-in', 'aria-label': 'Sets, like 3x8@60' });
  const addSets = oneAtATime(async () => {
    if (!exercise.value.trim() || !spec.value.trim()) {
      say('Write the exercise and its sets, like 3x8@60', true);
      return;
    }
    try {
      await api(`/exercise/workouts/${w.id}/sets`, { method: 'POST', body: { exercise: exercise.value.trim(), spec: spec.value } });
      await render();
    } catch (error) {
      handle(error);
    }
  });
  for (const input of [exercise, spec]) input.addEventListener('keydown', (e) => e.key === 'Enter' && addSets());
  const fill = (name) => {
    exercise.value = name;
    const last = v.history.find((x) => x.exercise.toLowerCase() === name.toLowerCase());
    spec.value = last ? setsSpec(last.lastSets) : '';
    spec.focus();
  };
  const meta = [w.start !== null ? clock(w.start) : null, kindName(w.kind), w.minutes !== null ? `${Math.round(w.minutes)} min` : null, w.calories !== null ? kcal(w.calories) : null, volumeOf(w.sets) ? `${kgText(volumeOf(w.sets))} volume` : null].filter(Boolean).join(' · ');
  return h(
    'section',
    { class: 'card' },
    h(
      'header',
      { class: 'workout-head' },
      h('div', {}, h('h2', { dir: 'auto' }, w.name, w.source !== 'manual' ? h('span', { class: 'badge', style: { marginLeft: '8px' } }, `from ${cap(w.source)}`) : null), h('p', {}, meta)),
      h('button', { class: 'btn ghost sm danger', onclick: del }, 'Delete'),
    ),
    w.note ? h('p', { class: 'hint', dir: 'auto', style: { marginBottom: '8px' } }, w.note) : null,
    exercises,
    h('div', { class: 'add-row workout-add' }, exercise, spec, h('button', { class: 'btn primary', onclick: addSets }, 'Add sets')),
    h('p', { class: 'hint', style: { marginTop: '6px' } }, '3x8@60 is 3 sets of 8 at 60 kg. Also 8/8/6@60, 3x10 (bodyweight), 3x30s, 5km.'),
    v.recent.length ? h('div', { class: 'chips', style: { marginTop: '10px' } }, v.recent.slice(0, 8).map((name) => h('button', { class: 'chip', dir: 'auto', onclick: () => fill(name) }, icon('plus'), name))) : null,
  );
}

function trainingWeekCard(v) {
  const max = Math.max(...v.week.map((d) => d.minutes), 1);
  return card(
    'Last 7 days',
    'Minutes trained each day.',
    h(
      'div',
      { class: 'cal-week' },
      v.week.map((d) =>
        h(
          'a',
          { class: `cal-day${d.day === v.day ? ' on' : ''}`, href: `#health/${d.day}`, title: d.sessions ? `${shortDay(d.day)}: ${d.sessions} session${d.sessions === 1 ? '' : 's'}, ${Math.round(d.minutes)} min${d.volume ? `, ${kgText(d.volume)} volume` : ''}` : `${shortDay(d.day)}: rest` },
          h('div', { class: 'cal-bar-box' }, h('div', { class: 'cal-bar', style: { height: `${d.minutes ? (d.minutes / max) * 100 : d.sessions ? 8 : 0}%` } })),
          h('span', {}, WEEKDAY_SHORT(d.day)),
        ),
      ),
    ),
  );
}

function recordsCard(v) {
  return card(
    'Exercises',
    'Your best set and the last time, for what you did lately.',
    v.history.length
      ? h(
          'ul',
          { class: 'list' },
          v.history.map((x) =>
            h(
              'li',
              {},
              h('div', { class: 'grow' }, h('div', { class: 'text', dir: 'auto' }, x.exercise), h('div', { class: 'hint' }, `Last ${shortDay(x.lastDay)}: ${setsText(x.lastSets)}`)),
              h('div', { class: 'record' }, x.best ? h('strong', { class: 'num' }, `${n1(x.best.weight)} kg${x.best.reps !== null ? ` × ${x.best.reps}` : ''}`) : h('span', { class: 'hint' }, 'no weights'), x.best ? h('div', { class: 'hint' }, `best · ${shortDay(x.best.day)}`) : null),
            ),
          ),
        )
      : h('p', { class: 'empty' }, 'Log a workout with its sets and your records show up here.'),
  );
}

function importCard() {
  return card(
    'Import from Caliber',
    null,
    h('p', { class: 'hint' }, 'Export your workout data from the Caliber app, save the file on this PC, then ask Claude to import it, or run:'),
    h('pre', { class: 'code' }, 'npm run raqib -- workout import <file> --dry-run'),
    h('p', { class: 'hint' }, 'Importing the same file again adds nothing twice.'),
  );
}

// ------------------------------------------------------------------ training plan
// The plan on the Health page's Exercise tab: today's workout from the plan (weight to use,
// reps to beat, a set at a time), the whole plan against its goals, and progress. Each
// planned exercise has its own page at #exercise/<id>. The engine (progression.ts) decides;
// these only show what it says.

const VERDICT = {
  ADD_WEIGHT: ['Add weight', 'good'],
  HOLD: ['Same weight', 'accent'],
  TOO_HEAVY: ['Too heavy', 'danger'],
};
const GOAL_STATUS = { ahead: ['Ahead', 'good', '▲'], 'on track': ['On track', 'accent', '●'], behind: ['Behind', 'danger', '▼'] };
const wLabel = (w, e) => (e.bodyweight ? (w === 0 ? 'BW' : `${w > 0 ? '+' : '−'}${n1(Math.abs(w))}`) : `${n1(w)} kg${e.perHand ? ' per hand' : e.perSide ? ' per side' : ''}`);
const verdictBadge = (v) => (v ? h('span', { class: `badge ${VERDICT[v.kind][1]}` }, VERDICT[v.kind][0]) : null);
const statusBadge = (p) => (p ? h('span', { class: `badge ${GOAL_STATUS[p.status][1]}`, title: `Expected now: ${n1(p.expected)} kg` }, `${GOAL_STATUS[p.status][2]} ${GOAL_STATUS[p.status][0]}`) : h('span', { class: 'badge' }, 'No data'));
const repsText = (reps) => (reps?.length ? reps.join('/') : '—');

// A time chart: lines over days, one y-axis, with a crosshair and tooltip. Series are
// { name, cls, points: [{ day, v }], dashed?, dots? }; `band` is [{ day, lo, hi }];
// `markers` are { day, v, cls, shape, label } drawn on top.
function timeChart({ series, band = [], markers = [], format = (v) => n1(v), label, height = 220, from, to, yFloor = null }) {
  const all = [...series.flatMap((s) => s.points), ...band.flatMap((b) => [{ day: b.day, v: b.lo }, { day: b.day, v: b.hi }]), ...markers];
  const days = all.map((p) => p.day).sort();
  if (days.length < 2) return h('p', { class: 'empty' }, 'Not enough to draw yet.');
  const W = 640, H = height, L = 44, R = 12, T = 12, B = 24;
  const t0 = parseDay(from ?? days[0]), t1 = Math.max(parseDay(to ?? days.at(-1)), t0 + 86_400_000);
  const vs = all.map((p) => p.v).filter((v) => v !== null && Number.isFinite(v));
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (yFloor !== null) lo = Math.min(lo, yFloor);
  const pad = Math.max((hi - lo) * 0.1, 1);
  lo -= pad;
  hi += pad;
  const x = (day) => L + ((parseDay(day) - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 1, 2, 3].map((i) => lo + pad + ((hi - lo - 2 * pad) * i) / 3);
  const inRange = (p) => p.day >= (from ?? days[0]) && p.day <= (to ?? days.at(-1));
  const path = (pts) => pts.filter(inRange).map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const months = [];
  for (let d = new Date(t0); d.getTime() <= t1; d.setMonth(d.getMonth() + 1, 1)) {
    const key = dayKey(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
    if (parseDay(key) >= t0) months.push(key);
  }
  const every = Math.max(1, Math.ceil(months.length / 7));
  const bandIn = band.filter(inRange);
  const cross = svg('line', { class: 'crosshair', y1: T, y2: H - B, x1: 0, x2: 0, visibility: 'hidden' });
  const chart = svg(
    'svg',
    { class: 'time-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label },
    ticks.map((v) => [svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid-line' }), svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-text' }, format(v))]),
    months.filter((_, i) => i % every === 0).map((m) => svg('text', { x: x(m), y: H - 6, 'text-anchor': 'middle', class: 'axis-text' }, new Date(parseDay(m)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }))),
    bandIn.length > 1
      ? svg('path', { class: 'band', d: `${bandIn.map((b, i) => `${i ? 'L' : 'M'}${x(b.day)},${y(b.hi)}`).join('')}${[...bandIn].reverse().map((b) => `L${x(b.day)},${y(b.lo)}`).join('')}Z` })
      : null,
    series.map((s) => svg('path', { d: path(s.points), class: `series ${s.cls}${s.dashed ? ' dashed' : ''}` })),
    series.filter((s) => s.dots).map((s) => s.points.filter(inRange).map((p) => svg('circle', { cx: x(p.day), cy: y(p.v), r: 4, class: `dot ${s.cls}${p.faded ? ' faded' : ''}` }))),
    markers.filter(inRange).map((m) =>
      m.shape === 'diamond'
        ? svg('path', { d: `M${x(m.day)},${y(m.v) - 6}l6,6l-6,6l-6,-6z`, class: `marker ${m.cls}` })
        : svg('rect', { x: x(m.day) - 5, y: y(m.v) - 5, width: 10, height: 10, rx: 2, class: `marker ${m.cls}` }),
    ),
    cross,
  );
  // Hover: the nearest day with anything on it.
  const hoverDays = [...new Set(all.filter(inRange).map((p) => p.day))].sort();
  chart.addEventListener('mousemove', (event) => {
    const box = chart.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    let best = hoverDays[0];
    for (const d of hoverDays) if (Math.abs(x(d) - px) < Math.abs(x(best) - px)) best = d;
    cross.setAttribute('x1', x(best));
    cross.setAttribute('x2', x(best));
    cross.setAttribute('visibility', 'visible');
    const near = (pts) => {
      const before = pts.filter((p) => p.day <= best).at(-1);
      return before && before.day === best ? before : null;
    };
    const lines = [
      ...series.map((s) => {
        const p = near(s.points);
        return p ? `${s.name}: ${format(p.v)}${p.note ? ` · ${p.note}` : ''}` : null;
      }),
      ...(bandIn.find((b) => b.day === best) ? [`Middle half: ${format(bandIn.find((b) => b.day === best).lo)}–${format(bandIn.find((b) => b.day === best).hi)}`] : []),
      ...markers.filter((m) => m.day === best).map((m) => m.label),
    ];
    showTip(event, { heading: shortDay(best), lines });
  });
  chart.addEventListener('mouseleave', () => {
    cross.setAttribute('visibility', 'hidden');
    hideTip();
  });
  return chart;
}

function chartLegend(items) {
  return h('div', { class: 'chart-legend' }, items.map(([cls, name]) => h('span', {}, h('i', { class: `key ${cls}` }), name)));
}

/** A tiny aim-vs-actual line for a plan row. */
function sparkline(e) {
  const pts = e.recent;
  const goals = e.exercise.goals;
  if (!goals.length) return null;
  const W = 120, H = 30, P = 3;
  const days = [...pts.map((p) => p.day), ...goals.map((g) => g.day)].sort();
  const t0 = parseDay(days[0]), t1 = parseDay(days.at(-1));
  const vs = [...pts.map((p) => p.weight), ...goals.map((g) => g.weight)];
  const lo = Math.min(...vs), hi = Math.max(...vs) + 0.001;
  const x = (d) => P + ((parseDay(d) - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const line = (list, f) => list.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(f(p)).toFixed(1)}`).join('');
  return svg(
    'svg',
    { class: 'spark', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${e.exercise.name}: aim against actual` },
    svg('path', { d: line(goals, (g) => g.weight), class: 'series aim dashed' }),
    pts.length ? svg('path', { d: line(pts, (p) => p.weight), class: 'series actual' }) : null,
    pts.length ? svg('circle', { cx: x(pts.at(-1).day), cy: y(pts.at(-1).weight), r: 2.5, class: 'dot actual' }) : null,
  );
}

let exerciseView = (() => {
  try {
    return localStorage.getItem('raqib.exerciseView') || 'today';
  } catch {
    return 'today';
  }
})();
let trainingDay = null;

function exerciseViewTabs() {
  return h(
    'div',
    { class: 'seg', role: 'tablist', 'aria-label': 'Exercise view', style: { marginBottom: '16px' } },
    [['today', "Today's workout"], ['plan', 'Plan'], ['plans', 'All plans'], ['progress', 'Progress'], ['strength', 'Strength'], ['log', 'Log']].map(([t, name]) =>
      h('button', {
        type: 'button',
        role: 'tab',
        class: t === exerciseView ? 'on' : '',
        'aria-selected': String(t === exerciseView),
        onclick: () => {
          exerciseView = t;
          try {
            localStorage.setItem('raqib.exerciseView', t);
          } catch {}
          render();
        },
      }, name),
    ),
  );
}

// ---- today's workout

function stepper(value, { min = 0, max = 100, label }) {
  let current = value;
  const out = h('output', { class: 'num stepper-value', 'aria-live': 'polite' }, String(current));
  const set = (v) => {
    current = Math.max(min, Math.min(max, v));
    out.textContent = String(current);
  };
  const el = h(
    'div',
    { class: 'stepper', role: 'group', 'aria-label': label },
    h('button', { type: 'button', class: 'btn icon sm', 'aria-label': 'One fewer', onclick: () => set(current - 1) }, '−'),
    out,
    h('button', { type: 'button', class: 'btn icon sm', 'aria-label': 'One more', onclick: () => set(current + 1) }, '+'),
  );
  return { el, get: () => current, set };
}

function todayExerciseCard(x, v) {
  const s = x.state;
  const e = s.exercise;
  const sug = s.suggestion;
  const setIndex = x.logged.length;
  const lastLogged = x.logged.at(-1);
  const weight = h('input', {
    type: 'number', min: 0, step: e.step, inputmode: 'decimal', class: 'num-in weight-in',
    value: lastLogged ? (lastLogged.weight ?? 0) : sug.weight, 'aria-label': `Weight for ${e.name}${e.perHand ? ', per hand' : e.perSide ? ', per side' : ''}`,
  });
  const beatHere = sug.beat?.[setIndex];
  const reps = stepper(beatHere ?? lastLogged?.reps ?? e.repMin, { min: 0, max: 100, label: `Reps for set ${setIndex + 1}` });
  const log = oneAtATime(async () => {
    try {
      const r = await api('/training/sets', { method: 'POST', body: { date: v.date, exerciseId: e.id, weight: Number(weight.value || 0), reps: reps.get() } });
      trainingDay = v.day.id;
      if (r.now) say(`${e.name}: ${r.now.message}`);
      await render();
    } catch (error) {
      handle(error);
    }
  });
  const done = setIndex >= e.sets;
  const formReset = h('input', { type: 'checkbox', checked: x.formReset, disabled: !x.logged.length });
  formReset.addEventListener('change', () => act(() => api('/training/logs', { method: 'PUT', body: { date: v.date, exerciseId: e.id, formReset: formReset.checked } })));
  const target = `${e.sets} × ${e.repMin}–${e.repMax}`;
  return h(
    'section',
    { class: `card plan-ex${done ? ' done' : ''}` },
    h(
      'header',
      {},
      h('div', {}, h('h2', {}, h('span', { class: 'pos' }, `${e.position}.`), ' ', h('a', { href: `#exercise/${e.id}` }, e.name)),
        h('div', { class: 'row tags' },
          h('span', { class: 'badge' }, target),
          e.laterSlot ? h('span', { class: 'badge dawn', title: `A muscle it trains was already worked this session, so the target is lowered: add weight at ${sug.threshold} total reps, no set under ${sug.lowestOk}.` }, 'Later slot · target lowered') : null,
          e.perHand ? h('span', { class: 'badge' }, 'Per hand') : null,
          e.perSide ? h('span', { class: 'badge' }, 'Per side') : null,
          e.bodyweight ? h('span', { class: 'badge' }, 'Weight = added load') : null,
        )),
      h('div', { class: 'suggest' }, h('div', { class: 'big num' }, s.suggestedLabel), h('div', { class: 'hint' }, `${sug.sets} × ${e.repMin}–${e.repMax}${sug.setsReason ? ` · ${sug.setsReason}` : ''}`), h('div', { class: 'hint' }, sug.beat ? `Beat ${repsText(sug.beat)}` : sug.verdict ? 'New weight: aim for the bottom of the range' : 'Starting weight from the plan')),
    ),
    sug.verdict && sug.last
      ? h('p', { class: 'hint' }, `Last time (${shortDay(sug.last.day)}): ${wLabel(sug.last.weight, e)} × ${repsText(sug.last.reps)} → `, h('b', {}, sug.verdict.message), s.comparedWith === 'history' ? ' (from imported history)' : '')
      : null,
    e.note ? h('p', { class: 'hint' }, e.note) : null,
    x.logged.length
      ? h('div', { class: 'row logged' },
          x.logged.map((l, i) =>
            h('span', { class: 'chip static' }, `${i + 1}: ${l.reps ?? '?'} @ ${wLabel(l.weight ?? 0, e)}`,
              h('button', { class: 'chip-x', 'aria-label': `Remove set ${i + 1}`, onclick: () => act(() => api(`/training/sets/${l.id}`, { method: 'DELETE' })) }, '×'))),
          x.now
            ? h('span', { class: 'verdict' },
                x.now.kind === 'TOO_HEAVY' || setIndex >= e.sets ? [verdictBadge(x.now), ' ', x.now.message] : 'So far',
                x.now.kind !== 'TOO_HEAVY' ? ` · ${x.now.total} of ${x.now.threshold} reps to add weight` : '')
            : null)
      : null,
    h('div', { class: 'row log-row' },
      h('label', { class: 'field' }, h('span', {}, e.bodyweight ? 'Added kg' : e.perHand ? 'kg per hand' : e.perSide ? 'kg per side' : 'kg'), weight),
      h('div', { class: 'field' }, h('span', {}, `Reps, set ${setIndex + 1}${done ? ' (extra)' : ''}`), reps.el),
      h('button', { class: `btn ${done ? '' : 'primary'} big`, onclick: log }, done ? 'Log extra set' : `Log set ${setIndex + 1} of ${e.sets}`),
      h('label', { class: 'check', title: 'You lowered the weight on purpose because form broke: not counted as a regression.' }, formReset, ' Form reset'),
    ),
    s.flags.length ? h('div', { class: 'callout', style: { marginTop: '10px' } }, s.flags.map((f) => h('div', {}, f.message))) : null,
  );
}

async function trainingToday(key) {
  const v = await api(`/training/today?date=${key}${trainingDay ? `&day=${trainingDay}` : ''}`);
  const days = h(
    'div',
    { class: 'seg', role: 'tablist', 'aria-label': 'Plan day' },
    v.days.map((d) =>
      h('button', {
        type: 'button', role: 'tab', class: d.id === v.day.id ? 'on' : '', 'aria-selected': String(d.id === v.day.id),
        onclick: () => {
          trainingDay = d.id;
          render();
        },
      }, d.name, d.id === v.next ? ' ·' : ''),
    ),
  );
  const logged = v.exercises.filter((x) => x.logged.length).length;
  return [
    h('div', { class: 'row', style: { marginBottom: '12px', justifyContent: 'space-between' } }, days,
      h('span', { class: 'hint' }, v.day.id === v.next ? 'Next in your rotation' : '', v.day.note ? ` · ${v.day.note}` : '', logged ? ` · ${logged} of ${v.exercises.length} logged` : '')),
    v.exercises.length ? h('div', { class: 'stack' }, v.exercises.map((x) => todayExerciseCard(x, v))) : h('p', { class: 'empty' }, 'No exercises on this day of the plan.'),
  ];
}

// ---- the plan

async function trainingPlan() {
  const v = await api('/training/plan');
  const byDay = v.days.map((d) => [d, v.exercises.filter((e) => e.exercise.dayId === d.id)]);
  const counted = v.exercises.filter((e) => e.progress);
  const onTrack = counted.filter((e) => e.progress.status !== 'behind').length;
  return [
    h('div', { class: 'stats' },
      stat('On track', counted.length ? pct(onTrack / counted.length) : '—', `${onTrack} of ${counted.length} exercises`),
      stat('Next checkpoint', (() => {
        const next = v.checkpoints.find((c) => c.day > v.today);
        return next ? next.label : '—';
      })(), (() => {
        const next = v.checkpoints.find((c) => c.day > v.today);
        return next ? `${daysFrom(v.today, next.day)} days, ${shortDay(next.day)}` : null;
      })()),
      stat('Flags', String(v.exercises.filter((e) => e.flags.length).length), 'stalled, regressed, or weight left on the table'),
    ),
    byDay.map(([d, list]) =>
      card(d.name, d.note,
        h('div', { class: 'table-wrap' }, h('table', { class: 'plan-table training-table' },
          h('thead', {}, h('tr', {}, ['Exercise', 'Now', 'Next goal', 'Of goal', 'Status', 'Aim vs actual'].map((t) => h('th', {}, t)))),
          h('tbody', {}, list.map((e) => {
            const p = e.progress;
            return h('tr', {},
              h('td', {}, h('a', { href: `#exercise/${e.exercise.id}` }, e.exercise.name), e.flags.length ? h('div', { class: 'hint flag-line' }, e.flags.map((f) => f.kind).join(' · ')) : null),
              h('td', { class: 'num' }, e.currentLabel ?? '—'),
              h('td', { class: 'num' }, p ? `${wLabel(p.goal.weight, e.exercise)} by ${shortDay(p.goal.day)}` : '—'),
              h('td', {}, p ? h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, progressBar(p.ratio, 'var(--chart-actual)', 'Of the goal', 'mini'), h('span', { class: 'num' }, e.exercise.bodyweight && p.goal.weight === 0 ? '—' : pct(p.ratio))) : '—'),
              h('td', {}, statusBadge(p)),
              h('td', {}, sparkline(e)),
            );
          })),
        )),
        h('div', { class: 'row', style: { marginTop: '10px' } }, chartLegend([['actual', 'Your working weight'], ['aim dashed', 'Plan']])),
      ),
    ),
    addExerciseCard(v),
  ];
}

// ---- all plans (the phone's, read only) with their weekly sets per muscle

let plansPick = (() => {
  try {
    return localStorage.getItem('raqib.plansPick');
  } catch {
    return null;
  }
})();

const MUSCLE_VERDICT = { low: ['dawn', 'Low'], ok: ['good', 'In range'], high: ['dawn', 'A lot'], once: ['accent', 'Once a week'] };
const timesAWeek = (n) => (n === 1 ? 'once a week' : n === 2 ? 'twice a week' : `${n}× a week`);

function muscleCard(load) {
  const trained = load.muscles.filter((m) => m.total > 0);
  const scale = Math.max(20, ...trained.map((m) => m.total));
  const missing = load.muscles.filter((m) => m.total === 0).map((m) => m.muscle);
  return card('Weekly sets per muscle', 'Helper sets count as half',
    h('div', { class: 'table-wrap' }, h('table', { class: 'plan-table muscle-table' },
      h('thead', {}, h('tr', {}, ['Muscle', 'Days', 'Sets', '', 'From', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, trained.map((m) => {
        const v = m.verdict;
        const byDay = new Map();
        for (const c of m.from) byDay.set(c.day, [...(byDay.get(c.day) ?? []), `${c.exercise} ${c.sets}${c.main ? '' : ' (½)'}`]);
        return h('tr', {},
          h('td', {}, h('strong', {}, m.muscle)),
          h('td', { class: 'num' }, m.days ? timesAWeek(m.days) : m.helperDays ? `helper, ${timesAWeek(m.helperDays)}` : '—'),
          h('td', { class: 'num' }, h('strong', {}, n1(m.total)), m.indirect ? h('div', { class: 'hint' }, `${m.direct} direct + ${m.indirect} helping`) : null),
          h('td', {}, h('div', { class: 'ms-bar', 'aria-hidden': 'true' },
            h('span', { class: 'ms-direct', style: { width: `${(m.direct / scale) * 100}%` } }),
            h('span', { class: 'ms-help', style: { width: `${(m.indirect / 2 / scale) * 100}%` } }))),
          h('td', { class: 'hint ms-from' }, [...byDay].map(([d, list]) => h('div', {}, h('b', {}, d), ' ', list.join(' · ')))),
          h('td', {}, v ? h('span', { class: `badge ${MUSCLE_VERDICT[v][0]}` }, MUSCLE_VERDICT[v][1]) : null),
        );
      })),
    )),
    h('p', { class: 'hint', style: { marginTop: '10px' } }, 'One pass through the days counts as a week. Sets count in full for the main muscle and as half for muscles that help (bench press: chest, with triceps helping). A rough growth range is about 10–20 sets over 2 days a week.'),
    missing.length ? h('p', { class: 'hint' }, `Not trained: ${missing.join(' · ')}`) : null,
    load.unknown.length ? h('p', { class: 'hint' }, `Not counted (name not recognised): ${load.unknown.map((u) => `${u.exercise} (${u.day})`).join(' · ')}`) : null,
  );
}

async function trainingPlans() {
  const v = await api('/training/plans');
  const plan = v.plans.find((p) => p.name === plansPick) ?? v.plans.find((p) => p.active) ?? v.plans[0];
  const pick = (name) => {
    plansPick = name;
    try {
      localStorage.setItem('raqib.plansPick', name);
    } catch {}
    render();
  };
  const sets = plan.days.reduce((n, d) => n + d.exercises.reduce((k, e) => k + e.sets, 0), 0);
  return [
    v.error ? h('p', { class: 'hint', style: { marginBottom: '12px' } }, v.error, ' Showing this PC\'s plan.') : null,
    v.source === 'phone' ? h('p', { class: 'hint', style: { marginBottom: '12px' } }, 'Plans from the gym app. Make and edit them on the phone.') : null,
    h('div', { class: 'chips', style: { marginBottom: '16px' }, role: 'radiogroup', 'aria-label': 'Plan' },
      v.plans.map((p) => h('button', { type: 'button', class: `chip${p === plan ? ' on' : ''}`, role: 'radio', 'aria-checked': String(p === plan), onclick: () => pick(p.name) }, p.name, p.active ? h('span', { class: 'badge accent' }, 'Active') : null))),
    h('div', { class: 'stats' },
      stat('Days a week', String(plan.days.length), plan.days.map((d) => d.name).join(' · ')),
      stat('Sets a week', String(sets), plan.days.map((d) => d.exercises.reduce((k, e) => k + e.sets, 0)).join(' + ')),
      stat('Muscles worked', String(plan.load.muscles.filter((m) => m.total > 0).length), `of ${plan.load.muscles.length}`),
    ),
    plan.note ? h('p', { class: 'hint', style: { margin: '0 0 12px' } }, plan.note) : null,
    muscleCard(plan.load),
    h('div', { class: 'plan-days' }, plan.days.map((d) =>
      card(d.name, d.note,
        d.exercises.length
          ? h('table', { class: 'plan-table' },
            h('thead', {}, h('tr', {}, ['Exercise', 'Sets × reps'].map((t) => h('th', {}, t)))),
            h('tbody', {}, d.exercises.map((e) => h('tr', {}, h('td', {}, e.name, e.note ? h('div', { class: 'hint' }, e.note) : null), h('td', { class: 'num' }, `${e.sets} × ${e.repMin}–${e.repMax}`)))))
          : h('p', { class: 'empty' }, 'No exercises yet.')))),
  ];
}

function addExerciseCard(v) {
  const name = h('input', { type: 'text', placeholder: 'Exercise name', 'aria-label': 'Exercise name' });
  const day = h('select', { 'aria-label': 'Plan day' }, v.days.map((d) => h('option', { value: d.id }, d.name)));
  const num = (label, value, step = 1) => h('label', { class: 'field' }, h('span', {}, label), h('input', { type: 'number', value, step, min: 0, class: 'num-in' }));
  const sets = num('Sets', 3), lo = num('Reps from', 8), hi = num('to', 12), step = num('Step kg', 2.5, 0.5);
  const later = h('input', { type: 'checkbox' });
  const read = (f) => Number(f.querySelector('input').value);
  const add = oneAtATime(async () => {
    if (!name.value.trim()) return say('Name the exercise', true);
    try {
      await api('/training/exercises', { method: 'POST', body: { name: name.value.trim(), dayId: Number(day.value), sets: read(sets), repMin: read(lo), repMax: read(hi), step: read(step), laterSlot: later.checked } });
      say('Added to the plan: set its goals on its page');
      await render();
    } catch (error) {
      handle(error);
    }
  });
  return card('Add an exercise', 'Goals per checkpoint are set on its page.',
    h('div', { class: 'row', style: { alignItems: 'flex-end' } }, h('label', { class: 'field' }, h('span', {}, 'Name'), name), h('label', { class: 'field' }, h('span', {}, 'Day'), day), sets, lo, hi, step,
      h('label', { class: 'check' }, later, ' Later slot'), h('button', { class: 'btn primary', onclick: add }, 'Add')));
}

// ---- progress

function weeksChart(weeks) {
  const W = 640, H = 150, L = 28, R = 8, T = 10, B = 22;
  const max = Math.max(4, ...weeks.map((w) => w.sessions));
  const bw = (W - L - R) / weeks.length;
  const y = (v) => T + (1 - v / max) * (H - T - B);
  return svg('svg', { class: 'time-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Strength sessions a week' },
    [0, 3, max].map((v) => [svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 3 ? 'grid-line goal-line' : 'grid-line' }), svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-text' }, String(v))]),
    weeks.map((w, i) => {
      const x = L + i * bw + 1;
      const bar = svg('rect', { x, width: Math.max(1, bw - 2), y: y(w.sessions), height: Math.max(0, y(0) - y(w.sessions)), rx: Math.min(3, bw / 3), class: `wbar${w.recent ? ' recent' : ''}${w.low ? ' low' : ''}` });
      const hit = svg('rect', { x: L + i * bw, width: bw, y: T, height: H - T - B, class: 'hit' });
      hit.addEventListener('mousemove', (event) => showTip(event, { heading: `Week of ${shortDay(w.monday)}`, lines: [`${w.sessions} session${w.sessions === 1 ? '' : 's'}`, w.low ? 'Under 3' : null] }));
      hit.addEventListener('mouseleave', hideTip);
      return [bar, w.low && w.recent ? svg('text', { x: x + bw / 2 - 1, y: y(w.sessions) - 3, 'text-anchor': 'middle', class: 'axis-text low-mark' }, '!') : null, hit];
    }),
    svg('text', { x: L, y: H - 6, class: 'axis-text' }, shortDay(weeks[0].monday)),
    svg('text', { x: W - R, y: H - 6, 'text-anchor': 'end', class: 'axis-text' }, 'this week'),
  );
}

function bodyLogCard(d, key) {
  const last = d.body.points.at(-1);
  const input = (label, unit, value, step) => h('label', { class: 'field' }, h('span', {}, label), h('input', { type: 'number', min: 0, step, inputmode: 'decimal', value: value ?? '', placeholder: unit, class: 'num-in' }));
  const todays = last?.day === key ? last : null;
  const weight = input('Weight (kg)', 'kg', todays?.weight, 0.1);
  const waist = input('Waist (cm)', 'cm', todays?.waist, 0.5);
  const note = h('input', { type: 'text', placeholder: 'Note (optional)', value: todays?.note ?? '', 'aria-label': 'Note' });
  const read = (f) => numberOf(f.querySelector('input'));
  const save = oneAtATime(async () => {
    if (!read(weight)) return say('Put in your weight', true);
    try {
      await api(`/health/weight/${key}`, { method: 'PUT', body: { weight: read(weight), waist: read(waist), note: note.value.trim() || null } });
      say('Saved');
      await render();
    } catch (error) {
      handle(error);
    }
  });
  const diff = d.body.difference;
  return card('Body log', d.body.targetToday !== null ? `Target today ${kg(d.body.targetToday)}` : null,
    h('div', { class: 'row', style: { alignItems: 'flex-end' } }, weight, waist, h('label', { class: 'field grow' }, h('span', {}, 'Note'), note), h('button', { class: 'btn primary', onclick: save }, todays ? 'Update' : 'Save')),
    diff !== null ? h('p', { class: 'hint', style: { marginTop: '10px' } }, `7-day average is ${signed(diff, 'kg')} from the target line${Math.abs(diff) <= 0.5 ? ': right on it' : diff < 0 ? ': under it' : ': over it'}.`) : null,
  );
}

async function trainingProgress(key) {
  const d = await api(`/training/progress?date=${key}`);
  const recent = d.weeks.filter((w) => w.recent && w.monday !== d.weeks.at(-1).monday);
  const avg = recent.length ? recent.reduce((n, w) => n + w.sessions, 0) / recent.length : null;
  const lastQ = [...d.quarters].reverse().find((q) => q.change !== null);
  const final = d.aim.at(-1);
  const flagged = await api('/training/flagged');
  const bodyFrom = shiftDay(key, -182);
  return [
    h('div', { class: 'stats' },
      stat('Sessions a week', avg === null ? '—' : n1(avg), `average, last 12 weeks · ${recent.filter((w) => w.low).length} under 3`),
      stat('On track', d.onTrack.share === null ? '—' : pct(d.onTrack.share), d.onTrack.behind.length ? `behind: ${d.onTrack.behind.join(', ')}` : `of ${d.onTrack.counted} exercises`),
      stat('Strength, last quarter', lastQ ? `${lastQ.change > 0 ? '+' : ''}${n1(lastQ.change)}%` : '—', lastQ ? `median across exercises${lastQ.vsPrevious !== null ? ` · ${lastQ.vsPrevious > 0 ? '+' : ''}${n1(lastQ.vsPrevious)} vs the quarter before` : ''}` : null),
      stat('Bodyweight', d.body.difference === null ? '—' : signed(d.body.difference, 'kg'), d.body.targetToday !== null ? `7-day average vs target ${kg(d.body.targetToday)}` : null),
    ),
    d.flags.length || d.stalled.length
      ? h('div', { class: 'callout', style: { marginBottom: '16px' } }, d.flags.map((f) => h('div', {}, h('b', {}, f.message))), d.stalled.length ? h('div', {}, `Stalled: ${d.stalled.join(', ')}`) : null)
      : null,
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'stack' },
        card('Aim against actual', 'All weighted lifts, as % of their Nov 27 goal',
          timeChart({
            label: 'Median lift as % of its final goal: plan against actual',
            series: [
              { name: 'Plan', cls: 'aim', dashed: true, points: d.aim.filter((p) => p.aim !== null).map((p) => ({ day: p.day, v: p.aim })) },
              { name: 'You (median)', cls: 'actual', points: d.aim.filter((p) => p.actual !== null).map((p) => ({ day: p.day, v: p.actual })) },
            ],
            band: d.aim.filter((p) => p.low !== null).map((p) => ({ day: p.day, lo: p.low, hi: p.high })),
            format: (v) => `${Math.round(v)}%`,
          }),
          chartLegend([['actual', 'You: median lift'], ['band', 'Middle half of lifts'], ['aim dashed', 'Plan']]),
          h('p', { class: 'hint' }, `Pull-ups are left out (their goal is added load). ${final ? `By ${new Date(parseDay(final.day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} the plan reaches 100%.` : ''}`),
        ),
        card('Sessions a week', 'The last 12 weeks are highlighted; ! marks weeks under 3', weeksChart(d.weeks)),
        card('Quarter by quarter', 'Median change in working weight across exercises',
          h('table', { class: 'plan-table' },
            h('thead', {}, h('tr', {}, ['Quarter', 'Change', 'Vs the one before'].map((t) => h('th', {}, t)))),
            h('tbody', {}, [...d.quarters].reverse().map((q) => h('tr', {},
              h('td', {}, `${shortDay(q.from)} → ${shortDay(q.to)}${q.partial ? ' (so far)' : ''}`),
              h('td', { class: 'num' }, q.change === null ? '—' : `${q.change > 0 ? '+' : ''}${n1(q.change)}%`),
              h('td', { class: 'num' }, q.vsPrevious === null ? '—' : `${q.vsPrevious > 0 ? '+' : ''}${n1(q.vsPrevious)} pts`),
            ))),
          )),
      ),
      h('div', { class: 'stack' },
        bodyLogCard(d, key),
        card('Bodyweight against target', 'Slow lean bulk',
          timeChart({
            label: 'Bodyweight 7-day average against the target line',
            from: d.body.points.length ? (d.body.points[0].day > bodyFrom ? d.body.points[0].day : bodyFrom) : key,
            to: d.body.targets.at(-1)?.day,
            series: [
              { name: 'Target', cls: 'aim', dashed: true, points: d.body.targets.map((t) => ({ day: t.day, v: t.weight })) },
              { name: '7-day average', cls: 'actual', points: d.body.average.map((p) => ({ day: p.day, v: p.weight })) },
              { name: 'Weighed', cls: 'raw', dots: true, points: d.body.points.map((p) => ({ day: p.day, v: p.weight, note: p.note })) },
            ],
            format: (v) => `${n1(v)}`,
          }),
          chartLegend([['actual', '7-day average'], ['raw', 'Weigh-ins'], ['aim dashed', 'Target']]),
          h('table', { class: 'plan-table', style: { marginTop: '10px' } },
            h('thead', {}, h('tr', {}, ['Checkpoint', 'Weight', 'Lean', 'FFMI'].map((t) => h('th', {}, t)))),
            h('tbody', {}, d.body.targets.map((t) => h('tr', {}, h('td', {}, t.label), h('td', { class: 'num' }, kg(t.weight)), h('td', { class: 'num' }, t.lean === null ? '—' : kg(t.lean)), h('td', { class: 'num' }, t.ffmi === null ? '—' : n1(t.ffmi)))))),
        ),
        card('Waist', 'A growing waist while lifts stall means holding calories',
          d.body.points.filter((p) => p.waist !== null).length >= 2
            ? timeChart({ label: 'Waist over time', height: 150, series: [{ name: 'Waist', cls: 'actual', dots: true, points: d.body.points.filter((p) => p.waist !== null).map((p) => ({ day: p.day, v: p.waist })) }], format: (v) => `${n1(v)}` })
            : h('p', { class: 'empty' }, 'Measure your waist on two days to see a trend.')),
        flagged.length ? flaggedCard(flagged) : null,
      ),
    ),
  ];
}

// ---- strength score and balance (strength.ts), with the body figure (bodyFigure.ts)

const FIGURE_LEGEND = {
  level: [['bf-none', 'No recent lifts'], ['bf-l0', 'Below beginner'], ['bf-l1', 'Beginner'], ['bf-l2', 'Novice'], ['bf-l3', 'Intermediate'], ['bf-l4', 'Advanced'], ['bf-l5', 'Elite']],
  relative: [['bf-none', 'No recent lifts'], ['bf-r-far', 'Far behind your average'], ['bf-r-behind', 'Behind'], ['bf-r-near', 'Near your average'], ['bf-r-ahead', 'Ahead']],
};
const stored = (key, values, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return values.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const remember = (key, v) => {
  try {
    localStorage.setItem(key, v);
  } catch {}
};
// Set in Settings; kept on this PC.
let strengthStandards = stored('raqib.strengthStandards', ['men', 'women'], 'men');
// How the figure shades the muscles: against your own average, or by level.
let figureMode = stored('raqib.figureMode', ['relative', 'level'], 'relative');

/** The Settings card for the strength standards. */
function strengthStandardsCard() {
  return card('Strength score', null,
    h('p', { class: 'hint', style: { marginBottom: '12px' } }, 'Which bodyweight standards the strength score uses. Approximate ratios for each group’s reference lift.'),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Standards' },
      [['men', "Men's standards"], ['women', "Women's standards"]].map(([v, name]) =>
        h('button', { type: 'button', role: 'radio', class: v === strengthStandards ? 'on' : '', 'aria-checked': String(v === strengthStandards), onclick: () => {
          strengthStandards = v;
          remember('raqib.strengthStandards', v);
          say('Saved');
          render();
        } }, name))));
}

const levelText = (g) => g.level ?? (g.score === null ? 'No recent lifts' : 'Below beginner');
const CONFIDENCE = { high: 'High', medium: 'Medium', low: 'Low' };
/** How sure a group's score is, and why: its best lift is the reference lift or a conversion. */
const confidenceCell = (g) => g.confidence
  ? [h('div', { class: 'conf' }, h('i', { class: `conf-dot ${g.confidence}`, 'aria-hidden': 'true' }), CONFIDENCE[g.confidence]),
    h('div', { class: 'hint' }, g.confidence === 'high' ? 'scored on the lift itself' : `${g.best.exercise}, converted`)]
  : '—';
/** Points into the current level, 0–99; null at Elite or without a score. */
const intoLevel = (score) => (score === null || score >= 500 ? null : score % 100);

function focusCard(items) {
  return card('Focus next', 'What would change these numbers most',
    h('ul', { class: 'focus-list' }, items.map((f) => h('li', { class: `focus-item ${f.kind}` }, h('b', {}, f.title), h('span', { class: 'hint' }, f.detail)))));
}
const liftText = (l) => `${l.weight === null ? 'BW' : `${n1(l.weight)} kg`} × ${l.reps}`;

/** A group's score over the trend, as a small line; scaled to at least 40 points so a flat line looks flat. */
function scoreSparkline(values, label) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined);
  if (pts.length < 2) return null;
  const W = 72, H = 22, n = values.length - 1;
  const vs = pts.map(([, v]) => v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 40) {
    const mid = (hi + lo) / 2;
    lo = mid - 20;
    hi = mid + 20;
  }
  const x = (i) => 1 + (i / n) * (W - 2);
  const y = (v) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
  return svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': label },
    svg('polyline', { points: pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') }));
}

/** Points into the level, as a bar, with what's left to the next one. */
function levelProgress(score, next) {
  const into = intoLevel(score);
  if (into === null) return null;
  return h('div', { class: 'lvl-prog', role: 'img', 'aria-label': `${into}% of the way to ${next?.level ?? 'the next level'}` },
    h('span', { style: { width: `${into}%` } }));
}

// The figure picks out a group; the table rows pick out the same one.
let showFigureGroup = () => {};

/** The figure: hovering, clicking or tabbing to a muscle names its group and picks out its row. */
function bodyFigure(d) {
  const wrap = h('div', { class: 'figure-wrap' });
  // Built by the server from fixed shapes; group names are escaped there.
  wrap.innerHTML = figureMode === 'relative' && d.figureRelative ? d.figureRelative : d.figure;
  const readout = h('p', { class: 'hint figure-readout', 'aria-live': 'polite' }, 'Point at a muscle, or tab to its number, to see its score.');
  const byId = new Map(d.scores.groups.map((g) => [g.id, g]));
  const show = (id) => {
    const g = byId.get(id);
    if (!g) return;
    readout.textContent = `${g.name}: ${g.score ?? '—'} · ${levelText(g)}${g.best ? ` — ${g.best.exercise}, ${liftText(g.best)}` : ''}`;
    wrap.querySelectorAll('.bf-m, .bf-num').forEach((m) => m.classList.toggle('bf-on', m.dataset.group === id));
    document.querySelectorAll('.strength-row').forEach((r) => r.classList.toggle('on', r.dataset.group === id));
  };
  showFigureGroup = show;
  wrap.addEventListener('pointerover', (e) => e.target.dataset?.group && show(e.target.dataset.group));
  wrap.addEventListener('click', (e) => e.target.dataset?.group && show(e.target.dataset.group));
  wrap.addEventListener('focusin', (e) => e.target.dataset?.group && show(e.target.dataset.group));
  const mode = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Shading' },
    [['relative', 'vs your average'], ['level', 'Level']].map(([v, name]) =>
      h('button', { type: 'button', role: 'radio', class: v === figureMode ? 'on' : '', 'aria-checked': String(v === figureMode), onclick: () => {
        figureMode = v;
        remember('raqib.figureMode', v);
        render();
      } }, name)));
  return [h('div', { class: 'row figure-mode' }, mode), wrap, readout, h('div', { class: 'chart-legend figure-legend' }, FIGURE_LEGEND[figureMode].map(([cls, name]) => h('span', {}, h('i', { class: `key bf-key ${cls}` }), name)))];
}

function balanceRow(p) {
  const lean = p.diff === null ? 0 : Math.max(-1, Math.min(1, p.diff / 200));
  return h('div', { class: 'bal' },
    h('div', { class: 'bal-names' }, h('span', {}, `${p.a.name} `, h('b', { class: 'num' }, p.a.score ?? '—')), h('span', {}, h('b', { class: 'num' }, p.b.score ?? '—'), ` ${p.b.name}`)),
    h('div', { class: 'bal-track', role: 'img', 'aria-label': p.message },
      h('i', { class: 'bal-mid' }),
      p.diff !== null ? h('span', { class: `bal-fill${p.status === 'balanced' ? ' ok' : ''}`, style: lean < 0 ? { left: '50%', width: `${-lean * 50}%` } : { right: '50%', width: `${lean * 50}%` } }) : null),
    h('p', { class: 'hint' }, p.status === 'balanced' ? '✓ Balanced' : p.status === 'unknown' ? p.message : `⚠ ${p.message}`));
}

/** The next level and, when that's far, a nearer step; with how big a jump it is on the bar. */
function nextCell(g) {
  if (!g.next || !g.best) return '—';
  const jump = g.best.weight && g.next.weight ? Math.round(((g.next.weight - g.best.weight) / g.best.weight) * 100) : null;
  return [
    g.milestone ? [h('div', {}, `Next +25: ${liftText(g.milestone)}`), h('div', { class: 'hint' }, `on ${g.best.exercise}`)] : null,
    h('div', { class: g.milestone ? 'hint' : '' }, `${g.next.level}: ${liftText(g.next)}${jump !== null && jump > 0 ? ` (+${jump}%)` : ''}`),
    g.milestone ? null : h('div', { class: 'hint' }, `on ${g.best.exercise}`),
  ];
}

async function trainingStrength(key) {
  let d;
  try {
    d = await api(`/training/strength?date=${key}&standards=${strengthStandards}`);
  } catch (error) {
    // This page is read from disk on each load, the server only at start: a tracker started
    // before the strength score was added has no route for it yet.
    if (error.message !== 'Not found') throw error;
    return card('Strength score', 'Needs a restart', h('p', { class: 'empty' }, 'رقيب was started before the strength score was added. Restart it (raqib stop, then raqib start) to see this page.'));
  }
  const s = d.scores;
  if (s.bodyweight === null) {
    return card('Strength score', 'Scores are for your bodyweight', h('p', { class: 'empty' }, 'Log a weigh-in under Food and weight first.'));
  }
  // Weekly up to today: five points back is four weeks ago.
  const then = d.trend.at(-5)?.overall ?? null;
  const change = s.overall !== null && then !== null ? s.overall - then : null;
  const b = d.balance;
  const scored = s.groups.filter((g) => g.score !== null);
  const off = b.pairs.filter((p) => p.status !== 'balanced');
  const overallInto = intoLevel(s.overall);
  const overallNext = s.overall !== null && s.overall < 500 ? (Math.floor(s.overall / 100) + 1) * 100 : null;
  const nextName = overallNext ? ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'][overallNext / 100 - 1] : null;
  const weighed = s.bodyweightDay ? `weighed ${shortDay(s.bodyweightDay)}` : 'bodyweight';
  const gains = (d.gains ?? []).filter((g) => g.change > 0).slice(0, 3);
  return [
    h('div', { class: 'stats' },
      stat('Strength score', s.overall ?? '—', s.overall === null ? 'no recent lifts' : `${s.overallLevel ?? 'Below beginner'}${overallNext ? ` · ${overallNext - s.overall} to ${nextName}` : ''}`),
      stat('Upper body', s.upper ?? '—', 'chest, back, shoulders, arms'),
      stat('Lower body', s.lower ?? '—', 'quads, glutes, hamstrings'),
      stat('Last 4 weeks', change === null ? '—' : `${change > 0 ? '+' : ''}${change}`, `points overall · ${n1(s.bodyweight)} kg, ${weighed}`),
    ),
    overallInto !== null ? h('div', { class: 'overall-prog' },
      h('span', { class: 'hint' }, `${s.overallLevel ?? 'Below beginner'} ${Math.floor(s.overall / 100) * 100}`),
      h('div', { class: 'lvl-prog wide', role: 'img', 'aria-label': `${overallInto}% of the way to ${nextName}` }, h('span', { style: { width: `${overallInto}%` } })),
      h('span', { class: 'hint' }, `${nextName} ${overallNext}`)) : null,
    d.focus?.length ? h('div', { style: { marginBottom: '16px' } }, focusCard(d.focus)) : null,
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'stack' },
        card('Muscle levels', figureMode === 'relative' ? 'Each group against the average of the others' : 'Each group shaded by its level: darker is stronger', ...bodyFigure(d)),
        card('Over 6 months', 'Overall score, week by week',
          timeChart({ label: 'Overall strength score week by week', height: 170, series: [{ name: 'Strength score', cls: 'actual', dots: true, points: d.trend.filter((p) => p.overall !== null).map((p) => ({ day: p.day, v: p.overall })) }], format: (v) => String(Math.round(v)) }),
          gains.length ? h('p', { class: 'hint gains' }, 'Biggest gains: ', gains.map((g, i) => [i ? ', ' : '', h('b', {}, `${g.name} +${g.change}`)])) : null),
      ),
      h('div', { class: 'stack' },
        card('Strength balance', 'Groups 40+ points apart are out of balance',
          scored.length < 3
            ? h('p', { class: 'empty' }, 'Train at least three muscle groups to see how they balance.')
            : [
                off.length ? null : h('p', { class: 'hint' }, '✓ Every pair is within 40 points.'),
                b.pairs.map(balanceRow),
                b.leading.length ? h('p', { class: 'hint' }, `Strongest: ${b.leading.map((g) => `${g.name} (+${g.ahead})`).join(', ')}.`) : null,
              ]),
      ),
    ),
    h('div', { style: { marginTop: '16px' } }, card('Muscle groups', 'Best lift in 90 days, as a 1RM on the reference lift for your weight; 100 points a level',
      h('table', { class: 'plan-table strength-table' },
        h('thead', {}, h('tr', {}, ['Group', 'Score · 6 months', 'Level', 'Best lift', 'Confidence', 'Next'].map((t) => h('th', {}, t)))),
        h('tbody', {}, s.groups.map((g) => h('tr', { class: 'strength-row', 'data-group': g.id, onpointerenter: () => showFigureGroup(g.id) },
          h('td', {}, h('b', {}, g.name)),
          h('td', {}, h('div', { class: 'score-cell' }, h('span', { class: 'num' }, g.score ?? '—'), scoreSparkline(d.trend.map((p) => p.groups[g.id] ?? null), `${g.name} over 6 months`))),
          h('td', {}, h('span', { class: `badge${g.level ? ' accent' : ''}` }, levelText(g)), levelProgress(g.score, g.next)),
          h('td', {}, g.best
            ? [h('div', {}, g.best.exercise), h('div', { class: 'hint' }, `${liftText(g.best)} · ${shortDay(g.best.day)}`),
                g.lapsed ? h('div', { class: 'hint warn-ink' }, `Not trained in 90 days · kept until ${shortDay(g.keptUntil)}`)
                  : g.keptUntil && parseDay(g.keptUntil) - parseDay(key) <= 21 * 86400000 ? h('div', { class: 'hint warn-ink' }, `Ages out after ${shortDay(g.keptUntil)}`) : null]
            : h('span', { class: 'hint' }, `Log a ${g.reference.toLowerCase()} or similar`)),
          h('td', {}, confidenceCell(g)),
          h('td', {}, nextCell(g)),
        )))),
      s.uncounted?.length ? h('details', { class: 'uncounted' }, h('summary', { class: 'hint' }, `${s.uncounted.length} logged ${s.uncounted.length === 1 ? 'lift counts' : 'lifts count'} toward no group (isolation work, or a lift it doesn't know)`), h('p', { class: 'hint' }, s.uncounted.join(' · '))) : null,
      h('p', { class: 'hint', style: { marginTop: '12px' } },
        `${strengthStandards === 'women' ? "Women's" : "Men's"} standards (change in `, h('a', { href: '#settings' }, 'Settings'), '). Dumbbell, cable and machine lifts convert conservatively; sets over 15 reps don\'t count.'))),
  ];
}

function flaggedCard(list) {
  return card('Check these sets', 'Imported sets that look like typos are left out of the plan until you keep or remove them',
    h('ul', { class: 'list' }, list.slice(0, 20).map((s) => h('li', {},
      h('span', { class: 'grow' }, h('div', { class: 'text' }, s.exercise), h('div', { class: 'hint' }, `${shortDay(s.day)} · ${s.reps ?? '?'} × ${n1(s.weight)} kg`)),
      h('button', { class: 'btn sm', onclick: () => act(() => api(`/training/flagged/${s.id}`, { method: 'POST' })) }, 'It was right'),
      h('button', { class: 'btn sm ghost danger', onclick: () => act(() => api(`/exercise/sets/${s.id}`, { method: 'DELETE' })) }, 'Remove'),
    ))),
    list.length > 20 ? h('p', { class: 'hint' }, `… and ${list.length - 20} more`) : null);
}

// ---- one exercise

async function exercisePage(id) {
  setTopnav(null);
  const v = await api(`/training/exercises/${id}`);
  const e = v.exercise;
  const p = v.progress;
  const sug = v.suggestion;
  const first = v.checkpoints[0]?.day ?? today();
  const from = v.sessions.length ? (v.sessions[0].day > shiftDay(first, -365) ? v.sessions[0].day : shiftDay(first, -365)) : shiftDay(first, -30);
  const shown = v.sessions.filter((s) => s.day >= from);
  const sessionNote = (s) => [repsText(s.reps), s.formReset ? 'form reset' : null, s.copied ? 'maybe copied' : null].filter(Boolean).join(' · ');
  const chart = timeChart({
    label: `${e.name}: working weight against the plan`,
    from,
    to: v.checkpoints.at(-1)?.day,
    yFloor: e.bodyweight ? 0 : null,
    series: [
      { name: 'Plan', cls: 'aim', dashed: true, points: v.checkpoints.map((c) => ({ day: c.day, v: c.weight })) },
      { name: 'Working weight', cls: 'actual', dots: true, points: shown.map((s) => ({ day: s.day, v: s.weight, note: sessionNote(s), faded: s.copied })) },
    ],
    markers: [
      ...v.checkpoints.map((c) => ({ day: c.day, v: c.weight, cls: 'aim', shape: 'diamond', label: `${c.label} goal: ${wLabel(c.weight, e)}` })),
      ...shown.filter((s) => s.formReset).map((s) => ({ day: s.day, v: s.weight, cls: 'reset', shape: 'square', label: 'Form reset: lowered on purpose' })),
    ],
    format: (val) => (e.bodyweight ? (Math.round(val * 10) / 10 === 0 ? 'BW' : `+${n1(val)}`) : n1(val)),
  });
  const rows = [...v.sessions].reverse().slice(0, 40);
  return [
    h('div', { class: 'page-head' },
      h('div', {}, h('p', {}, h('a', { href: '#health' }, 'Health'), ' › ', v.day), h('h1', {}, e.name),
        h('p', {}, `${e.sets} × ${e.repMin}–${e.repMax} · step ${n1(e.step)} kg${e.laterSlot ? ' · later slot' : ''}${e.perHand ? ' · per hand' : ''}${e.perSide ? ' · per side' : ''}${e.bodyweight ? ' · weight = added load' : ''}`)),
      statusBadge(p),
    ),
    h('div', { class: 'stats' },
      stat('Next time', `${v.suggestedLabel} × ${sug.sets} sets`, sug.setsReason ? sug.setsReason : sug.beat ? `beat ${repsText(sug.beat)}` : sug.verdict ? sug.verdict.message : 'from the plan'),
      stat('Now', v.currentLabel ?? '—', sug.verdict && sug.last ? h('span', {}, verdictBadge(sug.verdict), ` ${repsText(sug.last.reps)} on ${shortDay(sug.last.day)}`) : 'no sessions yet'),
      stat('Goal', p ? wLabel(p.goal.weight, e) : '—', p ? `by ${shortDay(p.goal.day)} · ${pct(p.ratio)} · expected now ${wLabel(Math.round(p.expected * 2) / 2, e)}` : null),
      stat('Add weight at', `${sug.threshold} reps`, `total; no set under ${sug.lowestOk}${e.laterSlot ? ' (lowered: later slot)' : ''}`),
    ),
    v.flags.length ? h('div', { class: 'callout', style: { marginBottom: '16px' } }, v.flags.map((f) => h('div', {}, f.message))) : null,
    card('Working weight against the plan', v.comparedWith === 'history' ? 'Verdicts compare with imported history until you log it on its plan day' : null,
      chart,
      chartLegend([['actual', 'Working weight'], ['aim dashed', 'Plan'], ['aim diamond', 'Checkpoint goal'], ['reset square', 'Form reset']]),
    ),
    h('div', { class: 'grid cols-2', style: { marginTop: '16px' } },
      card('Sessions', `${v.sessions.length} in all`,
        rows.length
          ? h('table', { class: 'plan-table' },
              h('thead', {}, h('tr', {}, ['Day', 'Weight', 'Reps', 'Verdict', ''].map((t) => h('th', {}, t)))),
              h('tbody', {}, rows.map((s) => h('tr', { class: s.copied ? 'faded' : '' },
                h('td', {}, shortDay(s.day)),
                h('td', { class: 'num' }, wLabel(s.weight, e)),
                h('td', { class: 'num' }, repsText(s.reps)),
                h('td', {}, verdictBadge(s.verdict)),
                h('td', { class: 'hint' }, [s.formReset ? 'form reset' : null, s.copied ? 'maybe copied' : null, s.planDayId === null ? 'imported' : null, s.note].filter(Boolean).join(' · ')),
              ))))
          : h('p', { class: 'empty' }, 'No sessions yet.')),
      exerciseEditCard(v),
    ),
  ];
}

function exerciseEditCard(v) {
  const e = v.exercise;
  const field = (label, value, step = 1) => {
    const input = h('input', { type: 'number', value, step, min: 0, class: 'num-in' });
    return [h('label', { class: 'field' }, h('span', {}, label), input), input];
  };
  const [setsF, sets] = field('Sets', e.sets);
  const [loF, lo] = field('Reps from', e.repMin);
  const [hiF, hi] = field('to', e.repMax);
  const [stepF, step] = field('Step kg', e.step, 0.5);
  const later = h('input', { type: 'checkbox', checked: e.laterSlot });
  const perHand = h('input', { type: 'checkbox', checked: e.perHand });
  const perSide = h('input', { type: 'checkbox', checked: e.perSide });
  const aliases = h('input', { type: 'text', value: e.aliases.join(', '), placeholder: 'Other names in your history, comma separated' });
  const goals = v.checkpoints.map((c) => [c, h('input', { type: 'number', value: c.weight, step: e.step, min: 0, class: 'num-in', 'aria-label': `Goal at ${c.label}` })]);
  const save = oneAtATime(async () => {
    try {
      await api(`/training/exercises/${e.id}`, {
        method: 'PATCH',
        body: {
          sets: Number(sets.value), repMin: Number(lo.value), repMax: Number(hi.value), step: Number(step.value), laterSlot: later.checked, perHand: perHand.checked, perSide: perSide.checked,
          aliases: aliases.value.split(',').map((a) => a.trim()).filter(Boolean),
          goals: goals.map(([c, input]) => ({ day: c.day, weight: input.value === '' ? null : Number(input.value) })),
        },
      });
      say('Plan saved');
      await render();
    } catch (error) {
      handle(error);
    }
  });
  return card('Edit in the plan', null,
    h('div', { class: 'row', style: { alignItems: 'flex-end' } }, setsF, loF, hiF, stepF, h('label', { class: 'check' }, later, ' Later slot'), h('label', { class: 'check' }, perHand, ' Per hand'), h('label', { class: 'check' }, perSide, ' Per side')),
    h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', {}, 'Also called'), aliases),
    h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, h('table', { class: 'plan-table goal-table' },
      h('thead', {}, h('tr', {}, goals.map(([c]) => h('th', {}, c.label)))),
      h('tbody', {}, h('tr', {}, goals.map(([, input]) => h('td', {}, input)))))),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn primary', onclick: save }, 'Save')),
  );
}

let healthTab = (() => {
  try {
    return localStorage.getItem('raqib.healthTab') === 'exercise' ? 'exercise' : 'food';
  } catch {
    return 'food';
  }
})();

async function healthPage(date) {
  const key = date && date <= today() ? date : today();
  setTopnav(key, '#health');
  const tab = healthTab;
  const tabs = h(
    'div',
    { class: 'seg', role: 'tablist', 'aria-label': 'Health' },
    [['food', 'Food and weight'], ['exercise', 'Exercise']].map(([t, name]) =>
      h('button', {
        type: 'button',
        role: 'tab',
        class: t === tab ? 'on' : '',
        'aria-selected': String(t === tab),
        onclick: () => {
          healthTab = t;
          try {
            localStorage.setItem('raqib.healthTab', t);
          } catch {}
          render();
        },
      }, name),
    ),
  );
  const head = h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Health'), h('p', {}, key === today() ? `Today, ${longDate(key)}` : longDate(key))), tabs);
  if (tab === 'exercise' && exerciseView !== 'log') {
    const body =
      exerciseView === 'plan' ? await trainingPlan()
      : exerciseView === 'plans' ? await trainingPlans()
      : exerciseView === 'progress' ? await trainingProgress(key)
      : exerciseView === 'strength' ? await trainingStrength(key)
      : await trainingToday(key);
    return [head, exerciseViewTabs(), body];
  }
  if (tab === 'exercise') {
    const v = await api(`/exercise?date=${key}`);
    return [
      head,
      exerciseViewTabs(),
      h('datalist', { id: 'exercise-names' }, v.recent.map((name) => h('option', { value: name }))),
      exerciseStats(v),
      h(
        'div',
        { class: 'grid cols-2' },
        h('div', { class: 'stack' }, v.workouts.map((w) => workoutCard(w, v)), newWorkoutCard(v, key)),
        h('div', { class: 'stack' }, trainingWeekCard(v), recordsCard(v), importCard()),
      ),
    ];
  }
  const v = await api(`/health?date=${key}`);
  return [
    head,
    healthStats(v, key),
    h(
      'div',
      { class: 'grid cols-2' },
      h('div', { class: 'stack' }, foodCard(v, key)),
      h('div', { class: 'stack' }, weightCard(v, key), caloriesWeekCard(v), targetsCard(v)),
    ),
  ];
}

// ------------------------------------------------------------------ router

function closeOr(hash) {
  window.close();
  // Only windows opened by a script or a launcher can close themselves.
  setTimeout(() => (location.hash = hash), 150);
}

function handle(error) {
  if (error instanceof SignedOut) showSignedOut();
  else say(error.message ?? String(error), true);
}

function showSignedOut() {
  main.replaceChildren(
    h(
      'div',
      { class: 'signed-out' },
      h('img', { src: '/ui/icon.svg', alt: '', width: 64, height: 64 }),
      h('h1', { style: { margin: '14px 0 8px' } }, 'Open رقيب from your PC'),
      h('p', { class: 'hint' }, 'For your privacy this page only works when رقيب opens it. Use the رقيب shortcut in the Start menu, or run ', h('code', {}, 'npm run raqib -- open'), ' in its folder.'),
    ),
  );
}

const PAGES = { today: todayPage, morning: morningPage, evening: eveningPage, back: backPage, week: weekPage, projects: projectsPage, health: healthPage, exercise: exercisePage, reminders: remindersPage, settings: settingsPage };
const TITLES = { today: 'Today', morning: 'Morning', evening: 'Evening log', back: 'Welcome back', week: 'Week', projects: 'Projects', health: 'Health', exercise: 'Exercise', reminders: 'Reminders', settings: 'Settings' };
let rendering = 0;

// The demo profile (raqib demo) shows only the tabs chosen for it; null otherwise.
let demoTabs = null;
const allowed = (page) => !demoTabs || demoTabs.includes(page === 'exercise' ? 'health' : page);

async function render() {
  const [page = 'today', date] = location.hash.replace(/^#/, '').split('/');
  if (!allowed(PAGES[page] ? page : 'today')) {
    location.replace(`#${demoTabs[0]}`);
    return;
  }
  const view = PAGES[page] ? page : 'today';
  for (const link of document.querySelectorAll('.nav')) link.classList.toggle('active', link.dataset.page === (view === 'exercise' ? 'health' : view));
  if (view !== 'today' && view !== 'evening' && view !== 'health') setTopnav(null);
  document.body.classList.toggle('compact', view === 'back');
  document.title = `رقيب · ${TITLES[view]}`;
  const ticket = ++rendering;
  const scroll = window.scrollY;
  try {
    const arg = view === 'back' || view === 'projects' || view === 'exercise' ? date : /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : undefined;
    const content = await PAGES[view](arg);
    if (ticket !== rendering) return;
    main.replaceChildren(...[content].flat(Infinity).filter((node) => node !== null && node !== undefined && node !== false));
    window.scrollTo(0, scroll);
  } catch (error) {
    if (ticket !== rendering) return;
    if (error instanceof SignedOut) showSignedOut();
    else main.replaceChildren(h('p', { class: 'empty' }, `Couldn't load this page: ${error.message}`));
  }
}

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  render();
});
// Icons for the rail, and the clock in the title bar.
for (const link of document.querySelectorAll('.nav[data-icon]')) link.prepend(icon(link.dataset.icon));
document.querySelector('[data-foot] b')?.prepend(icon('shield'));
const tick = () => (document.getElementById('clock').textContent = clock(Date.now()));
tick();
setInterval(tick, 15_000);
// Keep "today" fresh while the window stays open.
setInterval(() => {
  const page = location.hash.replace(/^#/, '').split('/')[0] || 'today';
  if (page === 'today' && !document.querySelector('input:focus, select:focus, textarea:focus')) render();
}, 60_000);
api('/status')
  .then((status) => {
    if (!status?.demo) return;
    demoTabs = status.demo.tabs;
    document.body.classList.add('demo');
    for (const link of document.querySelectorAll('.nav[data-page]')) link.hidden = !demoTabs.includes(link.dataset.page);
    const brand = document.querySelector('.brand');
    if (brand) brand.href = `#${demoTabs[0]}`;
  })
  .catch(() => {})
  .finally(render);
