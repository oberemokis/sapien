import type { Tabs } from "../model/tabs";

const STORAGE_KEY = "sapien.tabs";

// Хранилище окна бывает закрыто политикой: тогда вкладки живут до закрытия
// окна, а приложение не падает.
export function readTabs(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function writeTabs(tabs: Tabs & { reading: string[] }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // Вкладки уже в окне, без записи они только не переживут перезапуск.
  }
}
