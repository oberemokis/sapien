import type { Run } from "../model/actions";
import { parseTabs, type Tabs } from "../model/tabs";

const TABS_KEY = "sapien.agent.tabs";
const RUNS_KEY = "sapien.actions.runs";

// Когда действия по расписанию последний раз запускались, по путям
// файлов. Без хранилища окна каждый запуск приложения замечает действия
// заново, и сроки, пропущенные при закрытом приложении, теряются.
export function readRuns(): Record<string, Run> {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export function writeRun(path: string, run: Run) {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify({ ...readRuns(), [path]: run }));
  } catch {
    // Запуск уже идёт, без записи он только может повториться после перезапуска.
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
