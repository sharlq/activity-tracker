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

function check(given: string, name: 'GYM_KEY' | 'SYNC_KEY', min: number): void {
  const want = process.env[name];
  if (!want) throw new ConvexError(`${name} isn't set on the server (Convex dashboard → Settings → Environment Variables)`);
  if (want.length < min) throw new ConvexError(`${name} on the server is too short: use at least ${min} characters`);
  if (!same(given, want)) throw new ConvexError('wrong key');
}

/** Typed on the phone once, so it may be a short password; the sync key is only ever pasted. */
export const checkGymKey = (key: string) => check(key, 'GYM_KEY', 8);
export const checkSyncKey = (key: string) => check(key, 'SYNC_KEY', 20);
