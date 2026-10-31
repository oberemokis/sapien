// Блокировка приложения, тот же выбор, что у окна (apps/desktop, модуль
// security). Телефон считает не время без касаний, а время в фоне: экран
// без касаний гасит и запирает сама система.
export const LOCK_MINUTES = [1, 5, 15, 30, 60] as const;

export type LockMinutes = (typeof LOCK_MINUTES)[number];

export type LockSettings = { enabled: boolean; minutes: LockMinutes };

export const DEFAULT_LOCK_SETTINGS: LockSettings = { enabled: false, minutes: 5 };

function parseJson(raw: string | null): unknown {
  try {
    return JSON.parse(raw ?? "null");
  } catch {
    return null;
  }
}

// Сохранённое могло побиться или остаться от другой версии: тогда
// значения по умолчанию, а не падение на старте.
export function parseLockSettings(raw: string | null): LockSettings {
  const stored = parseJson(raw);

  if (typeof stored !== "object" || stored === null) {
    return DEFAULT_LOCK_SETTINGS;
  }

  const enabled = "enabled" in stored && stored.enabled === true;
  let minutes: unknown = null;

  if ("minutes" in stored) {
    minutes = stored.minutes;
  }

  return {
    enabled,
    minutes: LOCK_MINUTES.find((value) => value === minutes) ?? DEFAULT_LOCK_SETTINGS.minutes,
  };
}

export function awayFor(minutes: LockMinutes, hiddenAt: number, now: number) {
  return now - hiddenAt >= minutes * 60_000;
}

export type UnlockFailure = "canceled" | "failed" | "unavailable";

const CANCELED = new Set(["user_cancel", "system_cancel", "app_cancel", "user_fallback"]);
// На телефоне не задан код, и спросить нечем.
const UNAVAILABLE = new Set(["not_enrolled", "passcode_not_set", "not_available"]);

// Ответ expo-local-authentication: null, когда человек прошёл проверку.
export function unlockFailureOf(error: string | null): UnlockFailure | null {
  if (error === null) {
    return null;
  }

  if (CANCELED.has(error)) {
    return "canceled";
  }

  if (UNAVAILABLE.has(error)) {
    return "unavailable";
  }

  return "failed";
}
