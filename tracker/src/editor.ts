// Attaches what the VS Code / Cursor extension reported to the editor window being recorded.
//
// Like the browser, the window tracker decides *when* the editor is in front; the
// extension adds *which project*. A report is used only if the window title
// contains its workspace name, so with several editor windows open, each one
// gets its own project. Unlike Chrome, an editor window without a report is still
// recorded: there's no private mode to protect, just less detail.
import { rememberRecent } from './recent.ts';

const EDITOR_PROCESSES = new Set(['code.exe', 'code - insiders.exe', 'cursor.exe']);

/**
 * The extension reports while you type or move around, at most every 15s. Reading
 * without touching anything for two minutes makes you idle anyway.
 */
export const EDITOR_FRESH_MS = 120_000;

export interface EditorReport {
  workspace: string | null;
  language: string | null;
  branch: string | null;
  receivedAt: number;
}

export interface EditorContext {
  project?: string;
  language?: string;
  branch?: string;
}

export function rememberEditorReport(reports: readonly EditorReport[], report: EditorReport): EditorReport[] {
  return rememberRecent(reports, report, EDITOR_FRESH_MS);
}

export function editorContext(
  window: { processName: string; title: string },
  reports: readonly EditorReport[],
  now: number,
): EditorContext | null {
  if (!EDITOR_PROCESSES.has(window.processName.toLowerCase())) return null;
  const report = reports.findLast(
    (r) => r.workspace !== null && window.title.includes(r.workspace) && now - r.receivedAt <= EDITOR_FRESH_MS,
  );
  if (!report || report.workspace === null) return null;
  return {
    project: report.workspace,
    ...(report.language ? { language: report.language } : {}),
    ...(report.branch ? { branch: report.branch } : {}),
  };
}
