// Small size-based rotating log: tracker.log, tracker.1.log ... tracker.N.log.
//
// Privacy: log only service state. Window titles, paths, and excluded apps must
// never be passed here, because `purge` does not touch log files.
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

/** Local time with its UTC offset, e.g. 2026-11-06T23:26:05.123+02:00, so it matches your clock. */
export function localTimestamp(date: Date): string {
  const pad = (n: number, width = 2) => String(Math.trunc(Math.abs(n))).padStart(width, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

export interface LoggerOptions {
  file: string;
  maxBytes?: number;
  /** Rotated files to keep, not counting the live one. */
  maxFiles?: number;
  echo?: boolean;
}

export class Logger {
  private readonly file: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly echo: boolean;
  private size: number;

  constructor({ file, maxBytes = 5 * 1024 * 1024, maxFiles = 5, echo = false }: LoggerOptions) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
    this.echo = echo;
    mkdirSync(dirname(file), { recursive: true });
    try {
      this.size = statSync(file).size;
    } catch {
      this.size = 0;
    }
  }

  info(message: string): void {
    this.write('INFO', message);
  }

  warn(message: string): void {
    this.write('WARN', message);
  }

  error(message: string, error?: unknown): void {
    const detail = error instanceof Error ? (error.stack ?? error.message) : error;
    this.write('ERROR', detail === undefined ? message : `${message}: ${String(detail)}`);
  }

  private rotatedName(index: number): string {
    const { dir, name, ext } = parse(this.file);
    return join(dir, `${name}.${index}${ext}`);
  }

  private rotate(): void {
    rmSync(this.rotatedName(this.maxFiles), { force: true });
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      rmSync(this.rotatedName(i + 1), { force: true });
      try {
        renameSync(this.rotatedName(i), this.rotatedName(i + 1));
      } catch {
        // That slot has not been used yet.
      }
    }
    renameSync(this.file, this.rotatedName(1));
    this.size = 0;
  }

  private write(level: string, message: string): void {
    const line = `${localTimestamp(new Date())} ${level} ${message}\n`;
    if (this.echo) process.stdout.write(line);
    // A logging failure must never take the tracker down with it.
    try {
      const bytes = Buffer.byteLength(line);
      if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
      appendFileSync(this.file, line);
      this.size += bytes;
    } catch {
      // Nowhere left to report it.
    }
  }
}
