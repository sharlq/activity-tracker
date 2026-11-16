// Makes a plan in the gym app from what you actually do in Caliber: one day per workout
// title you've done lately (Chest, Back, Legs…), with the exercises of your last session
// of it plus any you did in 2 of the last 4, in your order, with the sets you usually do.
// An exercise that's already in another plan keeps its reps, step, rest and goals there.
// Running it again remakes the plan of that name.
//
//   SYNC_KEY=... npm run import-caliber-plan -- <strength_workouts.csv>
//     [--name "Chest / Back / Legs"] [--days Chest,Back,Legs] [--activate]
//   (uses CONVEX_URL, or VITE_CONVEX_URL from .env.local; SYNC_KEY, or the PC's gym-sync.json)
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { convexMutation, loadGymTarget } from '../../tracker/src/gymSync.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function envFile(): Record<string, string> {
  const file = new URL('../.env.local', import.meta.url);
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8').split(/\r?\n/).map((l) => /^([A-Z_]+)=(.*?)(\s*#.*)?$/.exec(l.trim())).filter((m): m is RegExpExecArray => m !== null).map((m) => [m[1] as string, m[2] as string]),
  );
}

/** One CSV line: quoted cells, "" for a quote. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

const file = process.argv.slice(2).find((a) => a.toLowerCase().endsWith('.csv'));
if (!file) {
  console.error('Usage: npm run import-caliber-plan -- <strength_workouts.csv> [--name "…"] [--days A,B] [--activate]');
  process.exit(1);
}
const [header, ...lines] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
const col = cells(header ?? '').map((h) => h.trim().toLowerCase());
const at = (name: string) => {
  const i = col.indexOf(name);
  if (i < 0) throw new Error(`${file} has no "${name}" column`);
  return i;
};
const [D, T, E, R] = [at('date'), at('title'), at('exercise'), at('reps')];
const rows = lines.map(cells).map((c) => ({ day: c[D] ?? '', title: (c[T] ?? '').trim(), exercise: (c[E] ?? '').trim(), reps: Number(c[R]) })).filter((r) => r.day && r.title && r.exercise);

// The titles you've done in the file's last 30 days, most done first.
const last = rows.map((r) => r.day).sort().at(-1) ?? '';
const since = new Date(Date.parse(last) - 30 * 86_400_000).toISOString().slice(0, 10);
const sessionsOf = (title: string) => [...new Set(rows.filter((r) => r.title === title).map((r) => r.day))].sort();
const titles = arg('--days')?.split(',').map((t) => t.trim()) ??
  [...new Set(rows.filter((r) => r.day >= since).map((r) => r.title))].sort((a, b) => sessionsOf(b).length - sessionsOf(a).length);

const days = titles.map((title) => {
  const recent = sessionsOf(title).slice(-4);
  if (recent.length === 0) throw new Error(`No workouts called "${title}" in ${file}`);
  const latest = recent.at(-1);
  const seen = new Map<string, { sessions: Set<string>; places: number[]; sets: number[]; reps: number[] }>();
  for (const day of recent) {
    const order = [...new Set(rows.filter((r) => r.title === title && r.day === day).map((r) => r.exercise))];
    for (const [i, name] of order.entries()) {
      const s = seen.get(name) ?? { sessions: new Set(), places: [], sets: [], reps: [] };
      const sets = rows.filter((r) => r.title === title && r.day === day && r.exercise === name);
      s.sessions.add(day);
      s.places.push(i / Math.max(1, order.length - 1));
      s.sets.push(sets.length);
      s.reps.push(...sets.map((r) => r.reps).filter(Number.isFinite));
      seen.set(name, s);
    }
  }
  const mostOf = (xs: number[]) => [...xs].sort((a, b) => xs.filter((x) => x === b).length - xs.filter((x) => x === a).length || b - a)[0] ?? 3;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const exercises = [...seen.entries()]
    .filter(([, s]) => s.sessions.has(latest as string) || s.sessions.size >= 2)
    .sort(([, a], [, b]) => avg(a.places) - avg(b.places))
    .map(([name, s]) => {
      const top = Math.max(...s.reps);
      const [repMin, repMax] = top >= 12 ? [10, 15] : top >= 10 ? [8, 12] : [6, 10];
      return { name, sets: Math.min(10, Math.max(1, mostOf(s.sets))), repMin, repMax };
    });
  return { name: title, exercises };
});

const env = envFile();
const pc = loadGymTarget(process.env['ACTIVITY_TRACKER_HOME'] ?? join(homedir(), '.activity-tracker'));
const url = (process.env['CONVEX_URL'] ?? env['VITE_CONVEX_URL'] ?? pc?.url)?.replace(/\/+$/, '');
const key = process.env['SYNC_KEY'] ?? (process.env['CONVEX_URL'] ? pc?.syncKey : env['SYNC_KEY'] ?? pc?.syncKey);
if (!url || !key) {
  console.error('Set SYNC_KEY and CONVEX_URL (or have gym/.env.local, or the PC\'s gym-sync.json).');
  process.exit(1);
}
const name = arg('--name') ?? titles.join(' / ');
type Made = { day: string; name: string; sets: number; reps: string; known: boolean };
const r = (await convexMutation({ url, syncKey: key }, 'sync:importPlan', { name, days, activate: process.argv.includes('--activate') })) as { replaced: boolean; made: Made[] };
console.log(`${r.replaced ? 'Remade' : 'Made'} "${name}" at ${url}: ${days.length} days, ${r.made.length} exercises (* = new, not in another plan)`);
for (const d of days) console.log(`  ${d.name}: ${r.made.filter((m) => m.day === d.name).map((m) => `${m.name} ${m.sets}×${m.reps}${m.known ? '' : '*'}`).join(', ')}`);
