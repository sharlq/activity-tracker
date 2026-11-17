// Strength score and strength balance for the phone: every group's score from the last 90
// days, how the groups compare, and the overall score week by week. The maths is the PC's
// own (tracker/src/strength.ts), run on every workout here.
import { ConvexError, v } from 'convex/values';
import { query } from './_generated/server';
import { checkGymKey } from './access';
import { strengthBalance, strengthScores, strengthTrend } from '../../tracker/src/strength.ts';

export const scores = query({
  args: {
    key: v.string(),
    date: v.string(),
    standards: v.optional(v.union(v.literal('men'), v.literal('women'))),
    /** Used only when there's no weigh-in yet. */
    bodyweight: v.optional(v.number()),
  },
  handler: async (ctx, { key, date, standards = 'men', bodyweight }) => {
    checkGymKey(key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ConvexError('date must look like 2026-11-15');
    if (bodyweight !== undefined && !(bodyweight >= 25 && bodyweight <= 300)) throw new ConvexError('bodyweight must be 25 to 300 kg');
    const [workouts, weighIns] = await Promise.all([
      ctx.db.query('workouts').filter((q) => q.neq(q.field('deleted'), true)).collect(),
      ctx.db.query('weighIns').collect(),
    ]);
    const sets = workouts.filter((w) => w.kind === 'strength').flatMap((w) => w.sets.map((s) => ({ day: w.day, exercise: s.exercise, weight: s.weight, reps: s.reps, flag: s.flag })));
    const weights = weighIns.map((w) => ({ day: w.day, weight: w.weight }));
    const fallback = bodyweight ?? null;
    const now = strengthScores(sets, weights, date, standards, fallback);
    return {
      standards,
      bodyweight: now.bodyweight,
      /** True when the weight came from the phone, not a weigh-in. */
      bodyweightGiven: !weights.length && now.bodyweight !== null,
      scores: now,
      balance: strengthBalance(now),
      trend: strengthTrend(sets, weights, date, standards, fallback),
    };
  },
});
