import { parsePanes, type Panes } from "../model/panes";
import { isIds, parseSessionOrder, type SessionOrder } from "../model/sessions";
import { parseTabs, type Tabs } from "../model/tabs";

const TABS_KEY = "sapien.agent.tabs";
const PANES_KEY = "sapien.agent.panes";
const ORDER_KEY = "sapien.agent.order";
const COLLAPSED_KEY = "sapien.agent.collapsed";

// Сессии, у которых в левой панели свёрнута ветка агентов.
export function readCollapsed(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "null");

    if (isIds(value)) {
      return value;
    }
  } catch {
    // Испорченная запись: все ветки раскрыты.
  }

  return [];
}

export function writeCollapsed(sessions: string[]) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(sessions));
  } catch {
    // Ветки уже свёрнуты на экране, без записи они раскроются после перезапуска.
  }
}

// Порядок сессий в левой панели, который человек задал перетаскиванием.
export function readSessionOrder(): SessionOrder {
  try {
    return parseSessionOrder(JSON.parse(localStorage.getItem(ORDER_KEY) ?? "null"));
  } catch {
    return {};
  }
}

export function writeSessionOrder(order: SessionOrder) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // Порядок уже на экране, без записи он только не переживёт перезапуск.
  }
}

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
