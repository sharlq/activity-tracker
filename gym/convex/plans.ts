// Plans and their days and exercises, edited from the phone. Each plan has its own days;
// one plan is active and "today" follows it. Workouts point at a plan day by number and
// at exercises by name, so editing or removing a plan never touches logged history.
import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { checkGymKey } from './access';
import { nextNum } from './lib/nums';
import { planView } from './lib/planView';

const nullable = <T extends Parameters<typeof v.union>[0]>(t: T) => v.union(t, v.null());

function name(text: string, what: string, max = 120): string {
  const t = text.trim();
  if (!t || t.length > max) throw new ConvexError(`${what} must be 1 to ${max} characters`);
  return t;
}

const whole = (n: number, lo: number, hi: number, what: string) => {
  if (!Number.isInteger(n) || n < lo || n > hi) throw new ConvexError(`${what} must be a whole number from ${lo} to ${hi}`);
  return n;
};

async function planByNum(ctx: MutationCtx, num: number): Promise<Doc<'plans'>> {
  const p = await ctx.db.query('plans').withIndex('by_num', (q) => q.eq('num', num)).unique();
  if (!p) throw new ConvexError('no such plan');
  return p;
}

async function dayByNum(ctx: MutationCtx, num: number): Promise<Doc<'planDays'>> {
  const d = await ctx.db.query('planDays').withIndex('by_num', (q) => q.eq('num', num)).unique();
  if (!d) throw new ConvexError('no such plan day');
  return d;
}

async function exerciseByNum(ctx: MutationCtx, num: number): Promise<Doc<'planExercises'>> {
  const e = await ctx.db.query('planExercises').withIndex('by_num', (q) => q.eq('num', num)).unique();
  if (!e) throw new ConvexError('no such exercise');
  return e;
}

const daysOf = (ctx: MutationCtx, planNum: number) => ctx.db.query('planDays').withIndex('by_plan', (q) => q.eq('planNum', planNum)).collect();
const exercisesOf = async (ctx: MutationCtx, dayNum: number) => (await ctx.db.query('planExercises').collect()).filter((e) => e.dayNum === dayNum);

/** Puts a list in order 1..n after a move or a removal. */
async function renumber<T extends 'planDays' | 'planExercises'>(ctx: MutationCtx, rows: Doc<T>[]): Promise<void> {
  const sorted = [...rows].sort((a, b) => a.position - b.position || a.num - b.num);
  for (const [i, r] of sorted.entries()) if (r.position !== i + 1) await ctx.db.patch(r._id, { position: i + 1 } as never);
}

// ------------------------------------------------------------------ reading

/** Every plan with its days and exercises, and the exercise names you've used (most used first). */
export const list = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    checkGymKey(key);
    const [plans, days, exercises, workouts] = await Promise.all([
      ctx.db.query('plans').collect(),
      ctx.db.query('planDays').collect(),
      ctx.db.query('planExercises').collect(),
      ctx.db.query('workouts').filter((q) => q.neq(q.field('deleted'), true)).collect(),
    ]);
    const used = new Map<string, { name: string; n: number }>();
    for (const w of workouts) {
      for (const s of w.sets) {
        const k = s.exercise.toLowerCase();
        const row = used.get(k) ?? { name: s.exercise, n: 0 };
        row.n++;
        used.set(k, row);
      }
    }
    for (const e of exercises) if (!used.has(e.name.toLowerCase())) used.set(e.name.toLowerCase(), { name: e.name, n: 0 });
    return {
      plans: planView(plans, days, exercises),
      names: [...used.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((x) => x.name),
    };
  },
});

// ------------------------------------------------------------------ plans

/** A new plan, empty or as a copy of another (its days and exercises, rest and goals too). */
export const createPlan = mutation({
  args: { key: v.string(), name: v.string(), copyFrom: v.optional(v.number()) },
  handler: async (ctx, { key, name: title, copyFrom }) => {
    checkGymKey(key);
    const num = await nextNum(ctx);
    const first = (await ctx.db.query('plans').first()) === null;
    await ctx.db.insert('plans', { num, name: name(title, 'Plan name'), note: null, active: first, createdAt: Date.now() });
    if (copyFrom !== undefined) {
      await planByNum(ctx, copyFrom);
      for (const d of await daysOf(ctx, copyFrom)) {
        const dayNum = await nextNum(ctx);
        await ctx.db.insert('planDays', { num: dayNum, planNum: num, name: d.name, position: d.position, note: d.note });
        for (const e of await exercisesOf(ctx, d.num)) {
          if (!e.active) continue;
          const { _id, _creationTime, num: _old, dayNum: _day, ...rest } = e;
          await ctx.db.insert('planExercises', { ...rest, num: await nextNum(ctx), dayNum });
        }
      }
    }
    return num;
  },
});

export const updatePlan = mutation({
  args: { key: v.string(), planNum: v.number(), name: v.optional(v.string()), note: v.optional(nullable(v.string())) },
  handler: async (ctx, { key, planNum, name: title, note }) => {
    checkGymKey(key);
    const p = await planByNum(ctx, planNum);
    await ctx.db.patch(p._id, {
      ...(title !== undefined ? { name: name(title, 'Plan name') } : {}),
      ...(note !== undefined ? { note: note === null || !note.trim() ? null : name(note, 'Note', 500) } : {}),
    });
  },
});

/** The plan "today" follows from now on. */
export const setActive = mutation({
  args: { key: v.string(), planNum: v.number() },
  handler: async (ctx, { key, planNum }) => {
    checkGymKey(key);
    await planByNum(ctx, planNum);
    for (const p of await ctx.db.query('plans').collect()) if (p.active !== (p.num === planNum)) await ctx.db.patch(p._id, { active: p.num === planNum });
  },
});

export const deletePlan = mutation({
  args: { key: v.string(), planNum: v.number() },
  handler: async (ctx, { key, planNum }) => {
    checkGymKey(key);
    const p = await planByNum(ctx, planNum);
    if (p.active) throw new ConvexError('Switch to another plan before removing this one');
    for (const d of await daysOf(ctx, planNum)) {
      for (const e of await exercisesOf(ctx, d.num)) await ctx.db.delete(e._id);
      await ctx.db.delete(d._id);
    }
    await ctx.db.delete(p._id);
  },
});

// ------------------------------------------------------------------ days

export const addDay = mutation({
  args: { key: v.string(), planNum: v.number(), name: v.string() },
  handler: async (ctx, { key, planNum, name: title }) => {
    checkGymKey(key);
    await planByNum(ctx, planNum);
    const days = await daysOf(ctx, planNum);
    const num = await nextNum(ctx);
    await ctx.db.insert('planDays', { num, planNum, name: name(title, 'Day name', 60), position: Math.max(0, ...days.map((d) => d.position)) + 1, note: null });
    return num;
  },
});

export const updateDay = mutation({
  args: { key: v.string(), dayNum: v.number(), name: v.optional(v.string()), note: v.optional(nullable(v.string())) },
  handler: async (ctx, { key, dayNum, name: title, note }) => {
    checkGymKey(key);
    const d = await dayByNum(ctx, dayNum);
    await ctx.db.patch(d._id, {
      ...(title !== undefined ? { name: name(title, 'Day name', 60) } : {}),
      ...(note !== undefined ? { note: note === null || !note.trim() ? null : name(note, 'Note', 500) } : {}),
    });
  },
});

/** One place earlier (-1) or later (+1) in the rotation. */
export const moveDay = mutation({
  args: { key: v.string(), dayNum: v.number(), by: v.number() },
  handler: async (ctx, { key, dayNum, by }) => {
    checkGymKey(key);
    const d = await dayByNum(ctx, dayNum);
    const days = (await daysOf(ctx, d.planNum)).sort((a, b) => a.position - b.position || a.num - b.num);
    const i = days.findIndex((x) => x.num === dayNum);
    const j = i + Math.sign(by);
    if (j < 0 || j >= days.length) return;
    [days[i], days[j]] = [days[j]!, days[i]!];
    for (const [k, x] of days.entries()) if (x.position !== k + 1) await ctx.db.patch(x._id, { position: k + 1 });
  },
});

export const deleteDay = mutation({
  args: { key: v.string(), dayNum: v.number() },
  handler: async (ctx, { key, dayNum }) => {
    checkGymKey(key);
    const d = await dayByNum(ctx, dayNum);
    for (const e of await exercisesOf(ctx, dayNum)) await ctx.db.delete(e._id);
    await ctx.db.delete(d._id);
    await renumber(ctx, await daysOf(ctx, d.planNum));
  },
});

// ------------------------------------------------------------------ exercises

const exerciseChange = {
  name: v.optional(v.string()),
  sets: v.optional(v.number()),
  repMin: v.optional(v.number()),
  repMax: v.optional(v.number()),
  step: v.optional(v.number()),
  restSeconds: v.optional(v.number()),
  bodyweight: v.optional(v.boolean()),
  perHand: v.optional(v.boolean()),
  perSide: v.optional(v.boolean()),
  laterSlot: v.optional(v.boolean()),
  note: v.optional(nullable(v.string())),
};

type Change = { name?: string; sets?: number; repMin?: number; repMax?: number; step?: number; restSeconds?: number; bodyweight?: boolean; perHand?: boolean; perSide?: boolean; laterSlot?: boolean; note?: string | null };

/** The checked shape of an exercise after a change. */
function checked(e: Required<Omit<Change, 'note'>> & { note: string | null }) {
  const out = {
    name: name(e.name, 'Exercise name', 200),
    sets: whole(e.sets, 1, 10, 'Sets'),
    repMin: whole(e.repMin, 1, 100, 'Lowest reps'),
    repMax: whole(e.repMax, 1, 100, 'Highest reps'),
    step: e.step,
    restSeconds: whole(e.restSeconds, 10, 900, 'Rest (seconds)'),
    bodyweight: e.bodyweight,
    perHand: e.perHand,
    perSide: e.perSide,
    laterSlot: e.laterSlot,
    note: e.note === null || !e.note.trim() ? null : name(e.note, 'Note', 500),
  };
  if (out.repMax < out.repMin) throw new ConvexError('Highest reps must be at least the lowest');
  if (!(out.step > 0 && out.step <= 50)) throw new ConvexError('Weight step must be more than 0 and at most 50 kg');
  return out;
}

export const addExercise = mutation({
  args: { key: v.string(), dayNum: v.number(), ...exerciseChange, name: v.string() },
  handler: async (ctx, { key, dayNum, ...change }) => {
    checkGymKey(key);
    await dayByNum(ctx, dayNum);
    const fields = checked({ sets: 3, repMin: 8, repMax: 12, step: 2.5, restSeconds: 90, bodyweight: false, perHand: false, perSide: false, laterSlot: false, note: null, ...change });
    const siblings = await exercisesOf(ctx, dayNum);
    const num = await nextNum(ctx);
    await ctx.db.insert('planExercises', {
      ...fields, num, dayNum, position: Math.max(0, ...siblings.map((e) => e.position)) + 1, aliases: [], active: true, goals: [],
    });
    return num;
  },
});

export const updateExercise = mutation({
  args: { key: v.string(), exerciseNum: v.number(), ...exerciseChange },
  handler: async (ctx, { key, exerciseNum, ...change }) => {
    checkGymKey(key);
    const e = await exerciseByNum(ctx, exerciseNum);
    const defined = Object.fromEntries(Object.entries(change).filter(([, x]) => x !== undefined)) as Change;
    await ctx.db.patch(e._id, checked({ ...e, perSide: e.perSide ?? false, ...defined }));
  },
});

export const moveExercise = mutation({
  args: { key: v.string(), exerciseNum: v.number(), by: v.number() },
  handler: async (ctx, { key, exerciseNum, by }) => {
    checkGymKey(key);
    const e = await exerciseByNum(ctx, exerciseNum);
    const list = (await exercisesOf(ctx, e.dayNum)).filter((x) => x.active).sort((a, b) => a.position - b.position || a.num - b.num);
    const i = list.findIndex((x) => x.num === exerciseNum);
    const j = i + Math.sign(by);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    for (const [k, x] of list.entries()) if (x.position !== k + 1) await ctx.db.patch(x._id, { position: k + 1 });
  },
});

export const deleteExercise = mutation({
  args: { key: v.string(), exerciseNum: v.number() },
  handler: async (ctx, { key, exerciseNum }) => {
    checkGymKey(key);
    const e = await exerciseByNum(ctx, exerciseNum);
    await ctx.db.delete(e._id);
    await renumber(ctx, await exercisesOf(ctx, e.dayNum));
  },
});
