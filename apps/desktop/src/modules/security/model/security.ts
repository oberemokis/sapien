// Данные приложения: история чата, версии заметок, кеш задач. sealed
// зашифрованы, plain лежат открытыми без хранилища паролей, lost и locked
// не читаются: ключ стёрли или хранилище паролей не ответило.
export type DataState = "sealed" | "plain" | "lost" | "locked";

export type System = "macos" | "windows" | "linux";

// Ответ src-tauri/src/security.rs. disk null, когда система не ответила.
export type SecurityStatus = { data: DataState; system: System; disk: boolean | null };

// Данные не читаются, и окно предлагает начать с чистыми.
export function isUnreadable(data: DataState | undefined) {
  return data === "lost" || data === "locked";
}

export type DiskState = "on" | "off" | "unknown";

export function diskState(disk: boolean | null): DiskState {
  if (disk === null) {
    return "unknown";
  }

  if (disk) {
    return "on";
  }

  return "off";
}
