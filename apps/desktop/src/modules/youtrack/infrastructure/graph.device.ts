import type { TaskGraph } from "../model/youtrack";

const STORAGE_KEY = "sapien.youtrack.graphs";
// Графов в памяти не больше этого: давно не открытые уходят первыми.
const LIMIT = 20;

type Graphs = Record<string, TaskGraph>;

// Хранилище окна бывает закрыто политикой или испорчено: тогда без сети
// граф строится только по черновикам.
function read(): Graphs {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

// Граф на момент последнего ответа YouTrack: без сети окно показывает его.
export function knownGraph(key: string): TaskGraph | undefined {
  return read()[key];
}

export function rememberGraph(key: string, graph: TaskGraph) {
  const rest = Object.entries(read()).filter(([known]) => known !== key);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries([...rest.slice(-(LIMIT - 1)), [key, graph]])));
  } catch {
    // Граф уже в окне, без записи он только не переживёт перезапуск.
  }
}
