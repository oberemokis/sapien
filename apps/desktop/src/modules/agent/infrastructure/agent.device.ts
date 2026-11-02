import { parseTabs, type Tabs } from "../model/tabs";

const TABS_KEY = "sapien.agent.tabs";

// Открытые вкладки: после перезапуска окно открывает их же. null: вкладок
// ещё не было, хранилище закрыто или в нём не вкладки.
export function readTabs(): Tabs | null {
  try {
    return parseTabs(JSON.parse(localStorage.getItem(TABS_KEY) ?? "null"));
  } catch {
    return null;
  }
}

// Хранилище окна бывает закрыто политикой: тогда вкладки живут до закрытия
// окна, а приложение не падает.
export function writeTabs(tabs: Tabs) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    // Вкладки уже открыты, без записи они только не переживут перезапуск.
  }
}
