// Adds a site or app to a category in config/categories.json, from the window.
//
// The file is edited as text, not rewritten, so its layout, grouping, and notes
// stay as you wrote them. Everything added this way goes into one rule per
// category, marked with ADDED_NOTE, placed right after the call rule (or first),
// so it wins over the broader rules below it. The result is parsed before it's
// saved: a change that would break the file is never written.
import { parseCategories } from './report/categories.ts';
import type { Category } from './report/categories.ts';

export const ADDED_NOTE = 'Added in رقيب';

export interface Assignment {
  category: Category;
  kind: 'domain' | 'process';
  value: string;
}

export function addToCategories(text: string, { category, kind, value }: Assignment): string {
  const lines = text.split(/\r?\n/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  // Already added to this category: extend its list.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!line.includes(ADDED_NOTE)) continue;
    const trailing = line.trimEnd().endsWith(',');
    let rule: Record<string, unknown>;
    try {
      rule = JSON.parse(line.trim().replace(/,$/, '')) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (rule['category'] !== category || !Array.isArray(rule[kind]) || Object.keys(rule).length !== 3) continue;
    const list = rule[kind] as string[];
    if (!list.some((v) => v.toLowerCase() === value.toLowerCase())) list.push(value);
    lines[i] = `${line.match(/^\s*/)?.[0] ?? ''}${ruleText(category, kind, list)}${trailing ? ',' : ''}`;
    return checked(lines.join(eol));
  }

  const rule = `${ruleText(category, kind, [value])},`;
  const start = lines.findIndex((l) => /"rules"\s*:\s*\[/.test(l));
  if (start < 0) throw new Error('categories.json has no "rules" list');
  const callRule = lines.findIndex((l, i) => i > start && /"call"\s*:/.test(l));
  const at = callRule >= 0 ? callRule + 1 : start + 1;
  const indent = (lines[at] ?? '').match(/^\s*/)?.[0] || '    ';
  lines.splice(at, 0, `${indent}${rule}`);
  return checked(lines.join(eol));
}

/** One rule on one line, in the file's own style. */
function ruleText(category: Category, kind: Assignment['kind'], values: string[]): string {
  const j = (v: string) => JSON.stringify(v);
  return `{ "category": ${j(category)}, "${kind}": [${values.map(j).join(', ')}], "note": ${j(ADDED_NOTE)} }`;
}

function checked(text: string): string {
  parseCategories(text); // Throws on anything that would break the file.
  return text;
}
