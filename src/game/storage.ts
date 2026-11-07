// Per-browser preferences. Game progress, stats and rankings live on the server.
const PREFIX = 'azeroth-pinpoint:v1:';

export interface Settings { sound: boolean; zoneLabels: boolean; mapStyle: 'auto' | 'parchment' | 'terrain'; seenHelp: boolean; }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const loadSettings = (): Settings =>
  ({ sound: true, zoneLabels: true, mapStyle: 'auto', seenHelp: false, ...read<Partial<Settings>>('settings', {}) });

export function saveSettings(s: Settings) {
  try { localStorage.setItem(PREFIX + 'settings', JSON.stringify(s)); } catch { /* private mode etc. */ }
}
