/** Keeps reports young enough to use, newest last, capped in number. */
export function rememberRecent<T extends { receivedAt: number }>(
  list: readonly T[],
  item: T,
  maxAgeMs: number,
  maxCount = 20,
): T[] {
  return [...list.filter((old) => item.receivedAt - old.receivedAt <= maxAgeMs), item].slice(-maxCount);
}
