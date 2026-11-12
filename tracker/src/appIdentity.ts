// Gives رقيب's window its own place on the taskbar.
//
// The window is a Chrome (or Edge) app window, so Windows files it under the
// browser: pin it and you get the Chrome icon, and a pinned رقيب shortcut opens
// a second, Chrome-badged button. Windows groups taskbar buttons by
// AppUserModelID, so we stamp رقيب's ID (plus how to relaunch it, and its icon)
// on the window, and the same ID on the shortcuts. Then they are all one app.
import koffi from 'koffi';

export interface AppIdentity {
  id: string;
  name: string;
  /** The command a pinned button runs. */
  relaunch: string;
  /** "C:\path\icon.ico,0" */
  icon: string;
}

const HANDLE = 'void *';
const user32 = koffi.load('user32.dll');
const shell32 = koffi.load('shell32.dll');
const ole32 = koffi.load('ole32.dll');

const EnumProc = koffi.proto('__stdcall', 'RaqibEnumWindowsProc', 'int', [HANDLE, 'intptr_t']);
const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(EnumProc), 'intptr_t']);
const GetWindowTextW = user32.func('__stdcall', 'GetWindowTextW', 'int', [HANDLE, 'void *', 'int']);
const GetClassNameW = user32.func('__stdcall', 'GetClassNameW', 'int', [HANDLE, 'void *', 'int']);
const IsWindowVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', [HANDLE]);
const SHGetPropertyStoreForWindow = shell32.func('__stdcall', 'SHGetPropertyStoreForWindow', 'int32', [
  HANDLE,
  'void *',
  koffi.out(koffi.pointer(HANDLE)),
]);
const SHGetPropertyStoreFromParsingName = shell32.func('__stdcall', 'SHGetPropertyStoreFromParsingName', 'int32', [
  'str16',
  HANDLE,
  'uint32',
  'void *',
  koffi.out(koffi.pointer(HANDLE)),
]);
const CoInitializeEx = ole32.func('__stdcall', 'CoInitializeEx', 'int32', [HANDLE, 'uint32']);

// IPropertyStore's vtable: QueryInterface, AddRef, Release, GetCount, GetAt, GetValue, SetValue, Commit.
const RELEASE = 2;
const SET_VALUE = 6;
const COMMIT = 7;
const ReleaseFn = koffi.proto('__stdcall', 'RaqibPropStoreRelease', 'uint32', [HANDLE]);
const SetValueFn = koffi.proto('__stdcall', 'RaqibPropStoreSetValue', 'int32', [HANDLE, 'void *', 'void *']);
const CommitFn = koffi.proto('__stdcall', 'RaqibPropStoreCommit', 'int32', [HANDLE]);

const GPS_READWRITE = 2;
const VT_LPWSTR = 31;
const PROPVARIANT_BYTES = 24;

function guid(text: string): Buffer {
  const hex = text.replaceAll('-', '');
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32LE(parseInt(hex.slice(0, 8), 16), 0);
  bytes.writeUInt16LE(parseInt(hex.slice(8, 12), 16), 4);
  bytes.writeUInt16LE(parseInt(hex.slice(12, 16), 16), 6);
  Buffer.from(hex.slice(16), 'hex').copy(bytes, 8);
  return bytes;
}

const IID_IPROPERTYSTORE = guid('886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99');
const APP_USER_MODEL = guid('9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3');
const RELAUNCH_COMMAND = 2;
const RELAUNCH_ICON = 3;
const RELAUNCH_NAME = 4;
const APP_ID = 5;

function propertyKey(pid: number): Buffer {
  const key = Buffer.alloc(20);
  APP_USER_MODEL.copy(key, 0);
  key.writeUInt32LE(pid, 16);
  return key;
}

/** Sets text properties on a property store, in order, then commits and releases it. */
function writeStore(store: unknown, values: [pid: number, text: string][]): boolean {
  const vtable = koffi.decode(store, 'void *');
  const method = (index: number) => koffi.decode(vtable, index * koffi.sizeof('void *'), 'void *');
  try {
    for (const [pid, text] of values) {
      const value = Buffer.from(`${text}\0`, 'utf16le');
      const variant = Buffer.alloc(PROPVARIANT_BYTES);
      variant.writeUInt16LE(VT_LPWSTR, 0);
      variant.writeBigUInt64LE(BigInt(koffi.address(value)), 8);
      if ((koffi.call(method(SET_VALUE), SetValueFn, store, propertyKey(pid), variant) as number) < 0) return false;
    }
    return (koffi.call(method(COMMIT), CommitFn, store) as number) >= 0;
  } finally {
    koffi.call(method(RELEASE), ReleaseFn, store);
  }
}

function text(hwnd: unknown, read: (hwnd: unknown, buffer: Buffer, size: number) => unknown): string {
  const buffer = Buffer.alloc(512 * 2);
  const copied = read(hwnd, buffer, 512) as number;
  return buffer.toString('utf16le', 0, copied * 2);
}

/** A browser *tab* showing رقيب has the browser's name on the end; an app window doesn't. */
export function isAppWindowTitle(title: string, name: string): boolean {
  return title.startsWith(name) && !/(Google Chrome|Microsoft\W*Edge|Mozilla Firefox)$/.test(title);
}

/** Visible Chrome/Edge app windows showing رقيب, keyed by handle address. */
function appWindows(name: string): Map<bigint, unknown> {
  const found = new Map<bigint, unknown>();
  EnumWindows((hwnd: unknown) => {
    if (IsWindowVisible(hwnd) && text(hwnd, GetClassNameW) === 'Chrome_WidgetWin_1' && isAppWindowTitle(text(hwnd, GetWindowTextW), name)) {
      found.set(BigInt(koffi.address(hwnd)), hwnd);
    }
    return 1;
  }, 0);
  return found;
}

function tagWindow(hwnd: unknown, identity: AppIdentity): boolean {
  const out: unknown[] = [null];
  if ((SHGetPropertyStoreForWindow(hwnd, IID_IPROPERTYSTORE, out) as number) < 0 || !out[0]) return false;
  // The relaunch details only count if they are there when the ID arrives, so the ID goes last.
  return writeStore(out[0], [
    [RELAUNCH_COMMAND, identity.relaunch],
    [RELAUNCH_ICON, identity.icon],
    [RELAUNCH_NAME, identity.name],
    [APP_ID, identity.id],
  ]);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Waits for a new رقيب window to appear and gives it رقيب's taskbar identity.
 * Call just before opening the window. Also tags any older رقيب windows it sees.
 */
export async function tagNewAppWindow(identity: AppIdentity, timeoutMs = 15_000): Promise<boolean> {
  const before = new Set(appWindows(identity.name).keys());
  const tagged = new Set<bigint>();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await sleep(300);
    let fresh = false;
    for (const [key, hwnd] of appWindows(identity.name)) {
      if (tagged.has(key)) continue;
      if (tagWindow(hwnd, identity)) tagged.add(key);
      if (!before.has(key)) fresh = true;
    }
    if (fresh) return true;
  }
  return false;
}

/** Stamps the AppUserModelID on a .lnk, so a pinned shortcut and the window share one button. */
export function setShortcutAppId(shortcut: string, id: string): boolean {
  CoInitializeEx(null, 2); // COINIT_APARTMENTTHREADED; harmless if COM is already up.
  const out: unknown[] = [null];
  if ((SHGetPropertyStoreFromParsingName(shortcut, null, GPS_READWRITE, IID_IPROPERTYSTORE, out) as number) < 0 || !out[0]) return false;
  return writeStore(out[0], [[APP_ID, id]]);
}
