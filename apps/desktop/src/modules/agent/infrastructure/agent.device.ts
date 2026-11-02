import type { Run } from "../model/actions";
import type { Choice } from "../model/agents";
import type { Tabs } from "../model/tabs";

const CHOICE_KEY = "sapien.agent.choice";
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

// Последний выбор агента, модели и размышления: с ним начинается новая
// сессия. Хранилище окна бывает закрыто политикой: тогда выбор живёт до
// закрытия окна, а приложение не падает. null: выбора ещё не было.
export function readChoice(): Choice | null {
  try {
    return JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function writeChoice(choice: Choice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
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
    // Как с выбором агента: вкладки живут до закрытия окна.
  }
}
