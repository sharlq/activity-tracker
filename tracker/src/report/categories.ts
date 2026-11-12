// Category rules from config/categories.json: ordered, first match wins.
//
// Each rule names a category and one or more conditions. Every condition in a
// rule must hold; a condition given as a list holds if any item matches.
//
//   process   app name, with or without .exe, or its full path ("chrome", "Code.exe")
//   exePath   text the program's path contains ("\\Riot Games\\")
//   title     text the window title contains, any case ("Certification")
//   domain    a site, including its subdomains ("youtube.com"); "*" = any site
//   project   an editor workspace name, any case; "*" = any project
//   gaming    "game" or "launcher", using the gaming rules from config.json
import { readFileSync } from 'node:fs';
import type { Activity } from '../merger.ts';
import { domainMatches } from '../browser.ts';
import { classifyGaming, matchesApp } from '../gaming.ts';

export const CATEGORIES = [
  'work',
  'learning',
  'debate',
  'social media',
  'video',
  'news',
  'gaming',
  'game launcher',
  'messaging',
  'other',
  'idle',
] as const;
export type Category = (typeof CATEGORIES)[number];

const CONDITIONS = ['process', 'exePath', 'title', 'domain', 'project', 'gaming'] as const;
type Condition = (typeof CONDITIONS)[number];

export interface Rule {
  category: Category;
  conditions: Partial<Record<Condition, string[]>>;
}

export interface CategoryConfig {
  /** Categories that count as focused work, for switches and focus stretches. */
  focus: Category[];
  /** Categories that count as distraction. Everything else is neutral. */
  distraction: Category[];
  rules: Rule[];
}

export type WindowActivity = Extract<Activity, { kind: 'window' }>;

function categoryList(value: unknown, where: string): Category[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be a list of categories`);
  return value.map((item) => {
    if (!CATEGORIES.includes(item as Category)) {
      throw new Error(`${where}: "${String(item)}" is not a category. Use one of: ${CATEGORIES.join(', ')}`);
    }
    return item as Category;
  });
}

function parseRule(raw: unknown, index: number): Rule {
  const where = `rule ${index + 1}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${where} must be an object`);
  const { category, ...rest } = raw as Record<string, unknown>;
  const [parsedCategory] = categoryList([category], `${where} category`);
  if (parsedCategory === 'idle') throw new Error(`${where}: idle is assigned automatically and can't be used in a rule`);

  const conditions: Rule['conditions'] = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key === 'note') continue; // Free-text comment, ignored.
    if (!CONDITIONS.includes(key as Condition)) {
      throw new Error(`${where}: unknown condition "${key}". Use: ${CONDITIONS.join(', ')}`);
    }
    const list = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(list) || list.length === 0 || list.some((item) => typeof item !== 'string' || item === '')) {
      throw new Error(`${where}: "${key}" must be text or a list of text`);
    }
    if (key === 'gaming' && list.some((item) => item !== 'game' && item !== 'launcher')) {
      throw new Error(`${where}: "gaming" must be "game" or "launcher"`);
    }
    conditions[key as Condition] = list as string[];
  }
  if (Object.keys(conditions).length === 0) throw new Error(`${where} has no conditions, so it would match everything`);
  return { category: parsedCategory as Category, conditions };
}

export function parseCategories(text: string): CategoryConfig {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!Array.isArray(raw['rules'])) throw new Error('"rules" must be a list');
  return {
    focus: categoryList(raw['focus'] ?? [], '"focus"'),
    distraction: categoryList(raw['distraction'] ?? [], '"distraction"'),
    rules: raw['rules'].map(parseRule),
  };
}

export function loadCategories(file: string): CategoryConfig {
  try {
    return parseCategories(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid categories file ${file}: ${(error as Error).message}`);
  }
}

const contains = (haystack: string | null | undefined, needle: string) =>
  haystack !== null && haystack !== undefined && haystack.toLowerCase().includes(needle.toLowerCase());

function conditionHolds(condition: Condition, wanted: string, window: WindowActivity, games: string[]): boolean {
  switch (condition) {
    case 'process':
      return matchesApp(window, wanted);
    case 'exePath':
      return contains(window.exePath, wanted);
    case 'title':
      return contains(window.title, wanted);
    case 'domain':
      return window.domain !== undefined && (wanted === '*' || domainMatches(window.domain, wanted));
    case 'project':
      return window.project !== undefined && (wanted === '*' || window.project.toLowerCase() === wanted.toLowerCase());
    case 'gaming': {
      const kind = classifyGaming(window, games)?.category;
      return wanted === 'game' ? kind === 'gaming' : kind === 'game launcher';
    }
  }
}

export function categorize(activity: Activity, config: CategoryConfig, games: string[]): Category {
  if (activity.kind === 'idle') return 'idle';
  const rule = config.rules.find((r) =>
    Object.entries(r.conditions).every(([condition, values]) =>
      values.some((value) => conditionHolds(condition as Condition, value, activity, games)),
    ),
  );
  return rule?.category ?? 'other';
}

/** The most specific thing to call an activity in a report: project, game, site, or app. */
export function detailOf(activity: Activity, games: string[]): string {
  // Idle time is labelled with what was on screen, if anything.
  if (activity.kind === 'idle') return activity.window ? detailOf({ kind: 'window', ...activity.window }, games) : 'idle';
  const game = classifyGaming(activity, games);
  if (activity.project) return activity.project;
  if (game?.category === 'gaming') return game.gameName;
  if (activity.domain) return activity.domain;
  return activity.processName.replace(/\.exe$/i, '');
}
