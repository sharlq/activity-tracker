// The rest timer as a floating badge over other apps, made for the iPhone first. A page
// can't draw outside the browser, but Picture-in-Picture can float a video, so the badge
// is a video: public/rest-clock.mp4 (scripts/makeRestClock.ts) counts down from 15:00
// and then on in teal past 0:00. The page seeks it to the rest's remaining time and lets
// it play. That matters on iPhones: Safari stops a page's scripts soon after you switch
// apps, but a playing video keeps going, so the badge keeps time with nothing running.
// Tap ⧉ on the timer bar to float it; close it with the badge's own controls.
import { onRest, restNow } from './timer.ts';

const DOWN = 15 * 60; // the clip's countdown, in step with scripts/makeRestClock.ts
const LENGTH = DOWN + 10 * 60;

type PipVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture' | 'fullscreen') => void;
  webkitPresentationMode?: string;
};

let video: PipVideo | null = null;

const standard = () => 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
const webkit = (v: PipVideo) => typeof v.webkitSupportsPresentationMode === 'function' && v.webkitSupportsPresentationMode('picture-in-picture');

export function canFloat(): boolean {
  return standard() || webkit(document.createElement('video') as PipVideo);
}

export const floating = (): boolean => !!video && (document.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture');

function setup(): PipVideo {
  if (video) return video;
  const v = document.createElement('video') as PipVideo;
  v.src = '/rest-clock.mp4';
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.setAttribute('playsinline', '');
  v.setAttribute('muted', '');
  // Safari may float a playing video by itself when you swipe home.
  v.setAttribute('autopictureinpicture', '');
  v.setAttribute('aria-hidden', 'true');
  v.tabIndex = -1;
  // In the page (Safari needs that) but out of sight and out of the way.
  v.style.cssText = 'position:fixed;left:0;bottom:0;width:160px;height:90px;opacity:0;pointer-events:none;z-index:-1';
  v.addEventListener('loadedmetadata', sync);
  document.body.append(v);
  video = v;
  return v;
}

/** Where in the clip the rest is now: the countdown part, or past it when the rest is over. */
function target(): number | null {
  const r = restNow();
  if (!r) return null;
  const ms = r.endsAt - Date.now();
  return Math.min(LENGTH - 1, Math.max(0, DOWN - ms / 1000));
}

function sync(): void {
  const v = video;
  if (!v) return;
  const t = target();
  if (t === null) {
    v.pause();
    if (floating()) void leave(v);
    return;
  }
  if (v.readyState >= 1 && Math.abs(v.currentTime - t) > 0.75) v.currentTime = t;
  if (v.paused && !v.ended) void v.play().catch(() => undefined);
}

async function leave(v: PipVideo): Promise<void> {
  try {
    if (document.pictureInPictureElement === v) await document.exitPictureInPicture();
    else v.webkitSetPresentationMode?.('inline');
  } catch {
    // Already back.
  }
}

/**
 * Call straight from a tap: float the timer, or bring it back. Safari only floats on the
 * tap itself, so nothing here waits before asking.
 */
export async function toggleFloat(): Promise<boolean> {
  const v = setup();
  if (floating()) {
    await leave(v);
    return true;
  }
  const t = target();
  if (t !== null && v.readyState >= 1) v.currentTime = t;
  const playing = v.play().catch(() => undefined);
  try {
    if (webkit(v) && v.webkitSetPresentationMode) {
      v.webkitSetPresentationMode('picture-in-picture');
    } else {
      // Chrome wants the clip loaded first; the tap still counts for a few seconds.
      if (v.readyState < 1) await new Promise((ok) => v.addEventListener('loadedmetadata', ok, { once: true }));
      await playing;
      await v.requestPictureInPicture();
    }
    return true;
  } catch {
    return false;
  }
}

// While a rest runs the clip plays, kept to the clock (a +30 or −30 moves it); when the
// rest ends in the app, the badge goes too.
onRest(() => {
  if (restNow() && canFloat()) setup();
  sync();
});
if (restNow() && canFloat()) setup();

// Newer Chrome floats on its own when you switch away, if the page offers this.
try {
  navigator.mediaSession?.setActionHandler('enterpictureinpicture' as MediaSessionAction, () => {
    if (restNow()) void toggleFloat();
  });
} catch {
  // Not offered here: the ⧉ button still works.
}
