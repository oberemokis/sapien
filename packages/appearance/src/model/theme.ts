export const THEME_PREFERENCES = ["dark", "light", "system"] as const;

// Выбор пользователя. «Как в системе» хранится как есть, а не как итоговая
// тема: иначе смена темы системы до приложения не дойдёт.
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type Theme = "dark" | "light";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

// Сохранённое значение могло побиться или остаться от другой версии:
// тогда тема по умолчанию, а не падение на старте.
export function parseThemePreference(raw: unknown): ThemePreference {
  return (
    THEME_PREFERENCES.find((preference) => preference === raw) ??
    DEFAULT_THEME_PREFERENCE
  );
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): Theme {
  if (preference !== "system") {
    return preference;
  }

  if (systemPrefersDark) {
    return "dark";
  }

  return "light";
}
