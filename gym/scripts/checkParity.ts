// Checks that the cloud gives the same suggestions as the PC: today's view for every plan
// day, from both, side by side. Run after a push: npm run check-parity
import Database from 'better-sqlite3';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../../tracker/src/journal.ts';
import { todayView } from '../../tracker/src/trainingPlan.ts';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((l) => /^([A-Z_]+)=(\S*)/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], m[2]]),
) as Record<string, string>;
const client = new ConvexHttpClient(process.env['CONVEX_URL'] ?? env['VITE_CONVEX_URL']!);
// A copy, so the live database is only read.
const copy = join(tmpdir(), `raqib-parity-${Date.now()}.db`);
const live = new Database(join(process.env['ACTIVITY_TRACKER_HOME'] ?? join(homedir(), '.activity-tracker'), 'data.db'), { readonly: true });
await live.backup(copy);
live.close();
const journal = new Journal(copy);
const date = new Date().toISOString().slice(0, 10);

let differences = 0;
for (const day of journal.planDays()) {
  const pc = todayView(journal, date, day.id)!;
  const cloud = await client.query(anyApi['training']!['today']!, { key: env['GYM_KEY'], date, dayNum: day.id });
  for (const e of pc.exercises) {
    const c = cloud.exercises.find((x: { num: number }) => x.num === e.state.exercise.id);
    const a = JSON.stringify([e.state.suggestedLabel, e.state.suggestion.beat, e.state.progress?.status, e.state.flags.map((f) => f.kind)]);
    const b = JSON.stringify([c?.suggestedLabel, c?.beat, c?.progress?.status, c?.flags.map((f: { kind: string }) => f.kind)]);
    if (a !== b) {
      differences++;
      console.log(`${day.name} / ${e.state.exercise.name}\n  pc    ${a}\n  cloud ${b}`);
    }
  }
}
console.log(differences ? `${differences} differences` : 'Same suggestions, goals and flags on every exercise');
journal.close();
process.exit(differences ? 1 : 0);
