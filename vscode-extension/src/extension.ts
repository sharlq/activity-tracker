// Sends a heartbeat while the editor is focused and you're typing or moving around.
import * as vscode from 'vscode';
import { HeartbeatGate, heartbeat } from './heartbeat.ts';
import type { Connection } from './tracker.ts';
import { discover, sendHeartbeat } from './tracker.ts';

/** The parts of the built-in Git extension's API we use. */
interface GitApi {
  getRepository(uri: vscode.Uri): { state: { HEAD?: { name?: string } } } | null;
  repositories: Array<{ state: { HEAD?: { name?: string } } }>;
}

let git: GitApi | null | undefined;

async function gitApi(): Promise<GitApi | null> {
  if (git !== undefined) return git;
  try {
    const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
    git = extension ? (await extension.activate()).getAPI(1) : null;
  } catch {
    git = null; // Git disabled or missing: branches are simply left out.
  }
  return git;
}

async function currentBranch(document: vscode.TextDocument | undefined): Promise<string | undefined> {
  const api = await gitApi();
  if (!api) return undefined;
  const repository = (document && api.getRepository(document.uri)) ?? api.repositories[0];
  return repository?.state.HEAD?.name;
}

export function activate(context: vscode.ExtensionContext): void {
  const gate = new HeartbeatGate();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
  status.command = 'activityTracker.showStatus';
  let connection: Connection | null = null;
  let lastMessage = 'Nothing sent yet.';

  const showResult = (ok: boolean, message: string): void => {
    lastMessage = message;
    status.text = ok ? '$(pulse) رقيب' : '$(warning) رقيب';
    status.tooltip = `Personal Activity Tracker: ${message}`;
    status.show();
  };

  const beat = async (): Promise<void> => {
    if (!vscode.window.state.focused) return;
    const document = vscode.window.activeTextEditor?.document;
    const payload = heartbeat(vscode.workspace.name, document?.languageId, await currentBranch(document));
    if (!gate.shouldSend(payload, Date.now())) return;

    connection ??= await discover();
    if (!connection) {
      gate.forget();
      showResult(false, 'رقيب not found. Start it, and it will be picked up automatically.');
      return;
    }
    const result = await sendHeartbeat(connection, payload);
    if (result.ok) {
      showResult(true, `Connected (last heartbeat ${new Date().toLocaleTimeString()})`);
    } else {
      // The tracker may have restarted on another port or with a new token.
      connection = null;
      gate.forget();
      showResult(false, result.message);
    }
  };
  const onActivity = (): void => void beat();

  context.subscriptions.push(
    status,
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === vscode.window.activeTextEditor?.document) onActivity();
    }),
    vscode.window.onDidChangeTextEditorSelection(onActivity),
    vscode.window.onDidChangeTextEditorVisibleRanges(onActivity),
    vscode.window.onDidChangeActiveTextEditor(onActivity),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) onActivity();
    }),
    vscode.commands.registerCommand('activityTracker.showStatus', () => {
      void vscode.window.showInformationMessage(`Personal Activity Tracker: ${lastMessage}`);
    }),
  );
  onActivity();
}

export function deactivate(): void {}
