// Whose turn it is in a workout with supersets. Members of a superset go in rounds: a set of
// A1, a set of A2, …, then the superset's rest. Each set is still logged to its own exercise,
// so history and progress stay per lift. A lift on its own goes set after set, as always.

export interface FlowExercise {
  num: number;
  sets: number;
  superset: { num: number; label: string; order: number } | null;
}

/** "A1", "B2", or null for a lift done on its own. */
export const tagOf = (e: FlowExercise) => (e.superset ? `${e.superset.label}${e.superset.order}` : null);

/** The superset's members in order (just the lift itself when it's in none). */
export const groupOf = <E extends FlowExercise>(e: E, all: readonly E[]): E[] =>
  e.superset ? all.filter((x) => x.superset?.num === e.superset!.num).sort((a, b) => a.superset!.order - b.superset!.order) : [e];

/** Where to go next: the first lift with sets left, and in a superset the member whose turn it is. */
export function nextUp<E extends FlowExercise>(all: readonly E[], done: (e: E) => number): E | undefined {
  const first = all.find((x) => done(x) < x.sets);
  if (!first?.superset) return first;
  const left = groupOf(first, all).filter((x) => done(x) < x.sets);
  return left.reduce((best, x) => (done(x) < done(best) ? x : best), left[0]!);
}

/**
 * After a set of a superset member (already counted in `done`): the member still owing a set
 * this round, with no rest; or, once the round is done, rest and then the next round's first
 * member, or the next lift once the superset is finished.
 */
export function afterSupersetSet<E extends FlowExercise>(e: E, all: readonly E[], done: (e: E) => number): { next: E | undefined; rest: boolean } {
  const n = done(e);
  const group = groupOf(e, all);
  const owing = group.filter((x) => x.num !== e.num && done(x) < n && done(x) < x.sets);
  if (owing.length) return { next: owing.find((x) => x.superset!.order > e.superset!.order) ?? owing[0], rest: false };
  const left = group.filter((x) => done(x) < x.sets);
  const member = left.reduce<E | undefined>((best, x) => (!best || done(x) < done(best) ? x : best), undefined);
  return { next: member ?? nextUp(all.filter((x) => x.superset?.num !== e.superset!.num), done), rest: true };
}
