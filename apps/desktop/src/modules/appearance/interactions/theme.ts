import { useSelector } from "@tanstack/react-store";
import { useLayoutEffect, useSyncExternalStore } from "react";
import {
  paintTheme,
  readThemePreference,
  subscribeSystemTheme,
  systemPrefersDark,
  writeThemePreference,
} from "../infrastructure/theme.device";
import {
  parseThemePreference,
  resolveTheme,
  type ThemePreference,
} from "../model/theme";
import { themePreferenceStore } from "../store/theme.store";

// Зовётся один раз до первой отрисовки: иначе окно сначала мигнёт тёмной
// темой у того, кто выбрал светлую.
export function restoreTheme() {
  const preference = parseThemePreference(readThemePreference());

  themePreferenceStore.setState(() => preference);
  paintTheme(resolveTheme(preference, systemPrefersDark()));
}

export function useThemePreference() {
  return useSelector(themePreferenceStore);
}

export function setThemePreference(preference: ThemePreference) {
  themePreferenceStore.setState(() => preference);
  writeThemePreference(preference);
}

// Держит класс темы на html в согласии с выбором, а при «как в системе»
// ещё и с темой системы.
export function useThemeSync() {
  const preference = useThemePreference();
  const systemDark = useSyncExternalStore(
    subscribeSystemTheme,
    systemPrefersDark,
  );
  const theme = resolveTheme(preference, systemDark);

  useLayoutEffect(() => {
    paintTheme(theme);
  }, [theme]);
}
