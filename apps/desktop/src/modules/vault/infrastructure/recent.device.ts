const STORAGE_KEY = "sapien.recent";

// Хранилище окна бывает закрыто политикой: тогда недавние живут до закрытия
// окна, а приложение не падает.
export function readRecent(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function writeRecent(recent: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // Список уже в окне, без записи он только не переживёт перезапуск.
  }
}
