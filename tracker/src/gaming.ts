// Decides whether a window is a game or a game launcher, from its process and path.
// Nothing is stored: rules run when data is read, so editing the manual list also
// corrects past events.

export interface AppIdentity {
  processName: string;
  exePath: string | null;
}

export type GamingClass =
  | { category: 'gaming'; gameName: string }
  | { category: 'game launcher'; launcher: string };

/** True if a config entry names this app: `bank`, `bank.exe`, or the full exe path. */
export function matchesApp({ processName, exePath }: AppIdentity, entry: string): boolean {
  const wanted = entry.toLowerCase();
  const process = processName.toLowerCase();
  return wanted === process || `${wanted}.exe` === process || wanted === exePath?.toLowerCase();
}

const LAUNCHER_PROCESSES: Record<string, string> = {
  'steam.exe': 'Steam',
  'steamwebhelper.exe': 'Steam',
  'epicgameslauncher.exe': 'Epic Games',
  'epicwebhelper.exe': 'Epic Games',
  'xboxapp.exe': 'Xbox',
  'xboxpcapp.exe': 'Xbox',
};

const LAUNCHER_PATHS: Array<[fragment: string, launcher: string]> = [
  ['epic games\\launcher\\', 'Epic Games'],
  ['\\microsoft.xboxapp_', 'Xbox'],
  ['\\microsoft.gamingapp_', 'Xbox'],
];

const GAME_FOLDERS = ['steamapps\\common', 'epic games', 'xboxgames'];

function launcherOf(app: AppIdentity, path: string): string | null {
  const byProcess = LAUNCHER_PROCESSES[app.processName.toLowerCase()];
  if (byProcess) return byProcess;
  return LAUNCHER_PATHS.find(([fragment]) => path.includes(fragment))?.[1] ?? null;
}

function withoutExe(processName: string): string {
  return processName.replace(/\.exe$/i, '');
}

/** The folder right after the game folder, using the path's original capitalization. */
function folderAfter(exePath: string, position: number, marker: string): string | null {
  const rest = exePath.slice(position + marker.length).split('\\');
  // rest[0] is what's left of the marker's own folder name. The next part is the
  // game's folder, unless that part is the exe itself.
  return rest.length >= 3 ? (rest[1] as string) : null;
}

export function classifyGaming(app: AppIdentity, manualGames: string[]): GamingClass | null {
  // A manual entry is an explicit choice, so it outranks every built-in rule.
  if (manualGames.some((entry) => matchesApp(app, entry))) {
    return { category: 'gaming', gameName: withoutExe(app.processName) };
  }

  const exePath = app.exePath?.replaceAll('/', '\\') ?? '';
  const path = exePath.toLowerCase();

  // Launchers come first: the Epic launcher itself lives under "Epic Games".
  const launcher = launcherOf(app, path);
  if (launcher) return { category: 'game launcher', launcher };

  for (const marker of GAME_FOLDERS) {
    const position = path.indexOf(marker);
    if (position !== -1) {
      const gameName = folderAfter(exePath, position, marker) ?? withoutExe(app.processName);
      return { category: 'gaming', gameName };
    }
  }
  return null;
}
