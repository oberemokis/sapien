import { createStore } from "@tanstack/react-store";
import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from "../model/theme";

export const themePreferenceStore = createStore<ThemePreference>(
  DEFAULT_THEME_PREFERENCE,
);
