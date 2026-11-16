// The PC's side: رقيب pushes its plan and history up (scripts/pushFromPc.ts), and later
// pulls what was logged here. Every one takes the sync key, not the gym key.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { checkSyncKey } from './access';
import { planExerciseFields, workoutFields } from './schema';

const nullable = <T extends Parameters<typeof v.union>[0]>(t: T) => v.union(t, v.null());

/** Same data, whatever the order of the keys (a missing key and undefined are the same). */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}
const sameValue = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * The PC's plan and body data. The plan goes in as "Main plan" only while there are no
 * plans here (or with replacePlan): once you edit plans on the phone, the phone owns them.
 * Checkpoints, body goals, weigh-ins and settings are replaced every time.
 */
export const pushPlan = mutation({
  args: {
    key: v.string(),
    days: v.array(v.object({ num: v.number(), name: v.string(), position: v.number(), note: nullable(v.string()) })),
    exercises: v.array(v.object(planExerciseFields)),
    checkpoints: v.array(v.object({ day: v.string(), label: v.string() })),
    bodyGoals: v.array(v.object({ day: v.string(), weight: v.number(), lean: nullable(v.number()) })),
    weighIns: v.array(v.object({ day: v.string(), weight: v.number(), bodyFat: nullable(v.number()), waist: nullable(v.number()), note: nullable(v.string()), at: v.number() })),
    settings: v.array(v.object({ key: v.string(), value: v.any() })),
    replacePlan: v.optional(v.boolean()),
  },
  handler: async (ctx, { key, days, exercises, checkpoints, bodyGoals, weighIns, settings, replacePlan }) => {
    checkSyncKey(key);
    const hasPlans = (await ctx.db.query('plans').first()) !== null;
    const planPushed = !hasPlans || !!replacePlan;
    if (planPushed) {
      const rest = new Map((await ctx.db.query('planExercises').collect()).map((e) => [e.num, e.restSeconds]));
      for (const table of ['plans', 'planDays', 'planExercises'] as const) {
        for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(row._id);
      }
      await ctx.db.insert('plans', { num: 1, name: 'Main plan', note: null, active: true, createdAt: Date.now() });
      for (const d of days) await ctx.db.insert('planDays', { ...d, planNum: 1 });
      for (const e of exercises) await ctx.db.insert('planExercises', { ...e, restSeconds: rest.get(e.num) ?? e.restSeconds });
    }
    for (const table of ['checkpoints', 'bodyGoals', 'weighIns', 'settings'] as const) {
      for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(row._id);
    }
    for (const c of checkpoints) await ctx.db.insert('checkpoints', c);
    for (const g of bodyGoals) await ctx.db.insert('bodyGoals', g);
    for (const w of weighIns) await ctx.db.insert('weighIns', w);
    for (const s of settings) await ctx.db.insert('settings', s);
    return { planPushed, days: days.length, exercises: exercises.length };
  },
});

/** Workouts from the PC, matched by their PC id; ones logged here are never touched. */
export const pushWorkouts = mutation({
  args: { key: v.string(), workouts: v.array(v.object(workoutFields)) },
  handler: async (ctx, { key, workouts }) => {
    checkSyncKey(key);
    let added = 0;
    let updated = 0;
    for (const w of workouts) {
      const found = await ctx.db.query('workouts').withIndex('by_num', (q) => q.eq('num', w.num)).unique();
      if (!found) {
        await ctx.db.insert('workouts', { ...w, origin: 'pc' });
        added++;
      } else if (found.origin === 'pc') {
        // رقيب syncs every time it opens, so leave what hasn't changed alone.
        const { _id, _creationTime, ...stored } = found;
        if (sameValue(stored, { ...w, origin: 'pc' })) continue;
        await ctx.db.replace(_id, { ...w, origin: 'pc' });
        updated++;
      }
    }
    return { added, updated };
  },
});

/** Workouts logged here that changed after `since` (ms), oldest change first: for the PC to pull (deleted: true means drop it). */
export const changedSince = query({
  args: { key: v.string(), since: v.number() },
  handler: async (ctx, { key, since }) => {
    checkSyncKey(key);
    const rows = await ctx.db.query('workouts').withIndex('by_updated', (q) => q.gt('updatedAt', since)).take(200);
    return rows.filter((w) => w.origin === 'gym').map(({ _id, _creationTime, ...w }) => w);
  },
});
