// Which processes are playing sound right now, read from Windows Core Audio.
//
// Thin COM layer over the audio session API, called through koffi. For every
// active output device it lists the audio sessions and reads each one's peak
// meter. Nothing here decides anything: see audio.ts for what the readings mean.
//
// COM objects are released as soon as they're read, so polling every second
// doesn't leak. Every vtable index below is from the Windows SDK headers
// (mmdeviceapi.h, audiopolicy.h, endpointvolume.h).
import koffi from 'koffi';

const ole32 = koffi.load('ole32.dll');
const CoInitializeEx = ole32.func('__stdcall', 'CoInitializeEx', 'int32', ['void *', 'uint32']);
const CoCreateInstance = ole32.func('__stdcall', 'CoCreateInstance', 'int32', [
  'void *',
  'void *',
  'uint32',
  'void *',
  koffi.out(koffi.pointer('void *')),
]);

const CLSCTX_ALL = 0x17;
const COINIT_MULTITHREADED = 0;
const E_RENDER = 0;
const DEVICE_STATE_ACTIVE = 1;
const AUDIO_SESSION_STATE_ACTIVE = 1;
const S_OK = 0;

function guid(text: string): Buffer {
  const hex = text.replaceAll('-', '');
  const buffer = Buffer.alloc(16);
  buffer.writeUInt32LE(Number.parseInt(hex.slice(0, 8), 16), 0);
  buffer.writeUInt16LE(Number.parseInt(hex.slice(8, 12), 16), 4);
  buffer.writeUInt16LE(Number.parseInt(hex.slice(12, 16), 16), 6);
  Buffer.from(hex.slice(16), 'hex').copy(buffer, 8);
  return buffer;
}

const CLSID_MMDeviceEnumerator = guid('BCDE0395-E52F-467C-8E3D-C4579291692E');
const IID_IMMDeviceEnumerator = guid('A95664D2-9614-4F35-A746-DE8DB63617E6');
const IID_IAudioSessionManager2 = guid('77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F');
const IID_IAudioSessionControl2 = guid('BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D');
const IID_IAudioMeterInformation = guid('C02216F6-8C67-4B5B-9D00-D008E73E0064');

const OutPtr = koffi.out(koffi.pointer('void *'));

// Every method takes `this` first. Indexes count IUnknown's three methods.
const methods = {
  queryInterface: { index: 0, type: koffi.proto('__stdcall', 'int32', ['void *', 'void *', OutPtr]) },
  release: { index: 2, type: koffi.proto('__stdcall', 'uint32', ['void *']) },
  // IMMDeviceEnumerator::EnumAudioEndpoints(dataFlow, stateMask, out collection)
  enumAudioEndpoints: { index: 3, type: koffi.proto('__stdcall', 'int32', ['void *', 'int32', 'uint32', OutPtr]) },
  // IMMDeviceCollection::GetCount(out count), Item(index, out device)
  collectionCount: { index: 3, type: koffi.proto('__stdcall', 'int32', ['void *', koffi.out(koffi.pointer('uint32'))]) },
  collectionItem: { index: 4, type: koffi.proto('__stdcall', 'int32', ['void *', 'uint32', OutPtr]) },
  // IMMDevice::Activate(iid, clsctx, activationParams, out interface)
  activate: { index: 3, type: koffi.proto('__stdcall', 'int32', ['void *', 'void *', 'uint32', 'void *', OutPtr]) },
  // IAudioSessionManager2::GetSessionEnumerator(out enumerator)
  sessionEnumerator: { index: 5, type: koffi.proto('__stdcall', 'int32', ['void *', OutPtr]) },
  // IAudioSessionEnumerator::GetCount(out count), GetSession(index, out control)
  sessionCount: { index: 3, type: koffi.proto('__stdcall', 'int32', ['void *', koffi.out(koffi.pointer('int32'))]) },
  session: { index: 4, type: koffi.proto('__stdcall', 'int32', ['void *', 'int32', OutPtr]) },
  // IAudioSessionControl::GetState(out state)
  sessionState: { index: 3, type: koffi.proto('__stdcall', 'int32', ['void *', koffi.out(koffi.pointer('int32'))]) },
  // IAudioSessionControl2::GetProcessId(out pid), IsSystemSoundsSession()
  processId: { index: 14, type: koffi.proto('__stdcall', 'int32', ['void *', koffi.out(koffi.pointer('uint32'))]) },
  isSystemSounds: { index: 15, type: koffi.proto('__stdcall', 'int32', ['void *']) },
  // IAudioMeterInformation::GetPeakValue(out peak)
  peakValue: { index: 3, type: koffi.proto('__stdcall', 'int32', ['void *', koffi.out(koffi.pointer('float'))]) },
} as const;

type Method = keyof typeof methods;

function invoke(object: unknown, method: Method, ...args: unknown[]): number {
  const { index, type } = methods[method];
  const vtable = koffi.decode(object, 'void *') as unknown;
  const fn = koffi.decode(vtable, index * koffi.sizeof('void *'), 'void *') as unknown;
  return koffi.call(fn, type, object, ...args) as number;
}

function release(object: unknown): void {
  if (object) invoke(object, 'release');
}

/** Calls a method with one out-pointer and returns the object, or null if it failed. */
function getObject(object: unknown, method: Method, ...args: unknown[]): unknown {
  const out: [unknown] = [null];
  const hr = invoke(object, method, ...args, out);
  return hr === S_OK && out[0] ? out[0] : null;
}

function getNumber(object: unknown, method: Method, ...args: unknown[]): number | null {
  const out: [number] = [0];
  return invoke(object, method, ...args, out) === S_OK ? out[0] : null;
}

export interface AudioSessionReading {
  pid: number;
  /** Loudest sample in the last few milliseconds, 0 to 1. */
  peak: number;
}

let enumerator: unknown = null;

function deviceEnumerator(): unknown {
  if (enumerator) return enumerator;
  // RPC_E_CHANGED_MODE (already initialised another way) is fine: COM still works.
  CoInitializeEx(null, COINIT_MULTITHREADED);
  const out: [unknown] = [null];
  const hr = CoCreateInstance(CLSID_MMDeviceEnumerator, null, CLSCTX_ALL, IID_IMMDeviceEnumerator, out) as number;
  if (hr !== S_OK || !out[0]) throw new Error(`Could not open Windows audio (HRESULT 0x${(hr >>> 0).toString(16)})`);
  enumerator = out[0];
  return enumerator;
}

function readSession(control: unknown, readings: AudioSessionReading[]): void {
  const state = getNumber(control, 'sessionState');
  if (state !== AUDIO_SESSION_STATE_ACTIVE) return;
  const control2 = getObject(control, 'queryInterface', IID_IAudioSessionControl2);
  if (!control2) return;
  try {
    // S_OK (0) means it IS the system sounds session: skip notification dings.
    if (invoke(control2, 'isSystemSounds') === S_OK) return;
    const pid = getNumber(control2, 'processId');
    if (!pid) return;
    const meter = getObject(control, 'queryInterface', IID_IAudioMeterInformation);
    if (!meter) return;
    try {
      const peak = getNumber(meter, 'peakValue');
      if (peak !== null) readings.push({ pid, peak });
    } finally {
      release(meter);
    }
  } finally {
    release(control2);
  }
}

function readDevice(device: unknown, readings: AudioSessionReading[]): void {
  const manager = getObject(device, 'activate', IID_IAudioSessionManager2, CLSCTX_ALL, null);
  if (!manager) return;
  try {
    const sessions = getObject(manager, 'sessionEnumerator');
    if (!sessions) return;
    try {
      const count = getNumber(sessions, 'sessionCount') ?? 0;
      for (let i = 0; i < count; i++) {
        const control = getObject(sessions, 'session', i);
        if (!control) continue;
        try {
          readSession(control, readings);
        } finally {
          release(control);
        }
      }
    } finally {
      release(sessions);
    }
  } finally {
    release(manager);
  }
}

/** Every active audio session on every active output device, with its current peak. */
export function readAudioSessions(): AudioSessionReading[] {
  const readings: AudioSessionReading[] = [];
  const devices = getObject(deviceEnumerator(), 'enumAudioEndpoints', E_RENDER, DEVICE_STATE_ACTIVE);
  if (!devices) return readings;
  try {
    const count = getNumber(devices, 'collectionCount') ?? 0;
    for (let i = 0; i < count; i++) {
      const device = getObject(devices, 'collectionItem', i);
      if (!device) continue;
      try {
        readDevice(device, readings);
      } finally {
        release(device);
      }
    }
  } finally {
    release(devices);
  }
  return readings;
}
