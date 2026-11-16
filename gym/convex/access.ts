// Who may call: every function takes the gym key, and the PC's sync takes the sync key.
// Both are long random strings set as Convex environment variables (GYM_KEY, SYNC_KEY);
// the app keeps its key on the phone after the first sign-in.
import { ConvexError } from 'convex/values';

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function check(given: string, name: 'GYM_KEY' | 'SYNC_KEY'): void {
  const want = process.env[name];
  if (!want || want.length < 20) throw new ConvexError(`${name} isn't set on the server (npx convex env set ${name} <long random text>)`);
  if (!same(given, want)) throw new ConvexError('wrong key');
}

export const checkGymKey = (key: string) => check(key, 'GYM_KEY');
export const checkSyncKey = (key: string) => check(key, 'SYNC_KEY');
