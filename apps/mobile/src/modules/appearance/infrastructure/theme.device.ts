import Storage from "expo-sqlite/kv-store";
import { Uniwind, useUniwind } from "uniwind";
import type { ThemePreference } from "../model/theme";

const STORAGE_KEY = "sapien.theme";

// Чтение синхронное, поэтому тема встаёт до первой отрисовки. Хранилище,
// которое не открылось, даёт тему по умолчанию, а не падение на старте.
export function readThemePreference(): string | null {
  try {
    return Storage.getItemSync(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeThemePreference(preference: ThemePreference) {
  try {
    Storage.setItemSync(STORAGE_KEY, preference);
  } catch {
    // Тема уже применена, без записи она только не переживёт перезапуск.
  }
}

// «Как в системе» Uniwind понимает сам и следует за системой без нас.
export function paintTheme(preference: ThemePreference) {
  Uniwind.setTheme(preference);
}

// Uniwind и есть хранилище выбора на время работы: своего стора не нужно.
export function usePaintedTheme(): ThemePreference {
  const { theme, hasAdaptiveThemes } = useUniwind();

  if (hasAdaptiveThemes) {
    return "system";
  }

  return theme;
}
