import { movedPath, notePlace, type Moved } from "./vault";

// Открытые вкладки по пути файла: один файл открыт не больше одного раза.
export type Tabs = { tabs: string[]; active: string | null };

export const NO_TABS: Tabs = { tabs: [], active: null };

// Открытый файл просто становится активным. Новый встаёт во вкладку справа
// от активной или, как в Obsidian, заменяет файл активной вкладки.
export function openTab({ tabs, active }: Tabs, path: string, newTab: boolean): Tabs {
  if (tabs.includes(path)) {
    return { tabs, active: path };
  }

  const at = tabs.indexOf(active ?? "");

  if (newTab || at === -1) {
    return { tabs: tabs.toSpliced(at + 1, 0, path), active: path };
  }

  return { tabs: tabs.with(at, path), active: path };
}

// Закрыли активную: на экран выходит соседняя справа, а если её нет, слева.
export function closeTab({ tabs, active }: Tabs, path: string): Tabs {
  const at = tabs.indexOf(path);

  if (at === -1) {
    return { tabs, active };
  }

  const rest = tabs.toSpliced(at, 1);

  if (active !== path) {
    return { tabs: rest, active };
  }

  return { tabs: rest, active: rest[at] ?? rest[at - 1] ?? null };
}

// Соседняя вкладка по кругу: шаг 1 вправо, -1 влево.
export function cycleTab({ tabs, active }: Tabs, step: number): Tabs {
  const at = tabs.indexOf(active ?? "");

  if (at === -1) {
    return { tabs, active };
  }

  return { tabs, active: tabs[(at + step + tabs.length) % tabs.length] ?? active };
}

export function moveTab({ tabs, active }: Tabs, path: string, to: number): Tabs {
  if (!tabs.includes(path)) {
    return { tabs, active };
  }

  return { tabs: tabs.filter((tab) => tab !== path).toSpliced(to, 0, path), active };
}

// Файлы переименовали снаружи: вкладки переходят на новые пути и остаются
// на своих местах в ряду. Переименовали поверх открытого файла: вкладка
// с этим путём остаётся одна.
export function renameTabs({ tabs, active }: Tabs, moved: Moved[]): Tabs {
  const renamed = [...new Set(tabs.map((path) => movedPath(path, moved)))];

  if (active === null) {
    return { tabs: renamed, active };
  }

  return { tabs: renamed, active: movedPath(active, moved) };
}

// Только вкладки, чьи файлы на месте. Так запомненные вкладки встречают
// запуск, когда файл убрали, пока приложение было закрыто.
export function keepTabs({ tabs, active }: Tabs, exists: (path: string) => boolean): Tabs {
  const kept = tabs.filter(exists);

  if (active !== null && kept.includes(active)) {
    return { tabs: kept, active };
  }

  return { tabs: kept, active: kept[0] ?? null };
}

// Сохранённое в хранилище окна: что угодно, кроме списка путей и активного
// из него, это пустой набор.
export function parseTabs(raw: unknown): Tabs {
  if (typeof raw !== "object" || raw === null || !("tabs" in raw) || !Array.isArray(raw.tabs)) {
    return NO_TABS;
  }

  const tabs = [...new Set(raw.tabs.filter((tab): tab is string => typeof tab === "string"))];
  const active: unknown = "active" in raw && raw.active;

  if (typeof active === "string" && tabs.includes(active)) {
    return { tabs, active };
  }

  return { tabs, active: tabs[0] ?? null };
}

// Подпись вкладки: имя файла, а когда такое же имя открыто ещё в одной
// вкладке, и папка рядом.
export function tabLabels(tabs: string[]) {
  const places = tabs.map((path) => ({ path, ...notePlace(path) }));
  const count = new Map<string, number>();

  places.forEach(({ title }) => count.set(title, (count.get(title) ?? 0) + 1));

  return places.map(({ path, title, folders }) => {
    if ((count.get(title) ?? 0) > 1) {
      return { path, title, folder: folders.join("/") };
    }

    return { path, title, folder: "" };
  });
}
