import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyGaming } from './gaming.ts';

const app = (exePath: string | null, processName?: string) => ({
  processName: processName ?? exePath?.split('\\').at(-1) ?? 'unknown',
  exePath,
});
const classify = (exePath: string | null, processName?: string, manual: string[] = []) =>
  classifyGaming(app(exePath, processName), manual);

describe('classifyGaming: games', () => {
  it('recognizes each game folder and names the game after its folder', () => {
    const cases: Array<[string, string]> = [
      ['C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades\\x64\\Hades.exe', 'Hades'],
      ['D:\\SteamLibrary\\steamapps\\common\\Portal 2\\portal2.exe', 'Portal 2'],
      ['C:\\Program Files\\Epic Games\\RocketLeague\\Binaries\\Win64\\RocketLeague.exe', 'RocketLeague'],
      ['C:\\XboxGames\\Forza Horizon 5\\Content\\ForzaHorizon5.exe', 'Forza Horizon 5'],
    ];
    for (const [path, gameName] of cases) {
      assert.deepEqual(classify(path), { category: 'gaming', gameName }, path);
    }
  });

  it('ignores case and forward slashes in the path', () => {
    assert.deepEqual(classify('d:/STEAMAPPS/Common/Hades/Hades.exe'), {
      category: 'gaming',
      gameName: 'Hades',
    });
  });

  it('falls back to the process name when the exe sits directly in the game folder', () => {
    assert.deepEqual(classify('D:\\Epic Games\\solo.exe'), { category: 'gaming', gameName: 'solo' });
  });

  it('leaves ordinary apps alone', () => {
    assert.equal(classify('C:\\Program Files\\Microsoft VS Code\\Code.exe'), null);
    assert.equal(classify(null, 'unknown'), null);
  });
});

describe('classifyGaming: launchers', () => {
  it('recognizes Steam, Epic, and Xbox app windows', () => {
    const cases: Array<[string, string]> = [
      ['C:\\Program Files (x86)\\Steam\\steam.exe', 'Steam'],
      ['C:\\Program Files (x86)\\Steam\\bin\\cef\\cef.win7x64\\steamwebhelper.exe', 'Steam'],
      ['C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe', 'Epic Games'],
      ['C:\\Program Files\\WindowsApps\\Microsoft.GamingApp_2404.1001.0.0_x64__8wekyb3d8bbwe\\XboxPcApp.exe', 'Xbox'],
      ['C:\\Program Files\\WindowsApps\\Microsoft.XboxApp_48.104.4001.0_x64__8wekyb3d8bbwe\\XboxApp.exe', 'Xbox'],
    ];
    for (const [path, launcher] of cases) {
      assert.deepEqual(classify(path), { category: 'game launcher', launcher }, path);
    }
  });

  it('does not mistake other files in the Epic launcher folder for a game', () => {
    assert.equal(classify('C:\\Program Files\\Epic Games\\Launcher\\Engine\\helper.exe')?.category, 'game launcher');
  });

  it('still treats Steam games as games, despite the Steam folder in their path', () => {
    assert.equal(classify('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades\\Hades.exe')?.category, 'gaming');
  });
});

describe('classifyGaming: manual list', () => {
  const path = 'C:\\Games\\Celeste\\Celeste.exe';

  it('matches by process name, with or without .exe, and by full path, ignoring case', () => {
    for (const entry of ['celeste', 'CELESTE.EXE', path.toUpperCase()]) {
      assert.deepEqual(classify(path, undefined, [entry]), { category: 'gaming', gameName: 'Celeste' }, entry);
    }
  });

  it('does not match part of a name', () => {
    assert.equal(classify(path, undefined, ['celes']), null);
  });

  it('outranks the launcher rules', () => {
    assert.equal(classify('C:\\Program Files (x86)\\Steam\\steam.exe', undefined, ['steam'])?.category, 'gaming');
  });

  it('works when the exe path is unavailable', () => {
    assert.equal(classify(null, 'Protected.exe', ['protected'])?.category, 'gaming');
  });
});
