// Read-only access to the events database, for reports. Never migrates or writes,
// so a report can run alongside the tracker and can't change the data.
import Database from 'better-sqlite3';
import type { AudioEvent, Entry, ScreenEvent } from './journal.ts';
import { audioFromRow, entryFromRow, screenFromRow } from './journal.ts';
import type { StoredEvent } from './store.ts';
import { fromRow } from './store.ts';

export class EventReader {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path, { readonly: true, fileMustExist: true });
    this.db.pragma('busy_timeout = 5000');
  }

  /** Events overlapping [from, to), clipped to that window, oldest first. */
  eventsBetween(from: number, to: number): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms, id')
      .all(to, from) as Parameters<typeof fromRow>[0][];
    return rows.map((row) => {
      const event = fromRow(row);
      return { ...event, start: Math.max(event.start, from), end: Math.min(event.end, to) };
    });
  }

  /** Background audio overlapping [from, to), clipped. Empty for a database from before رقيب. */
  audioBetween(from: number, to: number): AudioEvent[] {
    const rows = this.optional(() =>
      this.db.prepare('SELECT * FROM audio_events WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms, id').all(to, from),
    ) as Parameters<typeof audioFromRow>[0][];
    return rows.map(audioFromRow).map((e) => ({ ...e, start: Math.max(e.start, from), end: Math.min(e.end, to) }));
  }

  /** What was on the other screens, overlapping [from, to), clipped. Empty for older databases. */
  screensBetween(from: number, to: number): ScreenEvent[] {
    const rows = this.optional(() =>
      this.db.prepare('SELECT * FROM screen_events WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms, id').all(to, from),
    ) as Parameters<typeof screenFromRow>[0][];
    return rows.map(screenFromRow).map((e) => ({ ...e, start: Math.max(e.start, from), end: Math.min(e.end, to) }));
  }

  /** What you logged yourself, overlapping [from, to). */
  entriesBetween(from: number, to: number): Entry[] {
    const rows = this.optional(() =>
      this.db.prepare('SELECT * FROM entries WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms, id').all(to, from),
    ) as Parameters<typeof entryFromRow>[0][];
    return rows.map(entryFromRow);
  }

  /** The tables رقيب added don't exist until the tracker has run once with them. */
  private optional(query: () => unknown[]): unknown[] {
    try {
      return query();
    } catch (error) {
      if (/no such table/.test((error as Error).message)) return [];
      throw error;
    }
  }

  /** The newest event, or null for an empty database. */
  lastEvent(): StoredEvent | null {
    const row = this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 1').get() as Parameters<typeof fromRow>[0] | undefined;
    return row ? fromRow(row) : null;
  }

  close(): void {
    this.db.close();
  }
}
