import type { Theme, ThemePreference } from "../model/theme";

const STORAGE_KEY = "sapien.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

// Хранилище окна бывает закрыто политикой: тогда тема живёт до закрытия окна,
// а приложение не падает.
export function readThemePreference(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Тема уже применена, без записи она только не переживёт перезапуск.
  }
}

// Тёмные значения лежат на :root, светлые включает класс: см. styles.css.
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
