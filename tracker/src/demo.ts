// A demo profile: a made-up person's four weeks in رقيب, in its own data folder, for
// screenshots and screen recordings that show the app without showing your day.
//
//   raqib demo [--reset] [--tabs today,week,projects,health] [--port 5630]
//
// It serves only the window (nothing is recorded), from %USERPROFILE%\.activity-tracker-demo,
// with its own categories and no Claude Code logs, at its own address,
// http://raqib-demo.localhost:5630, so it never shares a sign-in cookie with the real window
// (127.0.0.1:5610) and the two can't be mixed up on screen.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Store } from './store.ts';

export const DEMO_DIR = join(homedir(), '.activity-tracker-demo');
/** Away from the real window's 5610, with room above it: a taken port moves the demo up, never onto production. */
export const DEMO_PORT = 5630;
/** The demo's own address. Browsers send every *.localhost name to this PC, and the demo answers to no other. */
export const DEMO_HOST = 'raqib-demo.localhost';
export const DEMO_TABS_DEFAULT = ['today', 'week', 'projects', 'health'];
export const ALL_TABS = ['today', 'morning', 'evening', 'week', 'projects', 'health', 'reminders', 'settings'];

const MIN = 60_000;
const HOUR = 60 * MIN;

// ------------------------------------------------------------------ randomness

/** Same seed, same profile: a re-seed gives the same story. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    chance: (p: number) => next() < p,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T,
    weighted: <T>(list: readonly [T, number][]): T => {
      let r = next() * list.reduce((s, [, w]) => s + w, 0);
      for (const [v, w] of list) if ((r -= w) <= 0) return v;
      return list[list.length - 1]![0];
    },
  };
}

// ------------------------------------------------------------------ what the PC saw

interface Win {
  process: string;
  exe?: string;
  title: string;
  domain?: string;
  project?: string;
  language?: string;
  branch?: string;
  call?: string;
}

const CODE = 'C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const site = (domain: string, title: string): Win => ({ process: 'chrome', exe: CHROME, domain, title: `${title} - Google Chrome` });
const code = (file: string, language: string, branch = 'main'): Win => ({ process: 'Code', exe: CODE, title: `${file} - raqib - Visual Studio Code`, project: 'raqib', language, branch });

const MIX: Record<string, [Win, number][]> = {
  build: [
    [code('app.js', 'javascript', 'week-view'), 5],
    [code('ui.ts', 'typescript', 'week-view'), 5],
    [code('report.ts', 'typescript', 'week-view'), 3],
    [code('style.css', 'css', 'week-view'), 2],
    [{ process: 'WindowsTerminal', title: 'npm test' }, 2],
    [{ process: 'claude', title: 'Claude' }, 3],
    [site('github.com', 'Pull requests · raqib'), 1],
    [site('localhost', 'رقيب · Week'), 2],
    [site('developer.mozilla.org', 'CSS Grid Layout - MDN'), 1],
    [site('stackoverflow.com', 'SQLite window functions'), 1],
  ],
  learn: [
    [site('udemy.com', 'System Design for Beginners - Course'), 4],
    [site('coursera.org', 'Databases: Relational Design - Course'), 2],
    [site('wikipedia.org', 'Habit formation - Wikipedia'), 1],
    [site('developer.mozilla.org', 'Using IndexedDB - MDN'), 1],
  ],
  social: [
    [site('instagram.com', 'Instagram'), 4],
    [site('x.com', 'Home / X'), 3],
    [site('reddit.com', 'r/webdev'), 2],
    [site('linkedin.com', 'Feed | LinkedIn'), 1],
  ],
  video: [[site('youtube.com', 'How I built my productivity app - YouTube'), 3], [site('youtube.com', 'Football highlights - YouTube'), 2]],
  watch: [[site('netflix.com', 'Netflix'), 4], [site('shahid.mbc.net', 'Shahid'), 1]],
  chat: [[{ process: 'WhatsApp.Root', title: 'WhatsApp' }, 3], [{ process: 'Discord', title: 'Discord | #indie-devs' }, 1]],
  news: [[site('aljazeera.net', 'Al Jazeera'), 2], [site('bbc.com', 'BBC News'), 1]],
  game: [[{ process: 'RocketLeague', exe: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\rocketleague\\Binaries\\Win64\\RocketLeague.exe', title: 'Rocket League' }, 3], [site('chess.com', 'Play Chess Online'), 2]],
  call: [[{ process: 'Code', exe: CODE, title: 'ui.ts - raqib - Visual Studio Code', project: 'raqib', language: 'typescript', call: 'Discord' }, 1]],
  // The day job, on the same laptop: another codebase, its tickets, its chat, its meetings.
  job: [
    [{ process: 'Code', exe: CODE, title: 'PaymentService.java - billing-service - Visual Studio Code', project: 'billing-service', language: 'java', branch: 'feature/BILL-482-refunds' }, 6],
    [{ process: 'Code', exe: CODE, title: 'InvoiceTable.tsx - billing-dashboard - Visual Studio Code', project: 'billing-dashboard', language: 'typescriptreact', branch: 'fix/BILL-497' }, 3],
    [{ process: 'WindowsTerminal', title: 'mvn test' }, 2],
    [site('atlassian.net', 'BILL-482 Partial refunds - Jira'), 2],
    [site('github.com', 'Pull request #318 · billing-service'), 2],
    [{ process: 'Postman', title: 'Postman' }, 1],
    [site('stackoverflow.com', 'Spring transactional rollback'), 1],
    [{ process: 'slack', title: 'Slack | #billing-team' }, 2],
    [{ process: 'OUTLOOK', title: 'Inbox - Outlook' }, 1],
  ],
  meet: [
    [{ process: 'ms-teams', title: 'Daily stand-up | Microsoft Teams', call: 'ms-teams' }, 3],
    [{ process: 'chrome', exe: CHROME, domain: 'atlassian.net', title: 'Sprint board - Jira - Google Chrome', call: 'ms-teams' }, 1],
  ],
};

/** What a stretch at the PC is mostly, and how much else creeps in. */
const SESSIONS: Record<string, [string, number][]> = {
  deep: [['build', 14], ['social', 1.4], ['chat', 0.8], ['video', 0.6]],
  study: [['learn', 10], ['build', 2], ['social', 1], ['chat', 0.5]],
  morning: [['news', 3], ['learn', 5], ['chat', 1]],
  loose: [['social', 5], ['video', 4], ['chat', 2], ['news', 1], ['build', 1]],
  wind: [['watch', 8], ['social', 2], ['chat', 1]],
  play: [['game', 10], ['chat', 1], ['video', 1]],
  pair: [['call', 8], ['build', 4]],
  job: [['job', 16], ['social', 0.8], ['chat', 0.6], ['news', 0.4]],
  standup: [['meet', 1]],
};

// ------------------------------------------------------------------ the person's week

interface Block { from: number; to: number; kind: 'pc' | 'life'; what: string; label?: string; category?: string }

const TASKS = [
  'Fix the week chart on small screens', 'Write tests for the gap finder', 'Record a story about the morning page',
  'Reply to the beta testers', 'Sketch the projects page', 'Ship the dark theme', 'Review the evening log copy',
  'Back up the database to USB', 'Plan next week\'s sprint', 'Read 30 pages', 'Call grandma', 'Buy groceries',
  'Pay the internet bill', 'Clean the desk', 'Refactor the report builder', 'Try the new focus-by-hour view',
  'Update the README', 'Stretch for 10 minutes', 'Meal prep for the week', 'Post a build update',
];
const GOALS = [
  '2 hours of deep work on رقيب', 'No social media before noon', 'Hit the protein target', 'Lights out by 23:00',
  'Finish one chapter', 'Train and log every set', 'Ship one small thing', 'Phone stays in the other room while coding',
  'Walk 8,000 steps', 'Under 1 hour of video',
];
const MORNING_NOTES = [
  'Slept well, feeling sharp. Want to finish the week view today.', 'A bit groggy. Coffee first, then the hard task.',
  'Excited about the new feature, mind is racing with ideas.', 'Tired after yesterday\'s leg day, but motivated.',
  'Calm morning. Keeping it simple today.', 'Woke up before the alarm, good sign.', 'Stressed about work deadlines, will protect the evening for building.',
];
const EVENING_NOTES = [
  'Good day. The chart finally works on mobile.', 'Lost an hour to Instagram after dinner, noticed it in the timeline.',
  'Great gym session, new best on squats.', 'Slow day but I showed up. That counts.', 'Shipped the dark theme! Shared it with friends.',
  'Too much YouTube. Tomorrow phone goes in the drawer.', 'Deep work streak felt amazing, 3 hours without checking anything.',
  'Family dinner, no PC tonight and that was fine.',
];
const REVIEWS: [string, string][] = [
  ['Four evenings of deep work on رقيب, and the gym every planned day.', 'Social media creeps in right after dinner. Try a 20-minute walk instead.'],
  ['Shipped the week view and got great feedback.', 'Slept late twice; screens off by 22:30.'],
  ['Squat moved up 5 kg. Logged food every single day.', 'Mornings were wasted on news; start with the hard task.'],
];
const FOODS: Record<'breakfast' | 'lunch' | 'dinner' | 'snack', [string, number, number, number, number][]> = {
  breakfast: [['Oats with banana and whey', 520, 38, 72, 9], ['Eggs, labneh and bread', 610, 34, 48, 30], ['Greek yogurt with honey and granola', 430, 28, 58, 10], ['Foul and eggs', 580, 36, 55, 22]],
  lunch: [['Chicken machboos', 780, 48, 92, 20], ['Shawarma plate', 720, 42, 70, 28], ['Rice, lentils and salad', 640, 26, 104, 12], ['Tuna sandwich and fruit', 560, 38, 66, 14]],
  dinner: [['Grilled salmon, rice and greens', 690, 45, 62, 26], ['Beef kofta with bulgur', 740, 46, 64, 30], ['Chicken pasta', 760, 50, 88, 18], ['Lentil soup and chicken salad', 520, 40, 44, 16]],
  snack: [['Protein shake', 240, 40, 8, 4], ['Dates and almonds', 280, 6, 38, 12], ['Apple and peanut butter', 260, 7, 28, 14], ['Cottage cheese', 180, 24, 8, 5]],
};
const WORKOUT_NOTES = ['Felt strong today.', 'Short on sleep, kept the weights.', 'New best!', 'Busy gym, swapped the order a bit.', null, null];

const at = (dayStart: number, hours: number) => {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(hours), Math.round((hours % 1) * 60)).getTime();
};
const keyOf = (ms: number) => new Date(ms).toLocaleDateString('en-CA');

/** The gym days, Sunday first: Upper A, Lower A, -, Upper B, Lower B on Sun, Mon, Wed, Thu (and nothing else). */
const GYM: Record<number, number> = { 0: 1, 1: 2, 3: 3, 4: 4 };

function dayPlan(dayStart: number, r: ReturnType<typeof rng>): Block[] {
  const dow = new Date(dayStart).getDay();
  const weekend = dow === 5 || dow === 6;
  const j = () => r.between(-0.15, 0.15);
  const b: Block[] = [];
  const life = (from: number, to: number, label: string, category: string) => b.push({ from: at(dayStart, from), to: at(dayStart, to), kind: 'life', what: category, label, category });
  const pc = (from: number, to: number, what: string) => b.push({ from: at(dayStart, from), to: at(dayStart, to), kind: 'pc', what });

  if (!weekend) {
    const wake = 5.1 + j();
    life(wake, wake + 0.35, 'Fajr and quiet time', 'prayer');
    pc(wake + 0.45, 6.4, r.chance(0.6) ? 'morning' : 'study');
    life(6.45, 7, 'Drive to work', 'commute');
    // 07:00 to 16:00 is the day job, on the same laptop: stand-up, coding, lunch, a meeting some days.
    pc(7.05, 9, 'job');
    pc(9, 9.25 + r.between(0, 0.15), 'standup');
    pc(9.45, 12, 'job');
    life(12, 12.6, 'Lunch and Dhuhr', 'meal');
    if (r.chance(0.5)) {
      pc(12.65, 14, 'job');
      pc(14, 14.75, 'standup');
      pc(14.8, 15.95, 'job');
    } else pc(12.65, 15.95, 'job');
    life(16.05, 16.6, 'Drive home', 'commute');
    let t = 16.7;
    if (GYM[dow] !== undefined) {
      life(t, t + 1.3, 'Gym', 'exercise');
      t += 1.45;
    } else {
      pc(t, t + 0.8, 'loose');
      t += 0.9;
    }
    life(t, t + 0.6, 'Dinner with family', 'meal');
    t += 0.7;
    pc(t, t + 0.4, r.chance(0.5) ? 'loose' : 'deep');
    t += 0.5;
    const deepEnd = t + r.between(1.6, 2.6);
    pc(t, deepEnd, dow === 3 ? 'pair' : 'deep');
    pc(deepEnd + 0.1, 22.2 + j(), r.chance(0.55) ? 'wind' : 'loose');
    life(22.3, 22.75, 'Shower and reading in bed', 'sleep routine');
  } else {
    const wake = 7.4 + j();
    life(wake, wake + 0.5, 'Breakfast', 'meal');
    pc(wake + 0.6, wake + 1.1, 'loose');
    pc(wake + 1.2, 12.2, 'deep');
    life(12.3, 13.2, 'Jumu\'ah / lunch out', dow === 5 ? 'prayer' : 'social');
    life(13.3, 14.2, 'Lunch', 'meal');
    if (dow === 6) life(16, 18, 'Football with friends', 'exercise');
    else pc(14.5, 16.5, 'play');
    pc(18.3, 19.4, 'study');
    life(19.5, 21, dow === 5 ? 'Family visit' : 'Coffee with friends', 'social');
    pc(21.1, 23.1, r.chance(0.5) ? 'wind' : 'play');
    life(23.2, 23.6, 'Wind down', 'sleep routine');
  }
  return b;
}

// ------------------------------------------------------------------ writing it

export function seedDemo(dir: string, now: number, seed = 20261115): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'data.db');
  new Store(file).close(); // Creates the schema and the training plan.
  const db = new Database(file);
  const r = rng(seed);
  const today = new Date(now);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const DAYS = 28;
  const dayStarts = Array.from({ length: DAYS + 1 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - DAYS + i).getTime());

  const insEvent = db.prepare('INSERT INTO events (kind, start_ms, end_ms, process_name, exe_path, title, domain, project, language, branch, call) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insAudio = db.prepare('INSERT INTO audio_events (start_ms, end_ms, process_name, exe_path, title, domain) VALUES (?, ?, ?, ?, ?, ?)');
  const insEntry = db.prepare('INSERT INTO entries (start_ms, end_ms, label, category, created_ms) VALUES (?, ?, ?, ?, ?)');
  const insTask = db.prepare('INSERT INTO tasks (day, text, done_ms, created_ms) VALUES (?, ?, ?, ?)');
  const insGoal = db.prepare('INSERT INTO goals (day, text, result, created_ms) VALUES (?, ?, ?, ?)');
  const insCheckin = db.prepare('INSERT INTO checkins (day, part, mood, energy, note, at_ms) VALUES (?, ?, ?, ?, ?, ?)');
  const insPlan = db.prepare('INSERT INTO plan_blocks (day, start_ms, end_ms, label, category, created_ms) VALUES (?, ?, ?, ?, ?, ?)');
  const insFood = db.prepare('INSERT INTO food_entries (day, meal, name, calories, protein_g, carbs_g, fat_g, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insWeigh = db.prepare('INSERT INTO weigh_ins (day, weight_kg, body_fat_pct, waist_cm, updated_ms) VALUES (?, ?, ?, ?, ?)');
  const insWorkout = db.prepare('INSERT INTO workouts (day, start_ms, name, kind, minutes, calories, note, source, plan_day_id, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insSet = db.prepare('INSERT INTO workout_sets (workout_id, position, exercise, set_no, reps, weight_kg, rpe) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const setting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');

  // A made-up body and made-up goals, so none of the real plan's numbers show.
  setting.run('training.heightCm', '178');
  db.prepare('UPDATE exercise_goals SET weight_kg = ROUND(weight_kg * 1.1 / 2.5) * 2.5').run();
  const bodyGoals = db.prepare('SELECT day FROM body_goals ORDER BY day').all() as { day: string }[];
  bodyGoals.forEach(({ day }, i) => db.prepare('UPDATE body_goals SET weight_kg = ?, lean_kg = ? WHERE day = ?').run(76 + i * 1.2, 63 + i * 0.9, day));

  const plan = db.prepare('SELECT e.id, e.day_id AS dayId, e.name, e.sets, e.rep_min AS repMin, e.rep_max AS repMax, e.step_kg AS step, e.bodyweight, g.weight_kg AS goal FROM plan_exercises e LEFT JOIN exercise_goals g ON g.plan_exercise_id = e.id AND g.day = (SELECT MIN(day) FROM checkpoints) WHERE e.active = 1 ORDER BY e.day_id, e.position').all() as {
    id: number; dayId: number; name: string; sets: number; repMin: number; repMax: number; step: number; bodyweight: number; goal: number | null;
  }[];
  const dayNames = new Map((db.prepare('SELECT id, name FROM plan_days').all() as { id: number; name: string }[]).map((d) => [d.id, d.name]));
  // Where each lift starts four weeks ago: a bit under the first goal, so the chart climbs toward it.
  const lift = new Map(plan.map((e) => [e.id, { weight: Math.max(e.step, Math.round(((e.goal ?? 20) * 0.88) / e.step) * e.step), reps: e.repMin }]));

  db.transaction(() => {
    let weight = 77.6;
    for (const dayStart of dayStarts) {
      const key = keyOf(dayStart);
      const isToday = dayStart === todayStart;
      const created = dayStart - 2 * HOUR;
      const blocks = dayPlan(dayStart, r);
      const dow = new Date(dayStart).getDay();

      // Last night's sleep, logged in the evening log (sometimes forgotten: then it's estimated).
      const bed = at(dayStart, -1.2 + r.between(-0.3, 0.5));
      const firstLife = blocks[0]!.from;
      if (dayStart >= todayStart - 3 * 86_400_000 || r.chance(0.9)) insEntry.run(bed, firstLife - 5 * MIN, 'Sleep', 'sleep', created);

      // The plan made the night before: roughly the day as it then went.
      for (const block of blocks) {
        if (block.kind === 'pc' && (block.what === 'deep' || block.what === 'study' || block.what === 'pair')) {
          insPlan.run(key, at(dayStart, Math.round((new Date(block.from).getHours() + new Date(block.from).getMinutes() / 60) * 2) / 2), block.to, block.what === 'study' ? 'Study' : 'Build رقيب', block.what === 'study' ? 'learning' : 'work', created);
        } else if (block.kind === 'life' && block.category === 'exercise') {
          insPlan.run(key, block.from, block.to, block.label ?? block.what, block.category ?? null, created);
        }
      }

      for (const block of blocks) {
        if (block.from >= now) break;
        const end = Math.min(block.to, now);
        if (block.kind === 'life') {
          // Most time away gets logged; a few stretches are left for the evening log to ask about.
          if (block.label === 'Day job' || r.chance(isToday ? 0.85 : 0.94)) insEntry.run(block.from, end, block.label ?? block.what, block.category ?? null, block.to);
          continue;
        }
        let t = block.from;
        const mix = SESSIONS[block.what]!;
        while (t < end - MIN) {
          const kind = r.weighted(mix);
          const win = r.weighted(MIX[kind]!);
          const len = Math.min(end - t, (kind === 'build' || kind === 'job' || kind === 'meet' || kind === 'learn' || kind === 'game' || kind === 'watch' || kind === 'call' ? r.between(8, 28) : r.between(2, 9)) * MIN);
          insEvent.run('window', t, t + len, win.process, win.exe ?? null, win.title, win.domain ?? null, win.project ?? null, win.language ?? null, win.branch ?? null, win.call ?? null);
          t += len;
          if (t < end - 3 * MIN && r.chance(0.12)) {
            const idle = Math.min(end - t, r.between(2.5, 7) * MIN);
            insEvent.run('idle', t, t + idle, null, null, null, null, null, null, null, null);
            t += idle;
          }
        }
        // A podcast or lo-fi behind the coding.
        if ((block.what === 'deep' || block.what === 'study') && r.chance(0.6)) {
          const s = block.from + r.between(5, 20) * MIN;
          const e = Math.min(end, s + r.between(35, 80) * MIN);
          if (e > s) insAudio.run(s, e, 'Spotify', 'C:\\Users\\demo\\AppData\\Roaming\\Spotify\\Spotify.exe', r.pick(['Lo-fi beats to code to', 'Indie Hackers podcast', 'Thmanyah podcast', 'Syntax podcast']), null);
        }
      }

      // Phone time, logged in the evening log.
      if (!isToday && r.chance(0.6)) {
        const s = at(dayStart, r.pick([13, 15.5, 21]));
        insEntry.run(s, s + r.between(15, 45) * MIN, 'Phone: Instagram/TikTok', 'social media', s + HOUR);
      }

      // How the day felt, what it was for, and what got done.
      const morningAt = blocks[1]?.from ?? dayStart + 6 * HOUR;
      const good = r.next();
      if (morningAt < now) insCheckin.run(key, 'morning', r.int(3, 5), r.int(2, 5), r.pick(MORNING_NOTES), morningAt);
      if (!isToday) insCheckin.run(key, 'evening', good > 0.25 ? r.int(4, 5) : r.int(2, 3), r.int(2, 4), r.pick(EVENING_NOTES), at(dayStart, 22.2));
      const goals = new Set<string>();
      while (goals.size < r.int(2, 3)) goals.add(r.pick(GOALS));
      for (const g of goals) insGoal.run(key, g, isToday ? null : r.weighted([['met', 9], ['partly', 3], ['missed', 1]] as [string, number][]), created);
      const tasks = new Set<string>();
      while (tasks.size < r.int(3, 5)) tasks.add(r.pick(TASKS));
      for (const t of tasks) {
        const doneAt = isToday ? (r.chance(0.4) && morningAt < now ? Math.min(now - 10 * MIN, morningAt + HOUR) : null) : r.chance(0.78) ? at(dayStart, r.between(17, 22)) : null;
        insTask.run(key, t, doneAt, created);
      }

      // Food: three meals and a snack or two, a little higher on training days.
      const meals: (keyof typeof FOODS)[] = isToday ? ['breakfast'] : ['breakfast', 'lunch', 'dinner', 'snack', ...(r.chance(0.5) ? (['snack'] as const) : [])];
      for (const meal of meals) {
        const [name, kcal, p, c, f] = r.pick(FOODS[meal]);
        const k = r.between(0.9, 1.1);
        insFood.run(key, meal, name, Math.round(kcal * k), Math.round(p * k), Math.round(c * k), Math.round(f * k), dayStart + 8 * HOUR);
      }

      // Weighed most mornings: a slow lean bulk with daily noise.
      weight += 0.03;
      if (r.chance(0.7) && morningAt < now) insWeigh.run(key, Math.round((weight + r.between(-0.35, 0.35)) * 10) / 10, Math.round(r.between(15.2, 16.4) * 10) / 10, r.chance(0.3) ? Math.round(r.between(81, 83) * 10) / 10 : null, morningAt);

      // The workout, set by set, progressing the way the plan's engine expects.
      const gymDay = GYM[dow];
      const gym = blocks.find((b) => b.category === 'exercise' && b.label === 'Gym');
      if (gymDay !== undefined && gym && gym.to <= now) {
        const workout = insWorkout.run(key, gym.from, dayNames.get(gymDay) ?? 'Workout', 'strength', Math.round((gym.to - gym.from) / MIN), r.int(380, 520), r.pick(WORKOUT_NOTES), 'manual', gymDay, gym.to).lastInsertRowid;
        let position = 0;
        for (const e of plan.filter((p) => p.dayId === gymDay)) {
          const state = lift.get(e.id)!;
          position++;
          for (let s = 1; s <= e.sets; s++) {
            const reps = Math.max(e.repMin - 1, state.reps - (s - 1) * r.int(0, 1));
            insSet.run(workout, position, e.name, s, reps, e.bodyweight ? null : state.weight, Math.round(r.between(7, 9) * 2) / 2);
          }
          // Double progression: more reps, then more weight back at the bottom of the range.
          if (state.reps >= e.repMax) {
            state.weight += e.step;
            state.reps = e.repMin;
          } else state.reps += r.chance(0.8) ? 1 : 0;
        }
      }
      // Football on Saturdays, logged as a workout too.
      const football = blocks.find((b) => b.label === 'Football with friends');
      if (football && football.to <= now) insWorkout.run(key, football.from, 'Football', 'sport', 120, 900, 'Five-a-side', 'manual', null, football.to);
    }

    // Weekly reviews for the finished weeks.
    const mondays = [...new Set(dayStarts.map((d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return keyOf(x.getTime()); }))];
    mondays.slice(0, -1).slice(-REVIEWS.length).forEach((monday, i) => {
      const [well, change] = REVIEWS[i % REVIEWS.length]!;
      db.prepare('INSERT INTO reviews (week, went_well, to_change, updated_ms) VALUES (?, ?, ?, ?)').run(monday, well, change, now);
    });

    // Projects: the app itself, a book list, a fitness goal, and one finished.
    const start = dayStarts[0]!;
    const project = (name: string, color: string, status: string, due: string | null, match: string[], position: number) =>
      Number(db.prepare('INSERT INTO projects (name, color, status, due_day, position, created_ms, match_words) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name, color, status, due, position, start, JSON.stringify(match)).lastInsertRowid);
    const subtask = (projectId: number, title: string, unit: string | null, total: number | null, position: number, done: boolean, due: string | null = null) =>
      Number(db.prepare('INSERT INTO subtasks (project_id, title, unit, total, done_ms, due_day, position, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(projectId, title, unit, total, done ? now - 3 * 86_400_000 : null, due, position, start).lastInsertRowid);
    const progress = db.prepare('INSERT INTO progress (subtask_id, day, amount, created_ms) VALUES (?, ?, ?, ?)');
    const note = db.prepare('INSERT INTO project_days (project_id, day, note, skipped, updated_ms) VALUES (?, ?, ?, ?, ?)');
    const target = db.prepare('INSERT INTO targets (subtask_id, day, amount) VALUES (?, ?, ?)');
    const inDays = (n: number) => keyOf(todayStart + n * 86_400_000);

    const app = project('Ship رقيب v1', '#0f766e', 'active', inDays(20), ['raqib'], 1);
    subtask(app, 'Morning and evening pages', null, null, 1, true);
    subtask(app, 'Week view with charts', null, null, 2, true);
    const screens = subtask(app, 'Design every screen', 'screens', 12, 3, false, inDays(6));
    const tests = subtask(app, 'Write tests', 'tests', 60, 4, false, inDays(14));
    subtask(app, 'Share the build in stories', null, null, 5, false, inDays(3));
    const book = project('Read 4 books this quarter', '#6b4fc8', 'active', inDays(45), [], 2);
    const pages = subtask(book, 'Atomic Habits', 'pages', 320, 1, false);
    subtask(book, 'Deep Work', 'pages', 296, 2, false);
    const fit = project('Squat 100 kg', '#c8402f', 'active', inDays(80), [], 3);
    subtask(fit, 'Four training days a week', null, null, 1, false);
    subtask(fit, 'Hit 150 g protein daily', null, null, 2, false);
    const arabic = project('Arabic calligraphy basics', '#b8650f', 'paused', null, [], 4);
    subtask(arabic, 'Practise Ruq\'ah letters', 'sheets', 20, 1, false);
    const site = project('Portfolio website', '#2f6bd8', 'done', null, [], 5);
    subtask(site, 'Launch it', null, null, 1, true);

    const NOTES = ['Got the layout right on mobile.', 'Fought a timezone bug for an hour, won.', 'Wrote tests for the gaps.', 'Polished the colours.', 'Small one today, just a review.'];
    dayStarts.forEach((d, i) => {
      const key = keyOf(d);
      if (d > now) return;
      if (r.chance(0.55)) progress.run(screens, key, 1, d + 20 * HOUR);
      if (r.chance(0.6)) progress.run(tests, key, r.int(1, 5), d + 21 * HOUR);
      if (r.chance(0.75)) progress.run(pages, key, r.int(6, 14), d + 23 * HOUR);
      if (GYM[new Date(d).getDay()] !== undefined && d + 19 * HOUR < now) note.run(fit, key, r.pick(['Trained, every set logged.', 'Squats felt smooth.', 'Hit protein too.']), 0, d + 19 * HOUR);
      if (r.chance(0.5)) note.run(app, key, r.pick(NOTES), 0, d + 22 * HOUR);
      else if (r.chance(0.15)) note.run(app, key, 'Family evening, skipped.', 1, d + 22 * HOUR);
      if (i >= DAYS - 1) {
        target.run(tests, key, 4);
        target.run(pages, key, 20);
      }
    });
    for (let n = 1; n <= 6; n++) {
      target.run(tests, inDays(n), 4);
      if (n % 2) target.run(screens, inDays(n), 1);
    }

    // Reminders that look like a real person's.
    const reminder = db.prepare('INSERT INTO reminders (text, schedule, enabled, created_ms) VALUES (?, ?, ?, ?)');
    reminder.run('Drink a glass of water', JSON.stringify({ type: 'every', minutes: 90, from: '08:00', until: '22:00', days: [] }), 1, start);
    reminder.run('Vitamin D and omega-3', JSON.stringify({ type: 'at', times: ['08:30'], days: [] }), 1, start);
    reminder.run('Stand up and stretch', JSON.stringify({ type: 'every', minutes: 60, from: '17:00', until: '23:00', days: [] }), 1, start);
    reminder.run('Pack the gym bag', JSON.stringify({ type: 'at', times: ['06:15'], days: [0, 1, 3, 4] }), 1, start);

    // The morning page already shown today, so opening the window doesn't jump to it.
    setting.run('state.morningShown', JSON.stringify(keyOf(now)));
  })();
  db.close();
}

/** Categories for the demo: the same rules as a fresh install, with nothing personal in them. */
export const DEMO_CATEGORIES = {
  focus: ['work', 'learning'],
  distraction: ['social media', 'video', 'news', 'gaming', 'game launcher'],
  rules: [
    { category: 'meeting', call: '*' },
    { category: 'gaming', gaming: 'game' },
    { category: 'game launcher', gaming: 'launcher' },
    { category: 'gaming', domain: ['chess.com', 'lichess.org'] },
    { category: 'work', project: '*' },
    { category: 'work', process: ['Code', 'claude', 'WindowsTerminal', 'Postman', 'OUTLOOK', 'slack'] },
    { category: 'work', domain: ['github.com', 'stackoverflow.com', 'localhost', 'claude.ai', 'atlassian.net'] },
    { category: 'learning', domain: ['udemy.com', 'coursera.org', 'wikipedia.org', 'developer.mozilla.org'] },
    { category: 'entertainment', domain: ['netflix.com', 'shahid.mbc.net'] },
    { category: 'video', domain: ['youtube.com', 'twitch.tv'] },
    { category: 'social media', domain: ['instagram.com', 'x.com', 'reddit.com', 'linkedin.com', 'tiktok.com'] },
    { category: 'messaging', process: ['WhatsApp.Root', 'WhatsApp', 'Discord', 'Telegram'] },
    { category: 'news', domain: ['aljazeera.net', 'bbc.com'] },
  ],
};

// ------------------------------------------------------------------ the command

export function parseDemoArgs(args: string[]): { reset: boolean; tabs: string[]; port: number; open: boolean } {
  let tabs = DEMO_TABS_DEFAULT;
  let port = DEMO_PORT;
  let reset = false;
  let open = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--reset') reset = true;
    else if (a === '--no-open') open = false;
    else if (a === '--tabs') {
      const list = (args[++i] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
      if (list.includes('all')) tabs = ALL_TABS;
      else {
        const bad = list.filter((t) => !ALL_TABS.includes(t));
        if (bad.length || !list.length) throw new Error(`--tabs takes a list from: ${ALL_TABS.join(', ')} (or "all")`);
        tabs = list;
      }
    } else if (a === '--port') {
      port = Number(args[++i]);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be 1024 to 65535');
    } else throw new Error(`Unknown option ${a}. Usage: raqib demo [--reset] [--tabs today,week,...] [--port 5630] [--no-open]`);
  }
  return { reset, tabs, port, open };
}

export async function runDemo(args: string[]): Promise<number> {
  const options = parseDemoArgs(args);
  // Everything below reads these when called, so the real folder, categories and Claude logs are never touched.
  process.env['ACTIVITY_TRACKER_HOME'] = DEMO_DIR;
  process.env['ACTIVITY_TRACKER_CATEGORIES'] = join(DEMO_DIR, 'categories.json');
  process.env['ACTIVITY_TRACKER_CONFIG'] = join(DEMO_DIR, 'config.json');
  process.env['CLAUDE_CONFIG_DIR'] = join(DEMO_DIR, 'claude');

  if (options.reset) rmSync(DEMO_DIR, { recursive: true, force: true });
  mkdirSync(join(DEMO_DIR, 'claude', 'projects'), { recursive: true });
  writeFileSync(join(DEMO_DIR, 'categories.json'), `${JSON.stringify(DEMO_CATEGORIES, null, 2)}\n`);
  if (!existsSync(join(DEMO_DIR, 'config.json'))) writeFileSync(join(DEMO_DIR, 'config.json'), `${JSON.stringify({ api: { port: options.port } }, null, 2)}\n`);
  if (!existsSync(join(DEMO_DIR, 'data.db'))) {
    seedDemo(DEMO_DIR, Date.now());
    console.log(`Made a demo profile in ${DEMO_DIR}`);
  }

  const { loadConfig } = await import('./config.ts');
  const { Journal } = await import('./journal.ts');
  const { Logger } = await import('./logger.ts');
  const { createUi } = await import('./ui.ts');
  const { createApi, listen } = await import('./api.ts');
  const config = loadConfig();
  const logger = new Logger({ file: join(DEMO_DIR, 'logs', 'demo.log'), echo: false });
  const dbPath = join(DEMO_DIR, 'data.db');
  const journal = new Journal(dbPath);
  const token = randomBytes(24).toString('hex');
  const hostNames = [DEMO_HOST];
  const ui = createUi({ journal, dbPath, config, logger, token, testReminder: async () => {}, testEvening: async () => {}, demo: { tabs: options.tabs }, hostNames });
  const server = createApi(token, { onTab: () => {}, onEditor: () => {}, ui }, logger, hostNames);
  // A port in use (an earlier demo still open, or anything else) moves the demo to the next free one.
  let port = 0;
  for (let candidate = options.port; candidate < options.port + 10 && !port; candidate++) {
    try {
      port = await listen(server, candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      if (candidate === options.port) console.log(`Port ${candidate} is taken; trying the next one.`);
    }
  }
  if (!port) port = await listen(server, 0);
  const url = `http://${DEMO_HOST}:${port}/ui/login?key=${token}&go=${options.tabs[0]}`;
  console.log(`Demo profile at ${url}`);
  console.log(`Tabs: ${options.tabs.join(', ')}. Nothing is recorded. Ctrl+C to stop.`);
  if (options.open) {
    const { openUrl } = await import('./launch.ts');
    // Untagged: the real رقيب's taskbar identity would group the demo under its icon and pin.
    await openUrl(url, undefined, { tag: false }).catch(() => console.log('Open the link above in a browser.'));
  }
  return new Promise<number>(() => {});
}
