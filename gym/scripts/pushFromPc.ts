// Copies رقيب's training plan and workout history from the PC's database up to Convex, by
// hand. رقيب does the same by itself when it starts and when its window opens (see
// tracker/src/gymSync.ts, which this uses); this is for the first push and for
// --replace-plan.
//
//   SYNC_KEY=... npm run push-from-pc            (uses VITE_CONVEX_URL from .env.local)
//   SYNC_KEY=... npm run push-from-pc -- --replace-plan   (overwrite the phone's plans with the PC's)
//   SYNC_KEY=... CONVEX_URL=https://... npm run push-from-pc
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pushToGym } from '../../tracker/src/gymSync.ts';

function envFile(): Record<string, string> {
  const file = new URL('../.env.local', import.meta.url);
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => /^([A-Z_]+)=(.*?)(\s*#.*)?$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1] as string, (m[2] as string).replace(/^["']|["']$/g, '')]),
  );
}

const env = envFile();
const url = process.env['CONVEX_URL'] ?? env['VITE_CONVEX_URL'];
const key = process.env['SYNC_KEY'] ?? env['SYNC_KEY'];
if (!url || !key) {
  console.error('Set SYNC_KEY (and CONVEX_URL, or VITE_CONVEX_URL in gym/.env.local).');
  process.exit(1);
}
const home = process.env['ACTIVITY_TRACKER_HOME'] ?? join(homedir(), '.activity-tracker');
const r = await pushToGym(join(home, 'data.db'), { url: url.replace(/\/+$/, ''), syncKey: key }, { replacePlan: process.argv.includes('--replace-plan') });
console.log(r.planPushed ? 'Plan: sent, as "Main plan"' : 'Plan: left as it is (the phone has plans; --replace-plan overwrites them)');
console.log(`Workouts: ${r.workouts} on the PC, ${r.added} added, ${r.updated} changed`);
