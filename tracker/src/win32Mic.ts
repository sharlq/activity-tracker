// Which apps are using the microphone right now, from the same place Windows'
// privacy settings read it: each app's key under CapabilityAccessManager has a
// LastUsedTimeStop of 0 while it holds the microphone. Nothing is recorded or
// listened to; this only reads those timestamps.
import koffi from 'koffi';
import { win32 as winPath } from 'node:path';

const advapi32 = koffi.load('advapi32.dll');
const RegOpenKeyExW = advapi32.func('__stdcall', 'RegOpenKeyExW', 'int32', ['intptr_t', 'str16', 'uint32', 'uint32', 'void *']);
const RegEnumKeyExW = advapi32.func('__stdcall', 'RegEnumKeyExW', 'int32', ['intptr_t', 'uint32', 'void *', 'void *', 'void *', 'void *', 'void *', 'void *']);
const RegQueryValueExW = advapi32.func('__stdcall', 'RegQueryValueExW', 'int32', ['intptr_t', 'str16', 'void *', 'void *', 'void *', 'void *']);
const RegCloseKey = advapi32.func('__stdcall', 'RegCloseKey', 'int32', ['intptr_t']);

/** HKEY_CURRENT_USER, sign-extended as Windows defines it. */
const HKCU = -2147483647;
const KEY_READ = 0x20019;
const ERROR_SUCCESS = 0;
const MICROPHONE = 'Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

function open(parent: number, path: string): number | null {
  const out = Buffer.alloc(8);
  if (RegOpenKeyExW(parent, path, 0, KEY_READ, out) !== ERROR_SUCCESS) return null;
  return Number(out.readBigInt64LE(0));
}

function subkeys(key: number): string[] {
  const names: string[] = [];
  const name = Buffer.alloc(1024 * 2);
  const size = Buffer.alloc(4);
  for (let i = 0; ; i++) {
    size.writeUInt32LE(1024, 0);
    if (RegEnumKeyExW(key, i, name, size, null, null, null, null) !== ERROR_SUCCESS) break;
    names.push(name.toString('utf16le', 0, size.readUInt32LE(0) * 2));
  }
  return names;
}

function qword(key: number, value: string): bigint | null {
  const data = Buffer.alloc(8);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(8, 0);
  if (RegQueryValueExW(key, value, null, null, data, size) !== ERROR_SUCCESS) return null;
  return data.readBigUInt64LE(0);
}

/** True if this app key says the microphone is in use now. */
function inUse(parent: number, name: string): boolean {
  const key = open(parent, name);
  if (key === null) return false;
  try {
    const start = qword(key, 'LastUsedTimeStart');
    const stop = qword(key, 'LastUsedTimeStop');
    return start !== null && start > 0n && stop === 0n;
  } finally {
    RegCloseKey(key);
  }
}

/** "MSTeams_8wekyb3d8bbwe" → "MSTeams"; "C:#Program Files#Zoom#Zoom.exe" → "Zoom". */
export function appNameOfKey(key: string): string {
  if (key.includes('#')) return winPath.basename(key.replaceAll('#', '\\')).replace(/\.exe$/i, '');
  return key.replace(/_[a-z0-9]{13}$/i, '');
}

/** Names of the apps holding the microphone right now. Empty when none, or if it can't be read. */
export function microphoneUsers(path = MICROPHONE): string[] {
  const root = open(HKCU, path);
  if (root === null) return [];
  const users: string[] = [];
  try {
    for (const name of subkeys(root)) {
      if (name === 'NonPackaged') {
        const desktop = open(root, name);
        if (desktop === null) continue;
        try {
          for (const app of subkeys(desktop)) if (inUse(desktop, app)) users.push(appNameOfKey(app));
        } finally {
          RegCloseKey(desktop);
        }
      } else if (inUse(root, name)) {
        users.push(appNameOfKey(name));
      }
    }
  } finally {
    RegCloseKey(root);
  }
  return users;
}
