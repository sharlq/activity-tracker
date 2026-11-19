// Every plan with its days and exercises, as the phone's plans screens and the PC's Plans
// tab both show them: the active plan first, days and exercises in their order.
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export function planView(plans: Doc<'plans'>[], days: Doc<'planDays'>[], exercises: Doc<'planExercises'>[]) {
  return [...plans]
    .sort((a, b) => Number(b.active) - Number(a.active) || a.createdAt - b.createdAt)
    .map((p) => ({
      num: p.num,
      name: p.name,
      note: p.note,
      active: p.active,
      days: days
        .filter((d) => d.planNum === p.num)
        .sort((a, b) => a.position - b.position || a.num - b.num)
        .map((d) => ({
          num: d.num,
          name: d.name,
          note: d.note,
          exercises: exercises
            .filter((e) => e.dayNum === d.num && e.active)
            .sort((a, b) => a.position - b.position || a.num - b.num)
            .map((e) => ({
              num: e.num, name: e.name, sets: e.sets, repMin: e.repMin, repMax: e.repMax, step: e.step, restSeconds: e.restSeconds,
              bodyweight: e.bodyweight, perHand: e.perHand, perSide: e.perSide ?? false, laterSlot: e.laterSlot, note: e.note,
            })),
        })),
    }));
}

export async function loadPlanView(ctx: QueryCtx) {
  const [plans, days, exercises] = await Promise.all([ctx.db.query('plans').collect(), ctx.db.query('planDays').collect(), ctx.db.query('planExercises').collect()]);
  return planView(plans, days, exercises);
}
