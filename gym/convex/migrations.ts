// One-off data changes, run by hand: npx convex run migrations:<name>
import { internalMutation } from './_generated/server';

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
