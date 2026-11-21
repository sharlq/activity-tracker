// Supersets as the screens show them: on each day, groups lettered A, B, … in the order they
// first come, members numbered from 1 (A1, A2), and the day's exercises reordered so a
// group's members sit together at the first member's place. A group needs two active
// members; one left alone is shown as a plain lift.

export interface SupersetInfo {
  num: number;
  /** A, B, … in the day's order. */
  label: string;
  /** 1-based place in the group. */
  order: number;
  size: number;
  /** Rest after each round. */
  restSeconds: number;
}

interface Member {
  num: number;
  supersetNum?: number;
  supersetOrder?: number;
}

/**
 * Each grouped exercise's superset, keyed by exercise num. `exercises` is one day's active
 * exercises in their plan order; `supersets` may hold any day's.
 */
export function supersetInfo(exercises: readonly Member[], supersets: readonly { num: number; restSeconds: number }[]): Map<number, SupersetInfo> {
  const groups = new Map<number, Member[]>();
  for (const e of exercises) {
    if (e.supersetNum === undefined || !supersets.some((s) => s.num === e.supersetNum)) continue;
    groups.set(e.supersetNum, [...(groups.get(e.supersetNum) ?? []), e]);
  }
  const out = new Map<number, SupersetInfo>();
  let letter = 0;
  for (const [num, members] of groups) {
    if (members.length < 2) continue;
    const label = String.fromCharCode(65 + (letter++ % 26));
    const rest = supersets.find((s) => s.num === num)!.restSeconds;
    const sorted = members.map((m, i) => ({ m, i })).sort((a, b) => (a.m.supersetOrder ?? 0) - (b.m.supersetOrder ?? 0) || a.i - b.i);
    sorted.forEach(({ m }, i) => out.set(m.num, { num, label, order: i + 1, size: members.length, restSeconds: rest }));
  }
  return out;
}

/** The day's exercises with each group's members together, in order, where its first member was. */
export function groupedOrder<T>(exercises: readonly T[], numOf: (e: T) => number, info: ReadonlyMap<number, SupersetInfo>): T[] {
  const out: T[] = [];
  const placed = new Set<number>();
  for (const e of exercises) {
    const s = info.get(numOf(e));
    if (!s) {
      out.push(e);
      continue;
    }
    if (placed.has(s.num)) continue;
    placed.add(s.num);
    out.push(...exercises.filter((x) => info.get(numOf(x))?.num === s.num).sort((a, b) => info.get(numOf(a))!.order - info.get(numOf(b))!.order));
  }
  return out;
}
