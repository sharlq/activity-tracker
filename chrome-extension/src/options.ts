import type { Status } from './tracker.ts';
import { DEFAULT_PORT, loadSettings, ping } from './tracker.ts';

const portInput = document.querySelector<HTMLInputElement>('#port')!;
const tokenInput = document.querySelector<HTMLInputElement>('#token')!;
const result = document.querySelector<HTMLElement>('#result')!;
const lastReport = document.querySelector<HTMLElement>('#last-report')!;

function show(element: HTMLElement, status: Status): void {
  element.textContent = `${status.message} (${new Date(status.at).toLocaleTimeString()})`;
  element.className = status.ok ? 'ok' : 'error';
}

async function refreshLastReport(): Promise<void> {
  const { status } = await chrome.storage.local.get('status');
  if (status) show(lastReport, status as Status);
  else lastReport.textContent = 'Nothing sent yet.';
}

async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const port = Number(portInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    show(result, { ok: false, at: Date.now(), message: 'The port must be a whole number from 1 to 65535.' });
    return;
  }
  const token = tokenInput.value.trim();
  await chrome.storage.local.set({ port, token });
  show(result, await ping({ port, token }));
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  portInput.value = String(settings.port || DEFAULT_PORT);
  tokenInput.value = settings.token;
  document.querySelector('form')!.addEventListener('submit', (event) => void save(event));
  chrome.storage.onChanged.addListener((changes) => {
    if (changes['status']) void refreshLastReport();
  });
  await refreshLastReport();
}

void init();
