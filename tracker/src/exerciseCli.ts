// raqib exercise | workout
//
// Workouts from the command line, so Claude can log "I trained legs for an hour" from a
// chat, and so an export from Caliber (or another app) can be imported.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { HttpError } from './api.ts';
import { id, openJournal, options, parseDay, UsageError } from './cliShared.ts';
import { parseSets, SetSpecError, setsText, volumeOf } from './exercise.ts';
import type { ExerciseHistory, Workout, WorkoutChange } from './journal.ts';
import { minutesOf } from './planner.ts';
import { parseLocalDate } from './dates.ts';
import type { ExerciseView } from './uiExercise.ts';
import { buildExercise, workoutBody } from './uiExercise.ts';
import { importWorkouts, planImport, planMatch } from './workoutImport.ts';
import { weightLabel } from './progression.ts';
import { dashboard, nextPlanDay, planStates, todayView } from './trainingPlan.ts';

export const EXERCISE_USAGE = `  raqib exercise [date] [--json]       The day's workouts (with ids), the last 7 days, and records per exercise
  raqib workout add "Push day" [--kind strength|run|walk|cycle|swim|sport|other] [--min 55] [--kcal 300]
                    [--at 18:30] [--note "..."] [--date D]
                                      Log a workout (also: workout edit <id> [--name ..] [--kind ..] [--min ..], workout rm <id>)
  raqib workout set <id> "Bench press" 3x8@60 [1x6@65] [--lb]
                                      Add sets: 3x8@60, 8@62.5, 8/8/6@60, 3x10 (bodyweight), 3x30s, 5km
                                      (also: workout unset <set id>)
  raqib workout import <file.csv|.json> [more files] [--from caliber] [--units kg|lb] [--dates mdy|dmy] [--dry-run]
                                      Import workouts exported from an app (Caliber's two CSVs are known);
                                      importing again adds nothing twice and updates what changed`;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The window's rules speak HTTP; here a broken rule is a usage mistake. */
function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof HttpError || error instanceof SetSpecError) throw new UsageError(error.message[0]?.toUpperCase() + error.message.slice(1));
    throw error;
  }
}

function number(text: string | undefined, name: string): number | null | undefined {
  if (text === undefined) return undefined;
  if (text === 'none') return null;
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n)) throw new UsageError(`--${name} takes a number, like 45`);
  return n;
}

function atTime(day: string, text: string | undefined): number | null {
  if (text === undefined) return null;
  let minutes: number;
  try {
    minutes = minutesOf(text.length === 4 ? `0${text}` : text);
  } catch {
    throw new UsageError(`"${text}" is not a time like 18:30`);
  }
  const d = new Date(parseLocalDate(day) as number);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function workoutLines(w: Workout): string[] {
  const head = [w.start !== null ? clock(w.start) : null, w.kind, w.minutes !== null ? `${Math.round(w.minutes)} min` : null, w.calories !== null ? `${Math.round(w.calories)} kcal` : null, w.source !== 'manual' ? `from ${w.source}` : null].filter(Boolean);
  const out = [`  #${w.id}  ${w.name}  (${head.join(' · ')})`];
  if (w.note) out.push(`        "${w.note}"`);
  const names = [...new Set(w.sets.map((s) => s.exercise))];
  for (const name of names) {
    const sets = w.sets.filter((s) => s.exercise === name);
    out.push(`        ${name}: ${setsText(sets)}  [set ids ${sets.map((s) => s.id).join(',')}]`);
  }
  const volume = volumeOf(w.sets);
  if (volume) out.push(`        volume ${Math.round(volume).toLocaleString('en-GB')} kg`);
  return out;
}

const historyLine = (h: ExerciseHistory) =>
  `  ${h.exercise}: ${h.best ? `best ${r1(h.best.weight)} kg${h.best.reps !== null ? ` × ${h.best.reps}` : ''} on ${h.best.day}` : 'no weights'} · last ${h.lastDay} (${setsText(h.lastSets)}) · ${h.times} time(s)`;

export function exerciseText(v: ExerciseView): string {
  const out = [`Exercise for ${v.day}`];
  out.push(v.workouts.length ? v.workouts.flatMap(workoutLines).join('\n') : '  No workouts.');
  const done = v.week.filter((d) => d.sessions > 0);
  const sum = (pick: (d: ExerciseView['week'][number]) => number) => v.week.reduce((s, d) => s + pick(d), 0);
  out.push('', `Last 7 days: ${sum((d) => d.sessions)} session(s) on ${done.length} day(s), ${Math.round(sum((d) => d.minutes))} min, volume ${Math.round(sum((d) => d.volume)).toLocaleString('en-GB')} kg`);
  out.push(v.week.map((d) => `  ${d.day}  ${d.sessions ? `${d.sessions} session(s)${d.minutes ? `, ${Math.round(d.minutes)} min` : ''}` : '-'}`).join('\n'));
  if (v.history.length) out.push('', 'Exercises', v.history.map(historyLine).join('\n'));
  return out.join('\n');
}

function exercise(args: string[]): number {
  const { flags, rest } = options(args, [], ['json']);
  const journal = openJournal();
  try {
    const view = buildExercise(journal, parseDay(rest[0]));
    console.log(flags.has('json') ? JSON.stringify(view, null, 2) : exerciseText(view));
    return 0;
  } finally {
    journal.close();
  }
}

function importFile(args: string[]): number {
  const { values, flags, rest: files } = options(args, ['from', 'units', 'dates'], ['dry-run']);
  if (!files.length) throw new UsageError('Usage: raqib workout import <file.csv|.json> [more files] [--from caliber] [--units kg|lb] [--dates mdy|dmy] [--dry-run]');
  const units = values['units']?.toLowerCase().replace(/s$/, '');
  if (units !== undefined && units !== 'kg' && units !== 'lb') throw new UsageError('--units is kg or lb');
  const dates = values['dates']?.toLowerCase();
  if (dates !== undefined && dates !== 'mdy' && dates !== 'dmy') throw new UsageError('--dates is mdy (month first) or dmy (day first)');
  const source = values['from']?.toLowerCase();
  if (source !== undefined && !/^[a-z0-9-]{1,30}$/.test(source)) throw new UsageError('--from is the app\'s name, like caliber');

  // Read every file before writing anything, so one bad file stops them all.
  const read = files.map((file) => {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new UsageError(`Can't read ${file}`);
    }
    try {
      return { file, result: importWorkouts(text, { file, ...(source ? { source } : {}), ...(units ? { units } : {}), ...(dates ? { dateOrder: dates } : {}) }) };
    } catch (error) {
      throw new UsageError(`Can't read ${file}: ${(error as Error).message}`);
    }
  });

  const journal = openJournal();
  try {
    const plans = read.map(({ file, result }) => {
      const { workouts } = result;
      const plan = planImport(journal, workouts);
      const days = workouts.map((w) => w.workout.day).sort();
      const sets = workouts.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
      const exercises = new Set(workouts.flatMap((w) => w.exercises.map((e) => e.name.toLowerCase())));
      const kinds = new Map<string, number>();
      for (const w of workouts) kinds.set(w.workout.kind, (kinds.get(w.workout.kind) ?? 0) + 1);
      console.log(`${basename(file)}${result.profile ? ` (read as ${result.profile})` : ''}`);
      console.log(`  ${workouts.length} workout(s) on ${new Set(days).size} day(s)${days.length ? `, ${days[0]} to ${days.at(-1)}` : ''}: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')}`);
      if (sets) console.log(`  ${sets} set(s) of ${exercises.size} exercise(s)`);
      if (!result.profile) console.log(`  Columns: ${Object.entries(result.columns).map(([field, header]) => `${field}=${header}`).join(', ') || 'none recognised'}`);
      if (sets || result.columns.weight) console.log(`  Weights: ${result.unit === 'per row' ? 'unit given on each row' : result.unit === 'lb' ? 'pounds, saved as kg' : 'kg'}`);
      for (const w of result.warnings) console.log(`  Warning: ${w}`);
      for (const f of result.flagged) console.log(`  Held back: line ${f.row}, ${f.day} ${f.name}: ${f.why}`);
      for (const f of result.flaggedSets.slice(0, 10)) console.log(`  Flagged (imported, left out of the plan until checked): ${f.day} ${f.exercise} ${f.reps ?? '?'} × ${f.weight} kg: ${f.why}`);
      if (result.flaggedSets.length > 10) console.log(`    … and ${result.flaggedSets.length - 10} more flagged set(s)`);
      if (exercises.size) {
        const { planned, unplanned } = planMatch([...new Set(workouts.flatMap((w) => w.exercises.map((e) => e.name)))], journal.planExercises());
        console.log(`  In the plan: ${planned.size} exercise(s)${[...planned].some(([a, b]) => a !== b) ? ` (${[...planned].filter(([a, b]) => a !== b).map(([a, b]) => `${a} → ${b}`).join(', ')})` : ''}; kept as history only: ${unplanned.length}`);
      }
      if (result.skippedCount) console.log(`  Skipped ${result.skippedCount} row(s):\n${result.skipped.map((s) => `    line ${s.row}: ${s.why}`).join('\n')}`);
      console.log(`  ${plan.fresh.length} new, ${plan.changed.length} changed since the last import (their sets will be replaced), ${plan.unchanged} already up to date`);
      for (const w of [...plan.changed, ...plan.fresh].slice(0, 3)) {
        console.log(`    ${w.workout.day}  ${w.workout.name}${w.workout.minutes !== null ? ` (${Math.round(w.workout.minutes)} min)` : ''}: ${w.exercises.map((e) => `${e.name} ${setsText(e.sets)}`).join('; ') || 'no sets'}`);
      }
      if (plan.fresh.length + plan.changed.length > 3) console.log(`    … and ${plan.fresh.length + plan.changed.length - 3} more`);
      return plan;
    });
    if (flags.has('dry-run')) {
      console.log('Dry run: nothing saved.');
      return 0;
    }
    const { added, updated } = journal.saveImported(plans.flatMap((p) => [...p.fresh, ...p.changed]));
    console.log(`Imported: ${added} new workout(s), ${updated} updated.`);
    return 0;
  } finally {
    journal.close();
  }
}

function workout(args: string[]): number {
  const [action, ...rest] = args;
  if (action === 'import') return importFile(rest);
  const journal = openJournal();
  try {
    if (action === 'add') {
      const { values, rest: words } = options(rest, ['kind', 'min', 'kcal', 'at', 'note', 'date']);
      const name = words.join(' ').trim();
      if (!name) throw new UsageError('Usage: raqib workout add "Push day" [--kind strength] [--min 55] [--at 18:30] [--date D]');
      const key = parseDay(values['date']);
      const body = checked(() =>
        workoutBody({ day: key, name, kind: values['kind']?.toLowerCase(), minutes: number(values['min'], 'min'), calories: number(values['kcal'], 'kcal'), note: values['note'], start: atTime(key, values['at']) }),
      );
      const added = journal.addWorkout(body);
      console.log(`Logged for ${key}:\n${workoutLines(added).join('\n')}\nAdd sets with: workout set ${added.id} "Exercise" 3x8@60`);
      return 0;
    }
    if (action === 'set') {
      const { flags, rest: words } = options(rest, [], ['lb']);
      const [workoutId, name, ...spec] = words;
      if (!workoutId || !name || !spec.length) throw new UsageError('Usage: raqib workout set <workout id> "Bench press" 3x8@60 [1x6@65] [--lb]');
      const sets = checked(() => parseSets(spec.join(' '), { lb: flags.has('lb') }));
      const updated = journal.addSets(id(workoutId), name.trim(), sets);
      if (!updated) throw new UsageError(`There is no workout #${workoutId}.`);
      console.log(workoutLines(updated).join('\n'));
      const [history] = journal.exerciseHistory([name.trim()]);
      if (history?.best) console.log(`  ${history.exercise} best: ${r1(history.best.weight)} kg${history.best.reps !== null ? ` × ${history.best.reps}` : ''} on ${history.best.day}`);
      return 0;
    }
    if (action === 'unset') {
      const updated = journal.deleteSet(id(rest[0]));
      if (!updated) throw new UsageError(`There is no set #${rest[0]}.`);
      console.log(`Removed set #${rest[0]}.\n${workoutLines(updated).join('\n')}`);
      return 0;
    }
    if (action === 'edit') {
      const { values, rest: words } = options(rest, ['name', 'kind', 'min', 'kcal', 'note', 'at']);
      const existing = journal.workout(id(words[0]));
      if (!existing) throw new UsageError(`There is no workout #${words[0]}.`);
      const merged = checked(() =>
        workoutBody({
          day: existing.day,
          name: values['name'] ?? existing.name,
          kind: values['kind']?.toLowerCase() ?? existing.kind,
          minutes: values['min'] === undefined ? existing.minutes : number(values['min'], 'min'),
          calories: values['kcal'] === undefined ? existing.calories : number(values['kcal'], 'kcal'),
          note: values['note'] === undefined ? existing.note : values['note'] === 'none' ? null : values['note'],
          start: values['at'] === undefined ? existing.start : values['at'] === 'none' ? null : atTime(existing.day, values['at']),
        }),
      );
      const change: WorkoutChange = { name: merged.name, kind: merged.kind, minutes: merged.minutes, calories: merged.calories, note: merged.note, start: merged.start };
      console.log(workoutLines(journal.updateWorkout(existing.id, change) as Workout).join('\n'));
      return 0;
    }
    if (action === 'rm') {
      const ok = journal.deleteWorkout(id(rest[0]));
      console.log(ok ? `Removed workout #${rest[0]} and its sets.` : `There is no workout #${rest[0]}.`);
      return ok ? 0 : 1;
    }
    throw new UsageError('Usage: raqib workout add|set|unset|edit|rm|import ... (see raqib help)');
  } finally {
    journal.close();
  }
}

// ------------------------------------------------------------------ the training plan

function plan(args: string[]): number {
  const { values, flags, rest } = options(args, ['date', 'day'], ['json']);
  const [action] = rest;
  const date = parseDay(values['date']);
  const journal = openJournal();
  try {
    if (!action || action === 'today') {
      const days = journal.planDays();
      const asked = values['day'];
      const dayId = asked ? days.find((d) => d.name.toLowerCase().replace(/\s+/g, '') === asked.toLowerCase().replace(/\s+/g, '') || String(d.id) === asked)?.id : nextPlanDay(journal);
      if (!dayId) throw new UsageError(`No plan day "${asked}". Days: ${days.map((d) => d.name).join(', ')}`);
      const view = todayView(journal, date, dayId);
      if (!view) throw new UsageError('No such plan day');
      if (flags.has('json')) return console.log(JSON.stringify(view, (k, v) => (k === 'sessions' ? undefined : v), 2)), 0;
      console.log(`${view.day.name} on ${date}${view.day.note ? ` (${view.day.note})` : ''}`);
      for (const e of view.exercises) {
        const s = e.state;
        const sug = s.suggestion;
        const beat = sug.beat ? `, beat ${sug.beat.join('/')}` : '';
        const later = s.exercise.laterSlot ? ' [later slot: lower target]' : '';
        console.log(`  ${s.exercise.position}. ${s.exercise.name}: ${s.suggestedLabel}, ${s.exercise.sets} × ${s.exercise.repMin}–${s.exercise.repMax}${beat}${later}`);
        if (sug.verdict && sug.last) console.log(`     last (${sug.last.day}): ${weightLabel(sug.last.weight, s.rule)} × ${sug.last.reps.join('/')} → ${sug.verdict.message}`);
        if (e.logged.length) console.log(`     today: ${e.logged.map((x) => `${x.reps}@${weightLabel(x.weight ?? 0, s.rule)}`).join(', ')}${e.now ? ` → ${e.now.message}` : ''}`);
        for (const f of s.flags) console.log(`     ! ${f.message}`);
      }
      return 0;
    }
    if (action === 'overview') {
      const { states } = planStates(journal, date);
      if (flags.has('json')) return console.log(JSON.stringify(states, (k, v) => (k === 'sessions' ? undefined : v), 2)), 0;
      for (const s of states) {
        const p = s.progress;
        console.log(`${s.day.padEnd(8)} ${s.exercise.name.padEnd(40)} ${(s.currentLabel ?? '-').padEnd(16)} goal ${p ? `${weightLabel(p.goal.weight, s.rule)} by ${p.goal.day} (${Math.round(p.ratio * 100)}%, ${p.status})` : '-'}${s.flags.length ? `  ! ${s.flags.map((f) => f.kind).join(', ')}` : ''}`);
      }
      return 0;
    }
    if (action === 'progress') {
      const d = dashboard(journal, date);
      if (flags.has('json')) return console.log(JSON.stringify(d, null, 2)), 0;
      const recent = d.weeks.filter((w) => w.recent);
      console.log(`Sessions a week, last 12: ${recent.map((w) => (w.low ? `${w.sessions}!` : String(w.sessions))).join(' ')}  (! under 3)`);
      console.log(`On track: ${d.onTrack.share === null ? '-' : `${Math.round(d.onTrack.share * 100)}%`} of ${d.onTrack.counted}${d.onTrack.behind.length ? `; behind: ${d.onTrack.behind.join(', ')}` : ''}`);
      for (const q of d.quarters) console.log(`  ${q.from} → ${q.to}${q.partial ? ' (so far)' : ''}: median ${q.change === null ? '-' : `${q.change > 0 ? '+' : ''}${q.change}%`}${q.vsPrevious !== null ? ` (${q.vsPrevious > 0 ? '+' : ''}${q.vsPrevious} vs the quarter before)` : ''}`);
      if (d.body.targetToday !== null) console.log(`Bodyweight target today: ${d.body.targetToday} kg${d.body.difference !== null ? `, 7-day average ${d.body.difference > 0 ? '+' : ''}${d.body.difference} kg from it` : ''}`);
      for (const f of d.flags) console.log(`! ${f.message}`);
      if (d.stalled.length) console.log(`Stalled: ${d.stalled.join(', ')}`);
      return 0;
    }
    throw new UsageError('Usage: raqib plan [today] [--day "Upper A"] | plan overview | plan progress [--date D] [--json]');
  } finally {
    journal.close();
  }
}

export const PLAN_USAGE = `  raqib plan [--day "Upper A"] [--date D] [--json]  The next plan day's exercises: weight to use, reps to beat, verdicts
  raqib plan overview                    Every planned exercise: current weight, next goal, on track or behind, stalls
  raqib plan progress                    Sessions a week, % on track, quarterly change, bodyweight against target`;

export const EXERCISE_COMMANDS: Record<string, (args: string[]) => number> = { exercise, workout, plan };
