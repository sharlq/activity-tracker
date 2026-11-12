// What other packages in this repo (the report CLI) may use from the tracker.
// Everything here only reads; nothing exported can write to the database.
export type { Activity, WindowInfo } from './merger.ts';
export type { StoredEvent } from './store.ts';
export type { ClaudeSession, SessionStats } from './claudeSessions.ts';
export type { Config } from './config.ts';
export { EventReader } from './reader.ts';
export { categoriesFile, dataDir, loadConfig } from './config.ts';
export { classifyGaming, matchesApp } from './gaming.ts';
export { domainMatches, normalizeDomainEntry } from './browser.ts';
export { readClaudeSessions, sessionStats } from './claudeSessions.ts';
export { parseLocalDate } from './dates.ts';
