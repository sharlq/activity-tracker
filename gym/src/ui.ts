// Small pieces every screen uses: building elements, numbers, messages, and the phone's storage.
import { ConvexError } from 'convex/values';

export type Child = Node | string | number | null | undefined | false;
export type Props = Record<string, unknown> & { class?: string; onclick?: (e: MouseEvent) => void };

export function h(tag: string, props: Props | null = null, ...children: (Child | Child[])[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value') (el as HTMLInputElement).value = String(v);
    else if (k === 'checked') (el as HTMLInputElement).checked = true;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const n1 = (n: number) => String(Math.round(n * 10) / 10);
export const thousands = (n: number) => Math.round(n).toLocaleString('en');

export function message(error: unknown): string {
  if (error instanceof ConvexError) return typeof error.data === 'string' ? error.data : JSON.stringify(error.data);
  const text = error instanceof Error ? error.message : String(error);
  // Server errors arrive wrapped: keep the part the function wrote.
  return /Uncaught ConvexError: (.*?)(\n|$)/.exec(text)?.[1] ?? text;
}

let toastTimer: number | undefined;
export function toast(text: string, bad = false): void {
  const el = document.getElementById('toast') as HTMLElement;
  el.textContent = text;
  el.className = `show${bad ? ' bad' : ''}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.className = ''), bad ? 4000 : 2200);
}

/** Runs a change and says what went wrong, if anything; true when it worked. */
export async function attempt(run: () => Promise<unknown>, done?: string): Promise<boolean> {
  try {
    await run();
    if (done) toast(done);
    return true;
  } catch (e) {
    toast(message(e), true);
    return false;
  }
}

export const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null): void {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      // Private mode: works for this visit.
    }
  },
};
