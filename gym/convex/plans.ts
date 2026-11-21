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
import { groupedOrder, supersetInfo } from './lib/supersets';

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
const supersetsOf = (ctx: MutationCtx, dayNum: number) => ctx.db.query('supersets').withIndex('by_day', (q) => q.eq('dayNum', dayNum)).collect();

/** A day's active exercises as the screens show them (a superset's members together), and each one's superset. */
async function dayOrder(ctx: MutationCtx, dayNum: number) {
  const active = (await exercisesOf(ctx, dayNum)).filter((e) => e.active).sort((a, b) => a.position - b.position || a.num - b.num);
  const info = supersetInfo(active, await supersetsOf(ctx, dayNum));
  return { list: groupedOrder(active, (e) => e.num, info), info };
}

/**
 * After a change to a day's supersets or order: positions 1..n in the order shown, members
 * numbered 1..k in their group, and a superset left with fewer than two members goes (its
 * last member is a plain lift again).
 */
async function settleDay(ctx: MutationCtx, dayNum: number, list?: Doc<'planExercises'>[]): Promise<void> {
  const shown = list ?? (await dayOrder(ctx, dayNum)).list;
  const supersets = await supersetsOf(ctx, dayNum);
  const members = new Map<number, Doc<'planExercises'>[]>();
  for (const e of shown) if (e.supersetNum !== undefined) members.set(e.supersetNum, [...(members.get(e.supersetNum) ?? []), e]);
  for (const g of supersets) if ((members.get(g.num)?.length ?? 0) < 2) await ctx.db.delete(g._id);
  const live = new Set(supersets.filter((g) => (members.get(g.num)?.length ?? 0) >= 2).map((g) => g.num));
  const orderIn = new Map<number, number>();
  for (const [i, e] of shown.entries()) {
    const keep = e.supersetNum !== undefined && live.has(e.supersetNum);
    const order = keep ? (orderIn.get(e.supersetNum!) ?? 0) + 1 : undefined;
    if (keep) orderIn.set(e.supersetNum!, order!);
    const patch: Partial<Doc<'planExercises'>> = {};
    if (e.position !== i + 1) patch.position = i + 1;
    if (e.supersetOrder !== order) patch.supersetOrder = order;
    if (!keep && e.supersetNum !== undefined) patch.supersetNum = undefined;
    if (Object.keys(patch).length) await ctx.db.patch(e._id, patch);
  }
  // Archived lifts in a superset aren't in it any more.
  for (const e of (await exercisesOf(ctx, dayNum)).filter((x) => !x.active && x.supersetNum !== undefined)) await ctx.db.patch(e._id, { supersetNum: undefined, supersetOrder: undefined });
}

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
    const [plans, days, exercises, supersets, workouts] = await Promise.all([
      ctx.db.query('plans').collect(),
      ctx.db.query('planDays').collect(),
      ctx.db.query('planExercises').collect(),
      ctx.db.query('supersets').collect(),
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
      plans: planView(plans, days, exercises, supersets),
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
        // Supersets come too, as new ones on the new day.
        const groups = new Map<number, number>();
        for (const g of await supersetsOf(ctx, d.num)) {
          const n = await nextNum(ctx);
          groups.set(g.num, n);
          await ctx.db.insert('supersets', { num: n, dayNum, restSeconds: g.restSeconds });
        }
        for (const e of await exercisesOf(ctx, d.num)) {
          if (!e.active) continue;
          const { _id, _creationTime, num: _old, dayNum: _day, supersetNum, supersetOrder, ...rest } = e;
          const group = supersetNum === undefined ? undefined : groups.get(supersetNum);
          await ctx.db.insert('planExercises', { ...rest, num: await nextNum(ctx), dayNum, ...(group !== undefined ? { supersetNum: group, supersetOrder } : {}) });
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
      for (const g of await supersetsOf(ctx, d.num)) await ctx.db.delete(g._id);
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
    for (const g of await supersetsOf(ctx, dayNum)) await ctx.db.delete(g._id);
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
    const { list, info } = await dayOrder(ctx, e.dayNum);
    const dir = Math.sign(by);
    const i = list.findIndex((x) => x.num === exerciseNum);
    const mine = info.get(exerciseNum);
    const j = i + dir;
    // Inside a superset it trades places with the member next to it.
    if (mine && j >= 0 && j < list.length && info.get(list[j]!.num)?.num === mine.num) {
      [list[i], list[j]] = [list[j]!, list[i]!];
      return settleDay(ctx, e.dayNum, list);
    }
    // Otherwise its block (the lift, or its whole superset) moves past the block beside it.
    const blocks: Doc<'planExercises'>[][] = [];
    for (const x of list) {
      const g = info.get(x.num)?.num;
      const last = blocks.at(-1);
      if (g !== undefined && last && info.get(last[0]!.num)?.num === g) last.push(x);
      else blocks.push([x]);
    }
    const b = blocks.findIndex((blk) => blk.some((x) => x.num === exerciseNum));
    const c = b + dir;
    if (c < 0 || c >= blocks.length) return;
    [blocks[b], blocks[c]] = [blocks[c]!, blocks[b]!];
    await settleDay(ctx, e.dayNum, blocks.flat());
  },
});

export const deleteExercise = mutation({
  args: { key: v.string(), exerciseNum: v.number() },
  handler: async (ctx, { key, exerciseNum }) => {
    checkGymKey(key);
    const e = await exerciseByNum(ctx, exerciseNum);
    await ctx.db.delete(e._id);
    await renumber(ctx, await exercisesOf(ctx, e.dayNum));
    // A superset left with one member goes.
    if (e.supersetNum !== undefined) await settleDay(ctx, e.dayNum);
  },
});

// ------------------------------------------------------------------ supersets

/**
 * This exercise and the one shown after it become a superset (a set of each, then one rest).
 * If either is in one already, the other joins it; two supersets side by side become one.
 */
export const supersetWithNext = mutation({
  args: { key: v.string(), exerciseNum: v.number() },
  handler: async (ctx, { key, exerciseNum }) => {
    checkGymKey(key);
    const e = await exerciseByNum(ctx, exerciseNum);
    const { list, info } = await dayOrder(ctx, e.dayNum);
    const mine = info.get(e.num);
    const i = list.findIndex((x) => x.num === e.num);
    const next = list.slice(i + 1).find((x) => !mine || info.get(x.num)?.num !== mine.num);
    if (!next) throw new ConvexError('Nothing after it on this day to superset with');
    const theirs = info.get(next.num);
    let group = mine?.num ?? theirs?.num;
    if (group === undefined) {
      group = await nextNum(ctx);
      await ctx.db.insert('supersets', { num: group, dayNum: e.dayNum, restSeconds: Math.max(e.restSeconds, next.restSeconds) });
    }
    // Everything in either group, in the order shown, goes into one.
    const joining = list.filter((x) => x.num === e.num || x.num === next.num || (mine && info.get(x.num)?.num === mine.num) || (theirs && info.get(x.num)?.num === theirs.num));
    for (const x of joining) if (x.supersetNum !== group) await ctx.db.patch(x._id, { supersetNum: group });
    const ids = new Set(joining.map((x) => x.num));
    const first = list.findIndex((x) => ids.has(x.num));
    const shown = [...list.slice(0, first).filter((x) => !ids.has(x.num)), ...joining.map((x) => ({ ...x, supersetNum: group })), ...list.slice(first).filter((x) => !ids.has(x.num))];
    await settleDay(ctx, e.dayNum, shown);
    return group;
  },
});

/** Done on its own again; a superset left with one member goes. */
export const leaveSuperset = mutation({
  args: { key: v.string(), exerciseNum: v.number() },
  handler: async (ctx, { key, exerciseNum }) => {
    checkGymKey(key);
    const e = await exerciseByNum(ctx, exerciseNum);
    if (e.supersetNum === undefined) return;
    const { list } = await dayOrder(ctx, e.dayNum);
    // It goes just after the superset it leaves.
    const rest = list.filter((x) => x.num !== e.num);
    const lastOfGroup = rest.findLastIndex((x) => x.supersetNum === e.supersetNum);
    const shown = [...rest.slice(0, lastOfGroup + 1), { ...e, supersetNum: undefined }, ...rest.slice(lastOfGroup + 1)];
    await ctx.db.patch(e._id, { supersetNum: undefined, supersetOrder: undefined });
    await settleDay(ctx, e.dayNum, shown as Doc<'planExercises'>[]);
  },
});

/** The rest after each round of a superset. */
export const updateSuperset = mutation({
  args: { key: v.string(), supersetNum: v.number(), restSeconds: v.number() },
  handler: async (ctx, { key, supersetNum, restSeconds }) => {
    checkGymKey(key);
    const g = await ctx.db.query('supersets').withIndex('by_num', (q) => q.eq('num', supersetNum)).unique();
    if (!g) throw new ConvexError('no such superset');
    await ctx.db.patch(g._id, { restSeconds: whole(restSeconds, 10, 900, 'Rest (seconds)') });
  },
});
