// The rest timer between sets. It counts down to a moment (endsAt), not by ticks, so a
// locked screen or a reload can't make it drift; it lives in localStorage for the reload.
// At the end: a beep (the first tap on the page unlocks sound), a vibration where the
// phone allows it (not iPhones), and the bar flashes until you tap it.

export interface Rest {
  endsAt: number;
  total: number;
  label: string;
}

const KEY = 'gym.rest';
let rest: Rest | null = load();
let rang = false;
let tick: number | undefined;
let audio: AudioContext | null = null;
const listeners = new Set<() => void>();

function load(): Rest | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Rest | null;
    return r && typeof r.endsAt === 'number' && r.endsAt > Date.now() - 10 * 60_000 ? r : null;
  } catch {
    return null;
  }
}

function save(): void {
  try {
    if (rest) localStorage.setItem(KEY, JSON.stringify(rest));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the timer still runs, it just won't survive a reload.
  }
}

/** Call from a tap: browsers only let sound start after one. */
export function unlockSound(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function beep(): void {
  if (!audio) return;
  const t = audio.currentTime;
  for (const [i, f] of [880, 880, 1320].entries()) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = f;
    o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t + i * 0.25);
    g.gain.exponentialRampToValueAtTime(0.4, t + i * 0.25 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.25 + 0.2);
    o.connect(g).connect(audio.destination);
    o.start(t + i * 0.25);
    o.stop(t + i * 0.25 + 0.22);
  }
}

export const restNow = (): Rest | null => rest;
export const remaining = (): number => (rest ? Math.max(0, Math.ceil((rest.endsAt - Date.now()) / 1000)) : 0);
export const onRest = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((fn) => fn());

function loop(): void {
  window.clearInterval(tick);
  if (!rest) return;
  tick = window.setInterval(() => {
    if (rest && !rang && remaining() === 0) {
      rang = true;
      beep();
      navigator.vibrate?.([300, 150, 300, 150, 300]);
    }
    emit();
  }, 250);
}

export function startRest(seconds: number, label: string): void {
  rest = { endsAt: Date.now() + seconds * 1000, total: seconds, label };
  rang = false;
  save();
  loop();
  emit();
}

export function addRest(seconds: number): void {
  if (!rest) return;
  const left = Math.max(0, rest.endsAt - Date.now()) + seconds * 1000;
  rest = { ...rest, endsAt: Date.now() + Math.max(0, left), total: Math.max(rest.total + seconds, 1) };
  if (left > 0) rang = false;
  save();
  emit();
}

export function stopRest(): void {
  rest = null;
  save();
  loop();
  emit();
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// A timer that ended while the page was away still shows as over, without a late beep.
if (rest) {
  rang = remaining() === 0;
  loop();
}
// Back from the lock screen: show the right time at once.
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && emit());

// ------------------------------------------------------------------ keep the screen on

let lock: WakeLockSentinel | null = null;
let wantLock = (() => {
  try {
    return localStorage.getItem('gym.awake') === '1';
  } catch {
    return false;
  }
})();

export const canKeepAwake = () => 'wakeLock' in navigator;
export const keepingAwake = () => wantLock;

async function takeLock(): Promise<void> {
  if (!wantLock || !canKeepAwake() || document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => (lock = null));
  } catch {
    lock = null;
  }
}

export async function setKeepAwake(on: boolean): Promise<void> {
  wantLock = on;
  try {
    localStorage.setItem('gym.awake', on ? '1' : '0');
  } catch {
    // Fine: it just won't be remembered.
  }
  if (on) await takeLock();
  else await lock?.release();
}

// The browser drops the lock when the page hides; take it again on return.
document.addEventListener('visibilitychange', () => void takeLock());
void takeLock();
