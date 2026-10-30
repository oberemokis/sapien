import {
  paintTheme,
  readThemePreference,
  usePaintedTheme,
  writeThemePreference,
} from "../infrastructure/theme.device";
import { parseThemePreference, type ThemePreference } from "../model/theme";

// Зовётся один раз до первой отрисовки: иначе приложение сначала мигнёт
// тёмной темой у того, кто выбрал светлую.
export function restoreTheme() {
  paintTheme(parseThemePreference(readThemePreference()));
}

export function useThemePreference() {
  return usePaintedTheme();
}

export function setThemePreference(preference: ThemePreference) {
  paintTheme(preference);
  writeThemePreference(preference);
}
