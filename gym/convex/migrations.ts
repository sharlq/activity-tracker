// One-off data changes, run by hand: npx convex run migrations:<name>
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { internalMutation } from './_generated/server';
import { nextNum } from './lib/nums';
import { MACHINE_SWAPS, STANDING_CALF_RAISE } from '../../tracker/src/machineSwap.ts';
import { AFTER_STANDING_CALF, CALF_SUPERSET } from '../../tracker/src/calfWork.ts';

/** Plans arrive: days from before them go into one plan, "Main plan", made active. */
export const plansV1 = internalMutation({
  args: {},
  handler: async (ctx) => {
    let plan = (await ctx.db.query('plans').collect())[0];
    if (!plan) {
      const id = await ctx.db.insert('plans', { num: 1, name: 'Main plan', note: null, active: true, createdAt: Date.now() });
      plan = (await ctx.db.get(id))!;
    }
    let moved = 0;
    for (const d of await ctx.db.query('planDays').collect()) {
      if (d.planNum === undefined) {
        await ctx.db.patch(d._id, { planNum: plan.num });
        moved++;
      }
    }
    return { plan: plan.name, moved };
  },
});

/**
 * The calf day's new shape (tracker/src/calfWork.ts), on every day that has the dumbbell
 * single-leg calf raise: the standing calf machine takes its place, sets and reps (the
 * dumbbell lift is archived, never deleted, so its logged sets keep their name and history),
 * the seated calf machine and the kettlebell tibialis raise come right after it, and the two
 * calf machines become a superset. Nothing logged is touched. dryRun reports the same without
 * writing; running it again changes nothing.
 *   npx convex run migrations:calvesV1 '{"dryRun": true}'
 */
export const calvesV1 = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const swap = MACHINE_SWAPS.find((s) => s.exercise.name === STANDING_CALF_RAISE)!;
    const old = new Set(swap.replaces.map((n) => n.toLowerCase()));
    const is = (name: string) => (e: Doc<'planExercises'>) => e.name.toLowerCase() === name.toLowerCase();
    const plans = await ctx.db.query('plans').collect();
    const days = await ctx.db.query('planDays').collect();
    const all = await ctx.db.query('planExercises').collect();
    const supersets = await ctx.db.query('supersets').collect();
    const changes: { plan: string; day: string; archived: string[]; added: string[]; superset: boolean; order: string[] }[] = [];
    for (const d of [...days].sort((a, b) => a.planNum - b.planNum || a.position - b.position)) {
      const active = all.filter((e) => e.dayNum === d.num && e.active).sort((a, b) => a.position - b.position || a.num - b.num);
      const dumbbells = active.filter((e) => old.has(e.name.toLowerCase()));
      if (!dumbbells.length && !active.some(is(STANDING_CALF_RAISE))) continue;
      const change = { plan: plans.find((p) => p.num === d.planNum)?.name ?? '?', day: d.name, archived: dumbbells.map((e) => e.name), added: [] as string[], superset: false, order: [] as string[] };
      // The day as it will be, in order; `null` num means a new row.
      type Row = { doc: Doc<'planExercises'> | null; name: string; make?: () => Promise<Doc<'planExercises'>['_id']> };
      const rows: Row[] = active.filter((e) => !old.has(e.name.toLowerCase())).map((e) => ({ doc: e, name: e.name }));
      const insertAt = (i: number, row: Row) => rows.splice(i, 0, row);
      const fresh = (e: { name: string; sets: number; repMin: number; repMax: number; step: number; laterSlot: boolean; restSeconds: number; note: string }, laterSlot: boolean): Row => ({
        doc: null, name: e.name,
        make: async () => ctx.db.insert('planExercises', {
          num: await nextNum(ctx), dayNum: d.num, position: 0, name: e.name, aliases: [], sets: e.sets, repMin: e.repMin, repMax: e.repMax, step: e.step,
          laterSlot, perHand: false, perSide: false, bodyweight: false, note: e.note, active: true, restSeconds: e.restSeconds, goals: [],
        }),
      });
      // 1. The standing machine where the dumbbell raise was, with its sets and reps.
      let at = rows.findIndex((r) => r.name.toLowerCase() === STANDING_CALF_RAISE.toLowerCase());
      if (at < 0) {
        const first = dumbbells[0]!;
        at = active.filter((e) => e.position < first.position && !old.has(e.name.toLowerCase())).length;
        const m = { ...swap.exercise, sets: first.sets, repMin: first.repMin, repMax: first.repMax };
        insertAt(at, fresh(m, at > 0 && m.laterSlot));
        change.added.push(m.name);
      }
      // 2. The seated machine, then the tibialis raise, right after it (unless the day has them).
      let after = at;
      for (const e of AFTER_STANDING_CALF) {
        const found = rows.findIndex((r) => r.name.toLowerCase() === e.name.toLowerCase());
        if (found >= 0) {
          after = Math.max(after, found);
          continue;
        }
        insertAt(++after, fresh(e, e.laterSlot));
        change.added.push(e.name);
      }
      change.order = rows.map((r) => r.name);
      // 3. The two calf machines as a superset, unless they already are one.
      const [a, b] = CALF_SUPERSET.members.map((n) => rows.find((r) => r.name.toLowerCase() === n.toLowerCase())!);
      const together = a!.doc?.supersetNum !== undefined && a!.doc?.supersetNum === b!.doc?.supersetNum && supersets.some((g) => g.num === a!.doc!.supersetNum);
      change.superset = !together;
      changes.push(change);
      if (dryRun) continue;
      for (const e of dumbbells) await ctx.db.patch(e._id, { active: false, supersetNum: undefined, supersetOrder: undefined });
      const ids: Doc<'planExercises'>['_id'][] = [];
      for (const r of rows) ids.push(r.doc ? r.doc._id : await r.make!());
      for (const [i, id] of ids.entries()) await ctx.db.patch(id, { position: i + 1 });
      if (!together) {
        const group = await nextNum(ctx);
        await ctx.db.insert('supersets', { num: group, dayNum: d.num, restSeconds: CALF_SUPERSET.restSeconds });
        // A superset either one was in before is left to the members still in it.
        for (const [k, r] of [a!, b!].entries()) await ctx.db.patch(ids[rows.indexOf(r)]!, { supersetNum: group, supersetOrder: k + 1 });
      }
    }
    return { dryRun, changes };
  },
});
