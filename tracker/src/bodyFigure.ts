// A human figure, front and back, drawn like an anatomy chart, with each scored muscle group
// shaded by its strength level (strength.ts). Built as an SVG string so the PC window and the phone draw the same
// one. The shading is classes each page colours from its own palette: by level (bf-l0 …
// bf-l5, one hue, lighter to darker as the level rises) or against your average (bf-r-far,
// bf-r-behind, bf-r-near, bf-r-ahead), with bf-none for no score. Each group's score is
// written on it, and those numbers are what a keyboard tabs to.
import type { GroupId } from './strength.ts';

export interface FigureGroup {
  id: GroupId;
  name: string;
  score: number | null;
  level: string | null;
}

const W = 200;
const H = 476;
const mirror = `transform="matrix(-1 0 0 1 ${W} 0)"`;

// An anatomy-chart figure: a grey body with each muscle drawn on it as its own outlined shape,
// hatched with fibre lines that run the way the muscle does. Everything is drawn for the
// figure's left half (x < 100) and mirrored for the right.

/** The body outline without the arm: neck, traps, torso, hip, leg, foot. */
// The outline follows the muscles under it: a thick neck sloping into the traps, a capped
// shoulder, a V-taper to a narrow waist, a sweep of quad that pinches in at the knee, a calf
// bulge down to a slim ankle, and a foot turned slightly out.
const TORSO_LEG =
  'M100,66 L91,64 Q89,68 88.5,71 Q77,70 59,78 L57,112 Q56,120 58,126 Q64,146 69,166 Q71,174 69,182 Q67,188 66,194 ' +
  'Q62,206 60,220 Q56,240 57,258 Q58,280 61,296 Q62,302 61,310 Q59,318 58,326 Q54,340 56,356 Q59,378 66,394 Q71,402 71,410 ' +
  'Q69,420 64,430 Q60,436 61,441 Q63,446 70,447 L84,448 Q92,448 94,444 Q95,438 93,430 Q91,422 90,412 ' +
  'Q89,398 90,386 Q95,370 95,356 Q95,336 93,324 Q92,318 93,312 Q96,304 96,290 Q97,262 98,250 Q99,240 100,232 Z';
const ARM =
  'M59,78 C48,76 37,82 34,94 Q31,104 33,114 Q32,118 31,122 Q28,136 29,150 Q29,160 30,166 Q22,176 22,190 ' +
  'Q23,208 29,222 Q30,226 31,230 L43,230 Q45,214 49,198 Q53,182 52,170 Q51,166 52,162 Q56,148 56,132 Q56,118 57,112 Z';
const HAND = 'M31,229 Q26,238 26,250 Q27,262 31,267 Q34,270 38,268 Q42,264 43,256 Q44,244 43,229 Z';
/** Lines drawn over the body: the gaps between the toes. */
const TOES = 'M65.5,446 L66,442 M71,447 L71,442.5 M76.5,447.5 L76.5,443 M83,448 L83,443';
const HEAD =
  '<ellipse cx="84" cy="38" rx="2.4" ry="5"/><ellipse cx="116" cy="38" rx="2.4" ry="5"/>' +
  '<path class="bf-head" d="M100,12 C90,12 84,20 84,31 Q84,42 86.5,50 Q89,58 94,62.5 Q97,65 100,65 Q103,65 106,62.5 Q111,58 113.5,50 Q116,42 116,31 C116,20 110,12 100,12 Z"/>';
const KNEE = '<path class="bf-shade" d="M64,300 Q70,292 80,294 Q90,296 92,306 Q88,318 78,322 Q66,320 64,300 Z"/>';

const DELT = 'M59,79.5 C48,77.5 38.5,83 35.5,94.5 Q33,104 34.5,114 Q38,120 42,118 Q49,108 55,100 Q60,91 62,84 Z';

/** A muscle: the group it shows (null: drawn, not scored), its outline, and its fibres' angle. */
type Muscle = [GroupId | null, string, number];

/** Muscles on the left half of each view. */
const FRONT: Muscle[] = [
  [null, 'M90,63 Q92,72 98,81 L95,82 Q89,74 88,65 Z', -30], // neck
  ['back', 'M90,62 Q89,70 86,73 Q75,77 63,80 Q73,82 84,80 Q88,78 91,74 Z', 72], // upper traps over the collarbone
  ['shoulders', DELT, 12],
  ['chest', 'M99,82 Q84,79 70,83 Q63,88 61,96 Q60,104 64,110 Q72,122 86,124 Q96,124 99,120 Z', 100],
  ['biceps', 'M42,122 Q33,130 32,148 Q34,162 42,166 Q51,160 54,146 Q55,130 51,122 Q47,118 42,122 Z', 0],
  [null, 'M26,170 Q20,184 23,204 Q26,216 31,212 Q33,192 39,172 Q32,165 26,170 Z', 15], // forearm
  [null, 'M41,170 Q36,190 35,212 Q38,227 42,227 Q46,208 49,190 Q52,176 46,166 Z', -10],
  [null, 'M63,112 Q68,118 75,119 Q70,124 64,122 Z', -60], // serratus
  [null, 'M64,125 Q69,130 76,131 Q71,135 65,134 Z', -60],
  [null, 'M65,137 Q70,141 77,142 Q72,146 66,145 Z', -60],
  [null, 'M67,149 Q73,149 80,145 Q84,162 83,180 Q84,192 83,200 Q73,194 69,180 Q68,164 67,149 Z', -35], // obliques
  [null, 'M86,130 Q86,127 89,127 L98.5,127 L98.5,143 L89,143 Q86,143 86,140 Z', 0], // abs
  [null, 'M85,150 Q85,147 88,147 L98.5,147 L98.5,163 L88,163 Q85,163 85,160 Z', 0],
  [null, 'M85,170 Q85,167 88,167 L98.5,167 L98.5,183 L88,183 Q85,183 85,180 Z', 0],
  [null, 'M86,188 L98.5,188 L98.5,224 Q90,212 86,188 Z', 0],
  [null, 'M67,197 Q63,207 63,216 Q66,214 70,206 Q71,199 66,197 Z', 20], // hip
  ['quads', 'M62,212 Q57,240 58,262 Q60,284 65,300 Q71,290 72,268 Q70,238 66,212 Z', 8], // outer quad
  ['quads', 'M69,208 Q80,206 86,220 Q89,250 86,280 Q82,296 76,296 Q74,270 74,244 Q72,222 69,208 Z', 0], // rectus femoris
  ['quads', 'M88,272 Q96,282 95,298 Q92,309 82,308 Q78,302 80,296 Q87,289 88,272 Z', -30], // teardrop
  [null, 'M88,222 Q97,230 99.5,238 Q99,262 93,276 Q90,250 88,222 Z', -20], // adductors
  [null, 'M60,326 Q55,344 57.5,366 Q60,378 63,376 Q61,352 64,328 Z', 4], // outer calf
  [null, 'M67,324 Q63,350 67,380 Q71,396 75,398 Q76,370 76,346 Q74,330 71,322 Z', 4], // shin muscle
  [null, 'M82,322 Q94,334 94,354 Q92,372 88,384 Q81,360 80,336 Z', -4], // inner calf
];
const BACK: Muscle[] = [
  ['back', 'M99,50 L92,52 Q91,64 87,72 Q76,77 64,81 Q72,86 82,90 Q88,104 92,120 Q96,138 99,152 Z', 60], // traps
  ['shoulders', DELT, -12],
  ['back', 'M66,92 Q76,91 84,96 Q88,106 84,114 Q74,114 66,106 Q63,98 66,92 Z', 100], // below the shoulder blade
  ['back', 'M64,110 Q72,116 82,118 Q80,124 72,124 Q66,121 63,116 Z', 110], // teres
  ['back', 'M63,120 Q72,128 84,122 L90,124 Q92,140 92,160 Q90,176 84,188 Q76,190 72,184 Q68,160 66,140 Q64,128 63,120 Z', 135], // lats
  ['triceps', 'M32,120 Q27,138 30,158 Q34,165 40,161 Q41,142 41,124 Q37,118 32,120 Z', 0], // outer head
  ['triceps', 'M43,120 Q53,128 55,142 Q54,156 48,164 Q43,160 43,146 Q43,132 43,120 Z', 0], // long head
  [null, 'M26,170 Q20,184 23,204 Q26,216 31,212 Q33,192 39,172 Q32,165 26,170 Z', 15], // forearm
  [null, 'M41,170 Q36,190 35,212 Q38,227 42,227 Q46,208 49,190 Q52,176 46,166 Z', -10],
  [null, 'M95,156 Q98,172 98.5,200 L98.5,208 Q92,202 90,186 Q90,170 95,156 Z', 0], // lower back
  [null, 'M68,180 Q72,190 80,196 Q76,204 70,204 Q66,196 67,186 Z', -20], // side
  ['glutes', 'M68,204 Q79,197 92,201 Q84,208 72,215 Q68,212 68,204 Z', 60], // upper glute
  ['glutes', 'M99,210 Q85,207 72,216 Q63,227 64,241 Q66,254 76,258 Q88,260 99,256 Z', 120], // glutes
  ['hamstrings', 'M59,258 Q57,276 60,300 Q63,316 71,318 Q75,292 76,265 Q68,254 59,258 Z', 4], // outer hamstring
  ['hamstrings', 'M79,263 Q78,290 80,316 Q87,320 93,313 Q97,290 97,266 Q88,258 79,263 Z', -4], // inner hamstring
  [null, 'M59,326 Q55,342 57.5,364 Q63,378 74,372 Q79,352 78,334 Q72,321 59,326 Z', 4], // calves
  [null, 'M80,326 Q80,350 84,374 Q91,378 94,364 Q95,344 93,326 Q86,319 80,326 Z', -4],
];

const ANGLES = [...new Set([...FRONT, ...BACK].map((m) => m[2]))];
const fibreId = (a: number) => `bf-fibre${a < 0 ? 'm' : ''}${Math.abs(a)}`;
const FIBRES =
  '<defs>' +
  ANGLES.map((a) => `<pattern id="${fibreId(a)}" width="2.6" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(${a})"><line class="bf-fib" x1="0.6" y1="0" x2="0.6" y2="10"/></pattern>`).join('') +
  '</defs>';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 0 below Beginner, 1 Beginner … 5 Elite; null when there's no score. */
export const levelStep = (score: number | null): number | null => (score === null ? null : Math.max(0, Math.min(5, Math.floor(score / 100))));

/**
 * How the muscles are shaded: 'level' by each group's own level, 'relative' against the
 * mean of your other groups (far behind, behind, near, ahead), so a lagging group shows
 * even when most of the body sits in one level.
 */
export type FigureMode = 'level' | 'relative';

/** Points from the mean of the other groups that count as behind or ahead (strength.ts' balance gap). */
const NEAR = 40;
const FAR = 80;

/** Each group's relative class: null without a score, or with under three groups to compare. */
export function relativeSteps(list: readonly FigureGroup[]): Map<GroupId, string> {
  const scored = list.filter((g): g is FigureGroup & { score: number } => g.score !== null);
  const out = new Map<GroupId, string>();
  if (scored.length < 3) return out;
  for (const g of scored) {
    const others = scored.filter((o) => o.id !== g.id);
    const diff = g.score - others.reduce((a, o) => a + o.score, 0) / others.length;
    out.set(g.id, diff <= -FAR ? 'bf-r-far' : diff <= -NEAR ? 'bf-r-behind' : diff >= NEAR ? 'bf-r-ahead' : 'bf-r-near');
  }
  return out;
}

/** Where each group's score sits on its view, in the half-figure's own coordinates (0–200). */
const LABELS: Record<'front' | 'back', [GroupId, number, number][]> = {
  front: [['chest', 80, 103], ['shoulders', 156, 96], ['biceps', 43, 144], ['quads', 125, 254]],
  back: [['back', 78, 150], ['triceps', 160, 140], ['glutes', 82, 233], ['hamstrings', 122, 290]],
};

function view(muscles: Muscle[], groups: Map<GroupId, FigureGroup>, label: string, dx: number, classOf: (g: FigureGroup | undefined) => string, labels: [GroupId, number, number][]): string {
  const titleOf = (id: GroupId) => {
    const g = groups.get(id);
    return g ? `${g.name}: ${g.score === null ? 'no recent lifts' : `${g.score} · ${g.level ?? 'below Beginner'}`}` : id;
  };
  const shape = ([id, d, angle]: Muscle) => {
    const fibres = `<path class="bf-fx" d="${d}" fill="url(#${fibreId(angle)})"/>`;
    if (id === null) return `<path class="bf-core" d="${d}"/>${fibres}`;
    return `<path class="bf-m ${classOf(groups.get(id))}" data-group="${id}" d="${d}"><title>${esc(titleOf(id))}</title></path>${fibres}`;
  };
  // One number per group, which is also how a keyboard reaches it (Tab, then Enter or focus).
  const nums = labels
    .map(([id, x, y]) => {
      const g = groups.get(id);
      if (!g || g.score === null) return '';
      return `<text class="bf-num" data-group="${id}" tabindex="0" role="button" aria-label="${esc(titleOf(id))}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${g.score}</text>`;
    })
    .join('');
  const side = `<path d="${TORSO_LEG}"/><path d="${ARM}"/><path d="${HAND}"/>`;
  const half = KNEE + muscles.map(shape).join('');
  return (
    `<g transform="translate(${dx} 0)">` +
    // Each half is stroked, then both are filled again on top so the outline down the middle
    // (where the halves meet) doesn't show; the head goes over the neck.
    `<g class="bf-body">${side}<g ${mirror}>${side}</g></g>` +
    `<g class="bf-skin">${side}<g ${mirror}>${side}</g></g><g class="bf-body">${HEAD}</g>` +
    `<path class="bf-line" d="${TOES}"/><path class="bf-line" ${mirror} d="${TOES}"/>` +
    `<g>${half}</g><g ${mirror}>${half}</g>` +
    nums +
    `<text class="bf-label" x="${W / 2}" y="${H - 8}" text-anchor="middle">${label}</text>` +
    `</g>`
  );
}

/** Front and back side by side, shaded by level or against your average. */
export function bodyFigureSvg(list: readonly FigureGroup[], mode: FigureMode = 'level'): string {
  const groups = new Map(list.map((g) => [g.id, g]));
  const relative = relativeSteps(list);
  const classOf = (g: FigureGroup | undefined) => {
    if (!g || g.score === null) return 'bf-none';
    if (mode === 'relative') return relative.get(g.id) ?? 'bf-r-near';
    return `bf-l${levelStep(g.score)}`;
  };
  const summary = list.map((g) => `${g.name} ${g.score ?? 'no score'}`).join(', ');
  const what = mode === 'relative' ? 'Muscle scores against your average' : 'Muscle levels';
  return (
    `<svg class="body-figure" viewBox="0 0 ${W * 2 + 20} ${H}" role="group" aria-label="${what} on a body figure: ${esc(summary)}" xmlns="http://www.w3.org/2000/svg">` +
    FIBRES +
    view(FRONT, groups, 'Front', 0, classOf, LABELS.front) +
    view(BACK, groups, 'Back', W + 20, classOf, LABELS.back) +
    `</svg>`
  );
}

/** The legend for the relative shading, behind first. */
export const RELATIVE_LEGEND: [string, string][] = [
  ['bf-none', 'No recent lifts'],
  ['bf-r-far', 'Far behind your average'],
  ['bf-r-behind', 'Behind'],
  ['bf-r-near', 'Near your average'],
  ['bf-r-ahead', 'Ahead'],
];

/** The legend's steps, lowest first. */
export const FIGURE_LEGEND: [string, string][] = [
  ['bf-none', 'No recent lifts'],
  ['bf-l0', 'Below beginner'],
  ['bf-l1', 'Beginner'],
  ['bf-l2', 'Novice'],
  ['bf-l3', 'Intermediate'],
  ['bf-l4', 'Advanced'],
  ['bf-l5', 'Elite'],
];
