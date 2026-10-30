// Тот же выбор, что у окна (apps/desktop, модуль appearance). Тему по нему
// считает Uniwind, поэтому здесь только список и разбор сохранённого.
export const THEME_PREFERENCES = ["dark", "light", "system"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

// Сохранённое значение могло побиться или остаться от другой версии:
// тогда тема по умолчанию, а не падение на старте.
export function parseThemePreference(raw: unknown): ThemePreference {
  return THEME_PREFERENCES.find((preference) => preference === raw) ?? DEFAULT_THEME_PREFERENCE;
}
