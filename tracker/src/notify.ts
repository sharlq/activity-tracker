// Windows toast notifications, shown under the name رقيب.
//
// Node can't call WinRT directly, so each toast is a short-lived, hidden
// Windows PowerShell process that hands the toast XML to the notification
// platform. The app identity is registered per user (HKCU, no admin), which is
// how unpackaged apps get their own name in notifications.
//
// Buttons either open a page in رقيب's UI (protocol activation, which needs no
// registered app) or are handled by Windows itself (snooze and dismiss).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Logger } from './logger.ts';

export const APP_ID = 'Raqib.ActivityTracker';
export const APP_NAME = 'رقيب';

export type ToastAction =
  | { kind: 'open'; label: string; url: string }
  | { kind: 'snooze'; label?: string }
  | { kind: 'dismiss'; label?: string };

export interface Toast {
  title: string;
  lines: string[];
  /** Opened when the toast itself is clicked. */
  url?: string;
  actions?: ToastAction[];
  /** Reminders stay on screen until you act on them, and use the reminder sound. */
  reminder?: boolean;
  /** Snooze lengths offered, in minutes. Only used with a snooze action. */
  snoozeMinutes?: number[];
}

export const xmlEscape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function snoozeLabel(minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

export function toastXml(toast: Toast): string {
  const launch = toast.url ? ` activationType="protocol" launch="${xmlEscape(toast.url)}"` : '';
  const scenario = toast.reminder ? ' scenario="reminder"' : '';
  const texts = [toast.title, ...toast.lines].map((line) => `<text>${xmlEscape(line)}</text>`).join('');

  const parts: string[] = [];
  const actions = toast.actions ?? [];
  if (actions.some((a) => a.kind === 'snooze')) {
    const minutes = toast.snoozeMinutes ?? [5, 10, 30, 60];
    const options = minutes.map((m) => `<selection id="${m}" content="${xmlEscape(snoozeLabel(m))}"/>`).join('');
    parts.push(`<input id="snoozeTime" type="selection" defaultInput="${minutes[1] ?? minutes[0] ?? 10}">${options}</input>`);
  }
  for (const action of actions) {
    if (action.kind === 'open') {
      parts.push(`<action activationType="protocol" arguments="${xmlEscape(action.url)}" content="${xmlEscape(action.label)}"/>`);
    } else if (action.kind === 'snooze') {
      parts.push(`<action activationType="system" arguments="snooze" hint-inputId="snoozeTime" content="${xmlEscape(action.label ?? '')}"/>`);
    } else {
      parts.push(`<action activationType="system" arguments="dismiss" content="${xmlEscape(action.label ?? '')}"/>`);
    }
  }
  const actionsXml = parts.length > 0 ? `<actions>${parts.join('')}</actions>` : '';
  const audio = `<audio src="ms-winsoundevent:Notification.${toast.reminder ? 'Reminder' : 'Default'}"/>`;
  return `<toast${launch}${scenario}><visual><binding template="ToastGeneric">${texts}</binding></visual>${actionsXml}${audio}</toast>`;
}

/** The PowerShell that shows one toast. The XML goes in a single-quoted here-string, so nothing in it is expanded. */
export function toastScript(xml: string, appId: string = APP_ID): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '$doc = New-Object Windows.Data.Xml.Dom.XmlDocument',
    // A here-string ends only at a line starting with '@, and the XML has no line breaks.
    `$doc.LoadXml(@'\n${xml}\n'@)`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${appId}').Show((New-Object Windows.UI.Notifications.ToastNotification $doc))`,
  ].join('\n');
}

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 30_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ''}`));
      else resolve();
    });
  });
}

const APP_KEY = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`;

/** Gives toasts the name رقيب instead of "Windows PowerShell". Per user, no admin. */
export async function registerAppIdentity(iconPath?: string): Promise<void> {
  await run('reg.exe', ['add', APP_KEY, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', APP_NAME, '/f']);
  if (iconPath && existsSync(iconPath)) await run('reg.exe', ['add', APP_KEY, '/v', 'IconUri', '/t', 'REG_SZ', '/d', iconPath, '/f']);
}

export async function unregisterAppIdentity(): Promise<void> {
  await run('reg.exe', ['delete', APP_KEY, '/f']).catch(() => {});
}

export interface Notifier {
  show(toast: Toast): Promise<void>;
}

export function windowsNotifier(logger: Logger, iconPath?: string): Notifier {
  let registered: Promise<void> | null = null;
  return {
    async show(toast) {
      registered ??= registerAppIdentity(iconPath).catch((error: unknown) => {
        // Toasts still work without it; they're just labelled differently.
        logger.warn(`Could not register the notification name: ${(error as Error).message}`);
      });
      await registered;
      const script = toastScript(toastXml(toast));
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded]);
    },
  };
}
