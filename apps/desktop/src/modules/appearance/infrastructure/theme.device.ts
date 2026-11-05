import { defineSetting } from "@sapien/device";
import { DEFAULT_THEME_PREFERENCE, parseThemePreference, type Theme } from "../model/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export const themeSetting = defineSetting({
  key: "sapien.theme",
  parse: parseThemePreference,
  fallback: DEFAULT_THEME_PREFERENCE,
  text: true,
});

// Тёмные значения лежат на :root, светлые включает класс: см. theme.css в @sapien/ui.
export function paintTheme(theme: Theme) {
  document.documentElement.classList.toggle("theme-light", theme === "light");
}

export function systemPrefersDark() {
  return window.matchMedia(DARK_QUERY).matches;
}

export function subscribeSystemTheme(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
}
