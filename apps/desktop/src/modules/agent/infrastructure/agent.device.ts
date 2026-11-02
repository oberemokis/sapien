import type { Run } from "../model/actions";
import type { AgentModel } from "../model/chat";
import type { Tabs } from "../model/tabs";

const STORAGE_KEY = "sapien.agent.model";
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

// Хранилище окна бывает закрыто политикой: тогда выбор живёт до закрытия
// окна, а приложение не падает.
export function readAgentModel(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeAgentModel(model: AgentModel) {
  try {
    localStorage.setItem(STORAGE_KEY, model);
  } catch {
    // Выбор уже действует, без записи он только не переживёт перезапуск.
  }
}

// Открытые вкладки: после перезапуска окно открывает их же. null: вкладок
// ещё не было или хранилище закрыто.
export function readTabs(): Tabs | null {
  try {
    return JSON.parse(localStorage.getItem(TABS_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function writeTabs(tabs: Tabs) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    // Как с моделью: вкладки живут до закрытия окна.
  }
}
