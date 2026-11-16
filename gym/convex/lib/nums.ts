// Ids for things made here: one counter from 100,000,000 up, past anything from the PC.
import type { MutationCtx } from '../_generated/server';

export async function nextNum(ctx: MutationCtx): Promise<number> {
  const row = await ctx.db.query('counters').withIndex('by_name', (q) => q.eq('name', 'num')).unique();
  const value = Math.max(row?.value ?? 0, 100_000_000) + 1;
  if (row) await ctx.db.patch(row._id, { value });
  else await ctx.db.insert('counters', { name: 'num', value });
  return value;
}
