// Блокировка окна после бездействия. По умолчанию выключена: экран и так
// закрывает система, а лишняя проверка при каждом возвращении мешала бы.
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

export function idleFor(minutes: LockMinutes, lastActivity: number, now: number) {
  return now - lastActivity >= minutes * 60_000;
}

// Отказ app_unlock из src-tauri/src/unlock.rs. unavailable значит, что
// системе нечем спросить: нет пароля у учётной записи или агента polkit.
export type UnlockFailure = "canceled" | "failed" | "unavailable";

export function unlockFailureOf(error: unknown): UnlockFailure {
  let code: unknown = null;

  if (typeof error === "object" && error !== null && "code" in error) {
    code = error.code;
  }

  if (code === "unlock_canceled") {
    return "canceled";
  }

  if (code === "unlock_unavailable") {
    return "unavailable";
  }

  return "failed";
}
