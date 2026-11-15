// The gym app's functions: today's workout from the plan, logging it a set at a time,
// the rest length per exercise, finishing, and the summary. Every one takes the gym key.
// The engine is the PC's own (tracker/src/trainingPlan.ts), run on the cloud's data.
import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { checkGymKey } from './access';
import { nextNum } from './lib/nums';
import { activePlan, loadAll, planExerciseOf, planOfDay, sourceOf } from './lib/source';
import { minutesOf, pickPrevious, summarize } from './lib/summary';
import { nextPlanDay, todayView } from '../../tracker/src/trainingPlan.ts';

const day = v.string();
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);


async function workoutByNum(ctx: MutationCtx, num: number): Promise<Doc<'workouts'>> {
  const w = await ctx.db.query('workouts').withIndex('by_num', (q) => q.eq('num', num)).unique();
  if (!w || w.deleted) throw new ConvexError('no such workout');
  return w;
}

/** For the sign-in screen: is this the key? */
export const ping = query({
  args: { key: v.string() },
  handler: async (_ctx, { key }) => {
    checkGymKey(key);
    return true;
  },
});

/** Today's plan day in the active plan: the asked one, else the one already started that date, else the next in the rotation. */
export const today = query({
  args: { key: v.string(), date: day, dayNum: v.optional(v.number()) },
  handler: async (ctx, { key, date, dayNum }) => {
    checkGymKey(key);
    if (!isDay(date)) throw new ConvexError('date must look like 2026-11-15');
    const data = await loadAll(ctx);
    const plan = activePlan(data);
    const plans = [...data.plans].sort((a, b) => a.createdAt - b.createdAt).map((p) => ({ num: p.num, name: p.name, active: p.num === plan?.num }));
    if (!plan) return { kind: 'no plan' as const, plans };
    const source = sourceOf(data, plan.num);
    const dayIds = new Set(source.planDays().map((d) => d.id));
    const started = data.workouts.filter((w) => w.day === date && w.planDayNum !== null && dayIds.has(w.planDayNum)).sort((a, b) => a.num - b.num).at(-1)?.planDayNum ?? null;
    const next = nextPlanDay(source);
    const id = (dayNum !== undefined && dayIds.has(dayNum) ? dayNum : null) ?? started ?? next;
    if (id === null) return { kind: 'empty plan' as const, plan: { num: plan.num, name: plan.name }, plans };
    const view = todayView(source, date, id);
    if (!view) throw new ConvexError('no such plan day');
    const workout = view.workoutId === null ? null : data.workouts.find((w) => w.num === view.workoutId) ?? null;
    const rest = new Map(data.exercises.map((e) => [e.num, e.restSeconds]));
    return {
      kind: 'day' as const,
      plan: { num: plan.num, name: plan.name },
      plans,
      date,
      day: view.day,
      days: view.days,
      next,
      started,
      workout: workout ? { num: workout.num, start: workout.start, end: workout.end, sets: workout.sets.length } : null,
      exercises: view.exercises.map(({ state, logged, now }) => ({
        num: state.exercise.id,
        name: state.exercise.name,
        note: state.exercise.note,
        sets: state.rule.sets,
        repMin: state.rule.repMin,
        repMax: state.rule.repMax,
        step: state.rule.step,
        bodyweight: !!state.rule.bodyweight,
        perHand: !!state.rule.perHand,
        laterSlot: state.rule.laterSlot,
        restSeconds: rest.get(state.exercise.id) ?? 90,
        suggested: state.suggestion.weight,
        suggestedLabel: state.suggestedLabel,
        beat: state.suggestion.beat,
        last: state.suggestion.last ? { day: state.suggestion.last.day, weight: state.suggestion.last.weight, reps: state.suggestion.last.reps } : null,
        lastVerdict: state.suggestion.verdict?.message ?? null,
        threshold: state.suggestion.threshold,
        lowestOk: state.suggestion.lowestOk,
        progress: state.progress,
        flags: state.flags,
        logged,
        now: now ? { kind: now.kind, message: now.message } : null,
      })),
    };
  },
});

/** One set of a planned exercise, into that date's workout for its plan day (started by the first set). */
export const logSet = mutation({
  args: { key: v.string(), date: day, exerciseNum: v.number(), weight: v.number(), reps: v.number(), at: v.number() },
  handler: async (ctx, { key, date, exerciseNum, weight, reps, at }) => {
    checkGymKey(key);
    if (!isDay(date)) throw new ConvexError('date must look like 2026-11-15');
    if (!Number.isFinite(weight) || weight < -500 || weight > 1000) throw new ConvexError('weight must be from 0 to 1000 kg');
    if (!Number.isInteger(reps) || reps < 0 || reps > 1000) throw new ConvexError('reps must be a whole number');
    const doc = await ctx.db.query('planExercises').withIndex('by_num', (q) => q.eq('num', exerciseNum)).unique();
    if (!doc) throw new ConvexError('no such plan exercise');
    const e = planExerciseOf(doc);
    const now = Date.now();
    let workout = (await ctx.db.query('workouts').withIndex('by_day', (q) => q.eq('day', date)).collect())
      .filter((w) => w.planDayNum === e.dayId && !w.deleted)
      .sort((a, b) => a.num - b.num)[0];
    if (!workout) {
      const planDay = await ctx.db.query('planDays').withIndex('by_num', (q) => q.eq('num', e.dayId)).unique();
      const id = await ctx.db.insert('workouts', {
        num: await nextNum(ctx), day: date, start: at, end: null, name: planDay?.name ?? 'Workout', kind: 'strength', minutes: null, calories: null,
        note: null, source: 'manual', externalId: null, planDayNum: e.dayId, sets: [], logs: [], createdAt: now, updatedAt: now, origin: 'gym',
      });
      workout = (await ctx.db.get(id)) as Doc<'workouts'>;
    }
    const names = new Set([e.name, ...e.aliases].map((n) => n.toLowerCase()));
    const existing = workout.sets.filter((s) => names.has(s.exercise.toLowerCase()));
    const exercise = existing[0]?.exercise ?? e.name;
    const position = existing[0]?.position ?? Math.max(0, ...workout.sets.map((s) => s.position)) + 1;
    const num = await nextNum(ctx);
    const set = {
      num, exercise, position, setNo: existing.length + 1, reps, weight: weight === 0 && e.bodyweight ? null : weight,
      rpe: null, seconds: null, distance: null, flag: null, at,
    };
    // A set after "Finish" opens the workout again.
    await ctx.db.patch(workout._id, { sets: [...workout.sets, set], end: null, minutes: null, updatedAt: now });
    return { workoutNum: workout.num, setNum: num };
  },
});

export const deleteSet = mutation({
  args: { key: v.string(), workoutNum: v.number(), setNum: v.number() },
  handler: async (ctx, { key, workoutNum, setNum }) => {
    checkGymKey(key);
    const w = await workoutByNum(ctx, workoutNum);
    const gone = w.sets.find((s) => s.num === setNum);
    if (!gone) throw new ConvexError('no such set');
    // Number the rest of that exercise's sets again.
    let n = 0;
    const sets = w.sets.filter((s) => s.num !== setNum).map((s) => (s.exercise === gone.exercise ? { ...s, setNo: ++n } : s));
    // A workout started here and emptied again was a mistake: it goes, so the day is free again.
    await ctx.db.patch(w._id, { sets, updatedAt: Date.now(), ...(!sets.length && w.origin === 'gym' ? { deleted: true } : {}) });
  },
});

/** The rest timer's length for an exercise, from now on. */
export const setRest = mutation({
  args: { key: v.string(), exerciseNum: v.number(), seconds: v.number() },
  handler: async (ctx, { key, exerciseNum, seconds }) => {
    checkGymKey(key);
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 900) throw new ConvexError('rest must be 10 s to 15 min');
    const doc = await ctx.db.query('planExercises').withIndex('by_num', (q) => q.eq('num', exerciseNum)).unique();
    if (!doc) throw new ConvexError('no such plan exercise');
    await ctx.db.patch(doc._id, { restSeconds: seconds });
  },
});

export const finish = mutation({
  args: { key: v.string(), workoutNum: v.number(), end: v.number() },
  handler: async (ctx, { key, workoutNum, end }) => {
    checkGymKey(key);
    const w = await workoutByNum(ctx, workoutNum);
    if (!w.sets.length) throw new ConvexError('Log a set first');
    const done = { ...w, end };
    await ctx.db.patch(w._id, { end, minutes: minutesOf(done), updatedAt: Date.now() });
  },
});

export const summary = query({
  args: { key: v.string(), workoutNum: v.number() },
  handler: async (ctx, { key, workoutNum }) => {
    checkGymKey(key);
    const data = await loadAll(ctx);
    const w = data.workouts.find((x) => x.num === workoutNum);
    if (!w) throw new ConvexError('no such workout');
    // Read against the plan the workout was done in, even if another is active now.
    const source = sourceOf(data, planOfDay(data, w.planDayNum)?.num ?? activePlan(data)?.num ?? null);
    const previous = pickPrevious(source, w, data.workouts);
    return summarize(source, w, previous, previous ? (previous.minutes ?? minutesOf(previous)) : null);
  },
});

/** The last workouts, newest first, to open their summaries. */
export const recent = query({
  args: { key: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { key, limit }) => {
    checkGymKey(key);
    const all = await ctx.db.query('workouts').withIndex('by_day').order('desc').filter((q) => q.neq(q.field('deleted'), true)).take(Math.min(limit ?? 12, 50));
    return all.map((w) => ({ num: w.num, day: w.day, name: w.name, sets: w.sets.length, minutes: w.minutes ?? minutesOf(w), finished: w.end !== null, origin: w.origin }));
  },
});
