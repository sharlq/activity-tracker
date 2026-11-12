// Thin FFI layer over the Win32 calls we need. Nothing here makes decisions:
// see sampler.ts for what the values mean.
import { createHash } from 'node:crypto';
import { win32 as winPath } from 'node:path';
import koffi from 'koffi';
import type { ProcessInfo } from './audio.ts';
import type { ScreenWindow } from './screens.ts';
import type { GamepadState } from './gamepad.ts';
import type { ForegroundWindow, SystemProbe } from './sampler.ts';

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const wtsapi32 = koffi.load('wtsapi32.dll');
const dwmapi = koffi.load('dwmapi.dll');

const HANDLE = 'void *';

const GetForegroundWindow = user32.func('__stdcall', 'GetForegroundWindow', HANDLE, []);
const GetWindowTextW = user32.func('__stdcall', 'GetWindowTextW', 'int', [HANDLE, 'void *', 'int']);
const GetWindowTextLengthW = user32.func('__stdcall', 'GetWindowTextLengthW', 'int', [HANDLE]);
const GetWindowThreadProcessId = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', [
  HANDLE,
  'void *',
]);
const GetLastInputInfo = user32.func('__stdcall', 'GetLastInputInfo', 'int', ['void *']);

const EnumChildProc = koffi.proto('__stdcall', 'EnumChildProc', 'int', [HANDLE, 'intptr_t']);
const EnumChildWindows = user32.func('__stdcall', 'EnumChildWindows', 'int', [
  HANDLE,
  koffi.pointer(EnumChildProc),
  'intptr_t',
]);

const EnumWindowsProc = koffi.proto('__stdcall', 'EnumWindowsProc', 'int', [HANDLE, 'intptr_t']);
const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(EnumWindowsProc), 'intptr_t']);
const IsWindowVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', [HANDLE]);
const GetWindow = user32.func('__stdcall', 'GetWindow', HANDLE, [HANDLE, 'uint32']);
const GW_OWNER = 4;

const MonitorEnumProc = koffi.proto('__stdcall', 'RaqibMonitorEnumProc', 'int', [HANDLE, HANDLE, 'void *', 'intptr_t']);
const EnumDisplayMonitors = user32.func('__stdcall', 'EnumDisplayMonitors', 'int', [
  HANDLE,
  'void *',
  koffi.pointer(MonitorEnumProc),
  'intptr_t',
]);
const GetMonitorInfoW = user32.func('__stdcall', 'GetMonitorInfoW', 'int', [HANDLE, 'void *']);
const MonitorFromWindow = user32.func('__stdcall', 'MonitorFromWindow', HANDLE, [HANDLE, 'uint32']);
const GetWindowRect = user32.func('__stdcall', 'GetWindowRect', 'int', [HANDLE, 'void *']);
const IsIconic = user32.func('__stdcall', 'IsIconic', 'int', [HANDLE]);
const GetWindowLongPtrW = user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr_t', [HANDLE, 'int']);
const GetClassNameW = user32.func('__stdcall', 'GetClassNameW', 'int', [HANDLE, 'void *', 'int']);
const DwmGetWindowAttribute = dwmapi.func('__stdcall', 'DwmGetWindowAttribute', 'int32', [HANDLE, 'uint32', 'void *', 'uint32']);
const MONITOR_DEFAULTTONULL = 0;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_NOACTIVATE = 0x08000000;
const DWMWA_CLOAKED = 14;
const MONITORINFO_BYTES = 40;
/** A window counts as what's on a screen only if it covers at least this much of it. */
const MIN_SCREEN_SHARE = 0.25;
/** The desktop and taskbars are always there, so they say nothing about what's on screen. */
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

const OpenProcess = kernel32.func('__stdcall', 'OpenProcess', HANDLE, ['uint32', 'int', 'uint32']);
const CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'int', [HANDLE]);
const QueryFullProcessImageNameW = kernel32.func('__stdcall', 'QueryFullProcessImageNameW', 'int', [
  HANDLE,
  'uint32',
  'void *',
  'void *',
]);
const CreateToolhelp32Snapshot = kernel32.func('__stdcall', 'CreateToolhelp32Snapshot', HANDLE, ['uint32', 'uint32']);
const Process32FirstW = kernel32.func('__stdcall', 'Process32FirstW', 'int', [HANDLE, 'void *']);
const Process32NextW = kernel32.func('__stdcall', 'Process32NextW', 'int', [HANDLE, 'void *']);
const GetTickCount = kernel32.func('__stdcall', 'GetTickCount', 'uint32', []);
const OpenMutexW = kernel32.func('__stdcall', 'OpenMutexW', HANDLE, ['uint32', 'int', 'str16']);
const CreateMutexW = kernel32.func('__stdcall', 'CreateMutexW', HANDLE, ['void *', 'int', 'str16']);

const WTSQuerySessionInformationW = wtsapi32.func(
  '__stdcall',
  'WTSQuerySessionInformationW',
  'int',
  [HANDLE, 'uint32', 'int', koffi.out(koffi.pointer(koffi.pointer('void'))), koffi.out(koffi.pointer('uint32'))],
);
const WTSFreeMemory = wtsapi32.func('__stdcall', 'WTSFreeMemory', 'void', ['void *']);

/** Controllers are optional, so a missing DLL must not stop the tracker. */
function loadXInputGetState(): ((slot: number, state: Buffer) => number) | null {
  for (const dll of ['xinput1_4.dll', 'xinput9_1_0.dll']) {
    try {
      return koffi.load(dll).func('__stdcall', 'XInputGetState', 'uint32', ['uint32', 'void *']);
    } catch {
      // Try the next one.
    }
  }
  return null;
}

const XInputGetState = loadXInputGetState();

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const SYNCHRONIZE = 0x00100000;
const MAX_PATH_CHARS = 32768;
const WTS_CURRENT_SESSION = 0xffffffff;
const WTS_SESSION_INFO_EX = 25;
const WTSINFOEX_SESSION_FLAGS_OFFSET = 16;
const WTS_SESSIONSTATE_LOCK = 0;
const SINGLE_INSTANCE_MUTEX_PREFIX = 'Local\\PersonalActivityTracker-';
const XINPUT_STATE_BYTES = 16;
const ERROR_SUCCESS = 0;

/** Processes that only ever own the foreground while the session is locked. */
const LOCK_SCREEN_PROCESSES = new Set(['lockapp.exe', 'logonui.exe']);

function windowTitle(hwnd: unknown): string {
  const length = GetWindowTextLengthW(hwnd) as number;
  if (length <= 0) return '';
  const buffer = Buffer.alloc((length + 1) * 2);
  const copied = GetWindowTextW(hwnd, buffer, length + 1) as number;
  return buffer.toString('utf16le', 0, copied * 2);
}

function windowPid(hwnd: unknown): number {
  const pid = Buffer.alloc(4);
  GetWindowThreadProcessId(hwnd, pid);
  return pid.readUInt32LE(0);
}

function exePathOfPid(pid: number): string | null {
  const process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!process) return null; // Protected or already-exited process.
  try {
    const path = Buffer.alloc(MAX_PATH_CHARS * 2);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(MAX_PATH_CHARS, 0);
    if (!QueryFullProcessImageNameW(process, 0, path, size)) return null;
    return path.toString('utf16le', 0, size.readUInt32LE(0) * 2);
  } finally {
    CloseHandle(process);
  }
}

/**
 * Store apps (Calculator, Settings, the Xbox app...) are hosted by
 * ApplicationFrameHost.exe. The real app is a child window of another process.
 */
function hostedAppPid(hwnd: unknown, hostPid: number): number | null {
  let found: number | null = null;
  EnumChildWindows(
    hwnd,
    (child: unknown) => {
      const pid = windowPid(child);
      if (pid === hostPid) return 1;
      found = pid;
      return 0;
    },
    0,
  );
  return found;
}

function isLockScreen(window: ForegroundWindow): boolean {
  return LOCK_SCREEN_PROCESSES.has(window.processName.toLowerCase());
}

function foregroundWindow(): ForegroundWindow | null {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return null;
  return describeWindow(hwnd);
}

function describeWindow(hwnd: unknown): ForegroundWindow {
  const pid = windowPid(hwnd);
  let exePath = exePathOfPid(pid);
  if (exePath && winPath.basename(exePath).toLowerCase() === 'applicationframehost.exe') {
    const hosted = hostedAppPid(hwnd, pid);
    if (hosted !== null) exePath = exePathOfPid(hosted) ?? exePath;
  }

  return {
    processName: exePath ? winPath.basename(exePath) : 'unknown',
    exePath,
    title: windowTitle(hwnd),
  };
}

function isSessionLocked(): boolean {
  const info: [unknown] = [null];
  const bytes: [number] = [0];
  const ok = WTSQuerySessionInformationW(null, WTS_CURRENT_SESSION, WTS_SESSION_INFO_EX, info, bytes);
  if (ok && info[0]) {
    try {
      const flags = koffi.decode(info[0], WTSINFOEX_SESSION_FLAGS_OFFSET, 'int32') as number;
      if (flags === WTS_SESSIONSTATE_LOCK) return true;
    } finally {
      WTSFreeMemory(info[0]);
    }
  }
  const window = foregroundWindow();
  return window !== null && isLockScreen(window);
}

function idleMs(): number {
  const info = Buffer.alloc(8);
  info.writeUInt32LE(8, 0);
  if (!GetLastInputInfo(info)) return 0;
  // Both values are 32-bit tick counts, so subtract with wraparound (~every 49 days).
  return ((GetTickCount() as number) - info.readUInt32LE(4)) >>> 0;
}

function readGamepad(slot: number): GamepadState | null {
  if (!XInputGetState) return null;
  const state = Buffer.alloc(XINPUT_STATE_BYTES);
  if (XInputGetState(slot, state) !== ERROR_SUCCESS) return null;
  return {
    buttons: state.readUInt16LE(4),
    leftTrigger: state.readUInt8(6),
    rightTrigger: state.readUInt8(7),
    leftX: state.readInt16LE(8),
    leftY: state.readInt16LE(10),
    rightX: state.readInt16LE(12),
    rightY: state.readInt16LE(14),
  };
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const readRect = (buffer: Buffer, offset: number): Rect => ({
  left: buffer.readInt32LE(offset),
  top: buffer.readInt32LE(offset + 4),
  right: buffer.readInt32LE(offset + 8),
  bottom: buffer.readInt32LE(offset + 12),
});

const area = (r: Rect) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

function overlap(a: Rect, b: Rect): number {
  return area({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
}

/** Each screen, numbered left to right, then top to bottom. */
function monitors(): { handle: bigint; rect: Rect }[] {
  const found: { handle: bigint; rect: Rect }[] = [];
  EnumDisplayMonitors(
    null,
    null,
    (monitor: unknown) => {
      const info = Buffer.alloc(MONITORINFO_BYTES);
      info.writeUInt32LE(MONITORINFO_BYTES, 0);
      if (GetMonitorInfoW(monitor, info)) found.push({ handle: BigInt(koffi.address(monitor)), rect: readRect(info, 4) });
      return 1;
    },
    0,
  );
  return found.sort((a, b) => a.rect.left - b.rect.left || a.rect.top - b.rect.top);
}

function className(hwnd: unknown): string {
  const buffer = Buffer.alloc(512);
  const copied = GetClassNameW(hwnd, buffer, 256) as number;
  return buffer.toString('utf16le', 0, copied * 2);
}

/** A window you can see and would think of as an app: not hidden, minimized, cloaked, a tool palette, or the desktop. */
function isAppWindow(hwnd: unknown): boolean {
  if (!IsWindowVisible(hwnd) || IsIconic(hwnd) || GetWindow(hwnd, GW_OWNER)) return false;
  const exStyle = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  if (exStyle & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) return false;
  // Store apps in the background and windows on other virtual desktops are "cloaked": present but not shown.
  const cloaked = Buffer.alloc(4);
  if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked.readUInt32LE(0) !== 0) return false;
  if (SHELL_CLASSES.has(className(hwnd))) return false;
  return (GetWindowTextLengthW(hwnd) as number) > 0;
}

/**
 * The window on top of each screen. Windows are listed front to back, so the
 * first sizeable app window on a screen is the one you see there.
 */
function screenWindows(): ScreenWindow[] {
  const screens = monitors();
  const foreground = GetForegroundWindow();
  const focusedAt = foreground ? BigInt(koffi.address(foreground)) : null;
  const top = new Map<number, unknown>();
  const rect = Buffer.alloc(16);
  EnumWindows((hwnd: unknown) => {
    if (!isAppWindow(hwnd)) return 1;
    const monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL);
    if (!monitor) return 1;
    const index = screens.findIndex((s) => s.handle === BigInt(koffi.address(monitor)));
    const screen = screens[index];
    if (!screen || top.has(index)) return 1;
    if (!GetWindowRect(hwnd, rect) || overlap(readRect(rect, 0), screen.rect) < MIN_SCREEN_SHARE * area(screen.rect)) return 1;
    top.set(index, hwnd);
    return top.size < screens.length ? 1 : 0;
  }, 0);
  return [...top]
    .sort((a, b) => a[0] - b[0])
    .map(([index, hwnd]) => ({
      screen: index + 1,
      ...describeWindow(hwnd),
      focused: focusedAt !== null && BigInt(koffi.address(hwnd)) === focusedAt,
    }));
}

/** Reads each screen's top window. Kept off SystemProbe so the focused-window path doesn't depend on it. */
export const win32Screens = { screenWindows, screenCount: () => monitors().length };

export const win32Probe: SystemProbe = { isSessionLocked, foregroundWindow, idleMs, readGamepad };

/**
 * True if we are now the only tracker writing to this data folder. The kernel
 * drops the mutex when the process dies, so a crash can never leave a stale lock.
 */
export function acquireSingleInstance(dataFolder: string, role: InstanceRole = 'tracker'): boolean {
  if (isRunning(dataFolder, role)) return false;
  return Boolean(CreateMutexW(null, 0, mutexName(dataFolder, role)));
}

/** The tracker records; the supervisor keeps it running. Each has its own lock. */
export type InstanceRole = 'tracker' | 'supervisor';

function mutexName(dataFolder: string, role: InstanceRole): string {
  const key = createHash('sha256').update(winPath.resolve(dataFolder).toLowerCase()).digest('hex');
  return SINGLE_INSTANCE_MUTEX_PREFIX + key.slice(0, 16) + (role === 'supervisor' ? '-supervisor' : '');
}

/** True if a process currently holds that lock for this data folder. */
export function isRunning(dataFolder: string, role: InstanceRole = 'tracker'): boolean {
  const handle = OpenMutexW(SYNCHRONIZE, 0, mutexName(dataFolder, role));
  if (!handle) return false;
  CloseHandle(handle);
  return true;
}

/** The title of a process's main window: its first visible, unowned, titled top-level window. */
function mainWindowTitle(pid: number): string {
  let title = '';
  EnumWindows((hwnd: unknown) => {
    if (windowPid(hwnd) !== pid || !IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER)) return 1;
    const text = windowTitle(hwnd);
    if (!text) return 1;
    title = text;
    return 0;
  }, 0);
  return title;
}

const TH32CS_SNAPPROCESS = 0x2;
const INVALID_HANDLE = -1n;
/** PROCESSENTRY32W on 64-bit: size, and where the parent's id sits. */
const PROCESSENTRY_BYTES = 568;
const PROCESSENTRY_PID = 8;
const PROCESSENTRY_PARENT = 32;
/** How far up to look for the app a windowless helper belongs to. */
const MAX_PARENT_HOPS = 4;
/** Parents that launch apps but aren't the app: their windows say nothing about what's playing. */
const NOT_THE_APP = new Set(['explorer.exe', 'svchost.exe', 'services.exe', 'wininit.exe', 'winlogon.exe', 'sihost.exe', 'runtimebroker.exe', 'userinit.exe']);

/** Each running process's parent. */
function parentPids(): Map<number, number> {
  const parents = new Map<number, number>();
  const snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snapshot || BigInt(koffi.address(snapshot)) === BigInt.asUintN(64, INVALID_HANDLE)) return parents;
  try {
    const entry = Buffer.alloc(PROCESSENTRY_BYTES);
    entry.writeUInt32LE(PROCESSENTRY_BYTES, 0);
    for (let ok = Process32FirstW(snapshot, entry); ok; ok = Process32NextW(snapshot, entry)) {
      parents.set(entry.readUInt32LE(PROCESSENTRY_PID), entry.readUInt32LE(PROCESSENTRY_PARENT));
    }
  } finally {
    CloseHandle(snapshot);
  }
  return parents;
}

/**
 * What a process is, for background audio. Null if it has exited or can't be opened.
 *
 * Sound often comes from a helper with no window of its own: a Claude or Discord
 * renderer, the WebView2 inside Teams, a game client's UI process. Then the app it
 * belongs to is found by walking up its parents to the first one with a window,
 * and that app's name and window title are used, so it reads "Teams: Daily Scrum"
 * rather than "msedgewebview2".
 */
export function processInfo(pid: number): ProcessInfo | null {
  const exePath = exePathOfPid(pid);
  if (!exePath) return null;
  const own = { processName: winPath.basename(exePath), exePath, windowTitle: mainWindowTitle(pid) };
  if (own.windowTitle) return own;

  const parents = parentPids();
  let current = pid;
  for (let hop = 0; hop < MAX_PARENT_HOPS; hop++) {
    const parent = parents.get(current);
    if (parent === undefined || parent === 0 || parent === current) break;
    const parentPath = exePathOfPid(parent);
    if (!parentPath || NOT_THE_APP.has(winPath.basename(parentPath).toLowerCase())) break;
    const title = mainWindowTitle(parent);
    if (title) return { processName: winPath.basename(parentPath), exePath: parentPath, windowTitle: title };
    current = parent;
  }
  return own;
}
