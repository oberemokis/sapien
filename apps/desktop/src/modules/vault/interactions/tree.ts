import { useSelector } from "@tanstack/react-store";
import { readRecent, writeRecent } from "../infrastructure/recent.device";
import { readTabs, writeTabs } from "../infrastructure/tabs.device";
import { parseRecent, pushRecent } from "../model/search";
import { closeTab, cycleTab, keepTabs, moveTab, openTab, parseTabs, type Tabs } from "../model/tabs";
import { foldersDownTo, isWithin, notePlace, parentOf, type EntryKind } from "../model/vault";
import { EMPTY_TREE, treeStore } from "../store/tree.store";
import { readTemplate, restoreTemplateSettings } from "./templates";

export function useTreeState() {
  return useSelector(treeStore);
}

// Вкладки, недавние и настройки шаблонов с прошлого запуска. Вкладки,
// чьих файлов уже нет, уберёт keepExistingTabs, когда придёт дерево.
let checkedOnStart = false;

export function restoreSession() {
  checkedOnStart = false;
  treeStore.setState((state) => ({
    ...state,
    ...parseTabs(readTabs()),
    recent: parseRecent(readRecent()),
  }));
  restoreTemplateSettings();
}

function updateTabs(update: (tabs: Tabs) => Tabs) {
  treeStore.setState((state) => ({ ...state, ...update({ tabs: state.tabs, active: state.active }) }));

  const { tabs, active } = treeStore.get();

  writeTabs({ tabs, active });
}

// Один раз за запуск, по первому дереву. Дальше вкладка пропавшего файла
// остаётся на месте и сообщает, что файла нет: текст в ней не пропадает.
export function keepExistingTabs(exists: (path: string) => boolean) {
  if (!checkedOnStart) {
    checkedOnStart = true;
    updateTabs((tabs) => keepTabs(tabs, exists));
  }
}

export function selectEntry(path: string, kind: EntryKind) {
  treeStore.setState((state) => ({ ...state, selected: { path, kind } }));
}

// Курсор в текст заметки. Редактор уже открытой вкладки тоже его получит:
// номер просьбы новый.
export function focusNote(path: string) {
  treeStore.setState((state) => ({ ...state, focus: { path, request: (state.focus?.request ?? 0) + 1 } }));
}

// Просьба исполнена. Иначе заметка, открытая позже заново, забрала бы
// курсор по старой просьбе, например у дерева.
export function focusDone(path: string) {
  treeStore.setState((state) => {
    if (state.focus?.path !== path) {
      return state;
    }

    return { ...state, focus: null };
  });
}

// Текст на место курсора в заметке, его вставит её редактор.
export function insertIntoNote(path: string, text: string) {
  treeStore.setState((state) => ({ ...state, insert: { path, text } }));
}

// Шаблон на место курсора в заметке, {{title}} это её имя. Шаблон успели
// удалить, пока выбирали: вставлять нечего, и заметка остаётся как была.
export async function insertTemplate(path: string, template: string) {
  try {
    insertIntoNote(path, await readTemplate(template, notePlace(path).title));
  } catch {
    // Нечего вставить.
  }
}

// Вставлено. Просьба разовая, как и с курсором: повторно открытая
// заметка не вставит текст второй раз.
export function insertDone(path: string) {
  treeStore.setState((state) => {
    if (state.insert?.path !== path) {
      return state;
    }

    return { ...state, insert: null };
  });
}

// Клик в дереве заменяет файл активной вкладки, ⌘клик и средняя кнопка
// открывают новую. Открытая заметка видна в дереве: папки над ней
// раскрываются, когда её открыли поиском.
export function openNote(path: string, { focus = false, newTab = false } = {}) {
  updateTabs((tabs) => openTab(tabs, path, newTab));
  treeStore.setState((state) => ({
    ...state,
    selected: { path, kind: "note" },
    expanded: [...new Set([...state.expanded, ...foldersDownTo(parentOf(path))])],
    recent: pushRecent(state.recent, path),
  }));
  writeRecent(treeStore.get().recent);

  if (focus) {
    focusNote(path);
  }
}

export function closeNote(path: string) {
  updateTabs((tabs) => closeTab(tabs, path));
}

// Элемент удалён: его вкладки и вкладки всего, что было в папке, закрываются.
export function closeNotesWithin(entry: string) {
  updateTabs((tabs) => keepTabs(tabs, (path) => !isWithin(path, entry)));
  treeStore.setState((state) => {
    if (state.selected === null || !isWithin(state.selected.path, entry)) {
      return state;
    }

    return { ...state, selected: null };
  });
}

export function closeActiveNote() {
  const { active } = treeStore.get();

  if (active !== null) {
    closeNote(active);
  }
}

// Переключение вкладок ставит курсор в текст, как в VS Code. Стрелки
// в ряду вкладок оставляют фокус на самих вкладках.
export function switchNote(path: string, { focus = true } = {}) {
  updateTabs((tabs) => ({ ...tabs, active: path }));
  treeStore.setState((state) => ({ ...state, selected: { path, kind: "note" } }));

  if (focus) {
    focusNote(path);
  }
}

export function cycleNotes(step: number) {
  const { active } = cycleTab(treeStore.get(), step);

  if (active !== null) {
    switchNote(active);
  }
}

export function moveNote(path: string, to: number) {
  updateTabs((tabs) => moveTab(tabs, path, to));
}

export function toggleFolder(path: string) {
  treeStore.setState((state) => {
    const expanded = state.expanded.filter((folder) => folder !== path);

    if (expanded.length === state.expanded.length) {
      expanded.push(path);
    }

    return { ...state, expanded };
  });
}

// Папка, куда идёт новое по кнопке и сочетанию: выделенная папка, папка
// выделенной заметки, иначе корень.
function targetFolder() {
  const { selected } = treeStore.get();

  if (selected === null) {
    return "";
  }

  if (selected.kind === "folder") {
    return selected.path;
  }

  return parentOf(selected.path);
}

// Открывает поле имени в дереве. Папка, где оно появится, раскрывается
// вместе со всеми над ней.
let lastDraftId = 0;

export function startCreate(kind: EntryKind, parent = targetFolder(), template?: string) {
  lastDraftId += 1;
  const draft = { id: lastDraftId, parent, kind, template };

  treeStore.setState((state) => ({
    ...state,
    expanded: [...new Set([...state.expanded, ...foldersDownTo(parent)])],
    draft,
  }));
}

export function cancelCreate() {
  treeStore.setState((state) => ({ ...state, draft: null }));
}

// Созданное выделяется: следующее «Новый файл» пойдёт в ту же папку,
// а для новой папки внутрь неё. Созданная заметка открывается в новой
// вкладке с курсором в тексте, как в VS Code: создание файла не закрывает
// тот, что был открыт. Поле закрывается, только если это всё ещё оно:
// пока шёл ответ, могли открыть новое.
export function finishCreate(draftId: number, path: string, kind: EntryKind) {
  if (kind === "note") {
    openNote(path, { focus: true, newTab: true });
  } else {
    selectEntry(path, kind);
  }

  treeStore.setState((state) => {
    if (state.draft?.id !== draftId) {
      return state;
    }

    return { ...state, draft: null };
  });
}

// Другое хранилище: пути прежнего в нём ничего не значат.
export function resetTree() {
  treeStore.setState(() => EMPTY_TREE);
  writeRecent([]);
  writeTabs({ tabs: [], active: null });
}
