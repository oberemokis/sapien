import { parsePanes, type Panes } from "../model/panes";
import { parseTabs, type Tabs } from "../model/tabs";

const TABS_KEY = "sapien.agent.tabs";
const PANES_KEY = "sapien.agent.panes";

// Раскладки панелей по сессиям: после перезапуска сессия открывается
// с теми же панелями, а в каждой новая оболочка под прежним экраном.
export function readPanes(): Record<string, Panes> {
  try {
    return parsePanes(JSON.parse(localStorage.getItem(PANES_KEY) ?? "null"));
  } catch {
    return {};
  }
}

export function writePanes(panes: Record<string, Panes>) {
  try {
    localStorage.setItem(PANES_KEY, JSON.stringify(panes));
  } catch {
    // Панели уже на экране, без записи они только не переживут перезапуск.
  }
}

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
