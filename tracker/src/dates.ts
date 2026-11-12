/** Local midnight of a strict YYYY-MM-DD date in ms, or null if it isn't a real date. */
export function parseLocalDate(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  // Date silently rolls 2026-02-31 over to March, so check nothing moved.
  const real =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return real ? date.getTime() : null;
}
