import type { UnlockCode } from "@sapien/ipc";

// Блокировка окна после бездействия. По умолчанию выключена: экран и так
// закрывает система, а лишняя проверка при каждом возвращении мешала бы.
export const LOCK_MINUTES = [1, 5, 15, 30, 60] as const;

export type LockMinutes = (typeof LOCK_MINUTES)[number];

export type LockSettings = { enabled: boolean; minutes: LockMinutes };

export const DEFAULT_LOCK_SETTINGS: LockSettings = { enabled: false, minutes: 5 };

// Сохранённое могло остаться от другой версии: тогда значения
// по умолчанию, а не падение на старте.
export function parseLockSettings(stored: unknown): LockSettings {
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

// Отказ security_unlock по коду, как у forge: новый код Rust не скомпилируется
// без решения окна. unavailable значит, что системе нечем спросить:
// у учётной записи нет пароля.
const FAILURES = {
  unlock_canceled: "canceled",
  unlock_failed: "failed",
  unlock_unavailable: "unavailable",
} as const satisfies Record<UnlockCode, string>;

export type UnlockFailure = (typeof FAILURES)[UnlockCode];

export function unlockFailureOf(error: unknown): UnlockFailure {
  let code: unknown = null;

  if (typeof error === "object" && error !== null && "code" in error) {
    code = error.code;
  }

  return Object.entries(FAILURES).find(([known]) => known === code)?.[1] ?? "failed";
}
