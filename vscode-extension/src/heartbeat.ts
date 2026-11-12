// Decides what to send and when. No VS Code APIs here, so it can be tested.

/** Everything the extension ever sends. There is deliberately no field for file names or contents. */
export interface Heartbeat {
  workspace: string | null;
  language: string | null;
  branch: string | null;
}

/** While nothing changes, one heartbeat per this interval is enough. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

export function sameHeartbeat(a: Heartbeat, b: Heartbeat): boolean {
  return a.workspace === b.workspace && a.language === b.language && a.branch === b.branch;
}

/**
 * Sends straight away when something changes (a new file, language, or branch),
 * otherwise at most once per interval, however fast you type.
 */
export class HeartbeatGate {
  private last: Heartbeat | null = null;
  private lastAt = -Infinity;

  shouldSend(heartbeat: Heartbeat, now: number): boolean {
    const changed = this.last === null || !sameHeartbeat(this.last, heartbeat);
    if (!changed && now - this.lastAt < HEARTBEAT_INTERVAL_MS) return false;
    this.last = heartbeat;
    this.lastAt = now;
    return true;
  }

  /** After a failed send, let the next activity try again immediately. */
  forget(): void {
    this.last = null;
    this.lastAt = -Infinity;
  }
}

/** Builds the payload from exactly three values, so nothing else can leak into it. */
export function heartbeat(workspace: string | undefined, language: string | undefined, branch: string | undefined): Heartbeat {
  return { workspace: workspace || null, language: language || null, branch: branch || null };
}
