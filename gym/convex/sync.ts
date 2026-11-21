// The PC's side: رقيب pushes its plan and history up (scripts/pushFromPc.ts), and later
// pulls what was logged here. Every one takes the sync key, not the gym key.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { checkSyncKey } from './access';
import { nextNum } from './lib/nums';
import { loadPlanView } from './lib/planView';
import { planExerciseFields, workoutFields } from './schema';
import { MACHINE_SWAPS, machineFor } from '../../tracker/src/machineSwap.ts';

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

/**
 * A whole plan from the PC (scripts/importCaliberPlan.ts), made or remade by its name. An
 * exercise that's already in another plan keeps that one's reps, step, rest, goals and
 * aliases; what's sent here (sets, and reps for new lifts) wins. It becomes the
 * active plan only if asked, or if it already was.
 */
export const importPlan = mutation({
  args: {
    key: v.string(),
    name: v.string(),
    activate: v.optional(v.boolean()),
    days: v.array(v.object({
      name: v.string(),
      exercises: v.array(v.object({ name: v.string(), sets: v.number(), repMin: v.number(), repMax: v.number() })),
    })),
  },
  handler: async (ctx, { key, name, activate, days }) => {
    checkSyncKey(key);
    const allExercises = await ctx.db.query('planExercises').collect();
    const allDays = await ctx.db.query('planDays').collect();
    const plans = await ctx.db.query('plans').collect();
    const old = plans.find((p) => p.name === name);
    const known = new Map<string, (typeof allExercises)[number]>();
    for (const e of allExercises) {
      if (!e.active || allDays.find((d) => d.num === e.dayNum)?.planNum === old?.num) continue;
      for (const n of [e.name, ...e.aliases]) if (!known.has(n.toLowerCase())) known.set(n.toLowerCase(), e);
    }
    let planNum: number;
    if (old) {
      planNum = old.num;
      for (const d of allDays.filter((d) => d.planNum === old.num)) {
        for (const e of allExercises.filter((e) => e.dayNum === d.num)) await ctx.db.delete(e._id);
        await ctx.db.delete(d._id);
      }
    } else {
      planNum = await nextNum(ctx);
      await ctx.db.insert('plans', { num: planNum, name, note: null, active: false, createdAt: Date.now() });
    }
    if (activate) {
      for (const p of await ctx.db.query('plans').collect()) await ctx.db.patch(p._id, { active: p.num === planNum });
    }
    const made: { day: string; name: string; sets: number; reps: string; known: boolean }[] = [];
    for (const [i, d] of days.entries()) {
      const dayNum = await nextNum(ctx);
      await ctx.db.insert('planDays', { num: dayNum, planNum, name: d.name, position: i + 1, note: null });
      let position = 0;
      const machines = new Set<string>();
      for (const x of d.exercises) {
        // Lifts the gym's machines replaced (machineSwap.ts) come in as the machine, once a day.
        const m = machineFor(x.name);
        if (m) {
          if (machines.has(m.name)) continue;
          machines.add(m.name);
          position++;
          await ctx.db.insert('planExercises', {
            num: await nextNum(ctx), dayNum, position, name: m.name, active: true, aliases: [], sets: m.sets, laterSlot: position > 1 && m.laterSlot,
            repMin: m.repMin, repMax: m.repMax, step: m.step, perHand: false, perSide: m.perSide, bodyweight: false, note: m.note, restSeconds: m.restSeconds, goals: [],
          });
          made.push({ day: d.name, name: m.name, sets: m.sets, reps: `${m.repMin}–${m.repMax}`, known: false });
          continue;
        }
        const j = position++;
        const like = known.get(x.name.toLowerCase());
        const row = {
          num: await nextNum(ctx), dayNum, position: j + 1, name: x.name, active: true,
          aliases: like ? [like.name, ...like.aliases].filter((n) => n.toLowerCase() !== x.name.toLowerCase()) : [],
          // The first lift of a day is never in a later slot; the rest keep the other plan's.
          sets: x.sets, laterSlot: j > 0 && (like?.laterSlot ?? false),
          repMin: like?.repMin ?? x.repMin, repMax: like?.repMax ?? x.repMax, step: like?.step ?? 2.5,
          perHand: like?.perHand ?? false, perSide: like?.perSide ?? false, bodyweight: like?.bodyweight ?? false,
          // Notes like "After bench" belong to the other plan's order.
          note: like?.note && !/^after\b/i.test(like.note) ? like.note : null,
          restSeconds: like?.restSeconds ?? 90, goals: like?.goals ?? [],
        };
        await ctx.db.insert('planExercises', row);
        made.push({ day: d.name, name: x.name, sets: row.sets, reps: `${row.repMin}–${row.repMax}`, known: !!like });
      }
    }
    return { planNum, replaced: !!old, made };
  },
});

/** Every plan made on the phone, with its days and exercises: for the PC's Plans tab to show (read only). */
export const plans = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    checkSyncKey(key);
    return loadPlanView(ctx);
  },
});

/** Workouts logged here that changed after `since` (ms), oldest change first: for the PC to pull (deleted: true means drop it). */
export const changedSince = query({
  args: { key: v.string(), since: v.number() },
  handler: async (ctx, { key, since }) => {
    checkSyncKey(key);
    // Filter before take, so 200 PC workouts can't hide the phone's.
    const rows = await ctx.db.query('workouts').withIndex('by_updated', (q) => q.gt('updatedAt', since)).filter((q) => q.eq(q.field('origin'), 'gym')).take(200);
    return rows.map(({ _id, _creationTime, ...w }) => w);
  },
});

/**
 * The gym's machines replace three lifts in every plan (tracker/src/machineSwap.ts): on each
 * day with any of the old lifts, the machine goes in the first one's place and the old ones
 * are archived (active: false), never deleted, so workouts keep their names and history. The
 * machines start fresh: no aliases, no goals. dryRun reports the same without writing.
 * Running it again changes nothing.
 */
export const swapToMachines = mutation({
  args: { key: v.string(), dryRun: v.boolean() },
  handler: async (ctx, { key, dryRun }) => {
    checkSyncKey(key);
    const plans = await ctx.db.query('plans').collect();
    const days = await ctx.db.query('planDays').collect();
    const exercises = await ctx.db.query('planExercises').collect();
    // A machine with goals (the hip thrust) gets one per checkpoint, in order.
    const checkpoints = (await ctx.db.query('checkpoints').collect()).map((c) => c.day).sort();
    const goalsOf = (m: (typeof MACHINE_SWAPS)[number]['exercise']) => (m.goals ?? []).flatMap((weight, i) => (checkpoints[i] ? [{ day: checkpoints[i] as string, weight }] : []));
    const changes: { plan: string; active: boolean; day: string; archived: { name: string; position: number }[]; added: string; position: number }[] = [];
    for (const d of [...days].sort((a, b) => a.planNum - b.planNum || a.position - b.position)) {
      const plan = plans.find((p) => p.num === d.planNum);
      const mine = exercises.filter((e) => e.dayNum === d.num && e.active);
      for (const { replaces, exercise: m } of MACHINE_SWAPS) {
        const names = new Set(replaces.map((r) => r.toLowerCase()));
        const old = mine.filter((e) => names.has(e.name.toLowerCase())).sort((a, b) => a.position - b.position);
        if (!old.length) continue;
        const position = (old[0] as (typeof old)[number]).position;
        const already = mine.some((e) => e.name.toLowerCase() === m.name.toLowerCase());
        changes.push({ plan: plan?.name ?? '?', active: !!plan?.active, day: d.name, archived: old.map((e) => ({ name: e.name, position: e.position })), added: already ? '' : m.name, position });
        if (dryRun) continue;
        for (const e of old) await ctx.db.patch(e._id, { active: false });
        if (!already) {
          await ctx.db.insert('planExercises', {
            num: await nextNum(ctx), dayNum: d.num, position, name: m.name, aliases: [], sets: m.sets, repMin: m.repMin, repMax: m.repMax, step: m.step,
            laterSlot: m.laterSlot, perHand: false, perSide: m.perSide, bodyweight: false, note: m.note, active: true, restSeconds: m.restSeconds, goals: goalsOf(m),
          });
        }
      }
    }
    return { dryRun, changes };
  },
});
