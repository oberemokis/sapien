import { createStore } from "@tanstack/react-store";
import type { EntryKind } from "../model/vault";

export type TreeState = {
  // Выделенный элемент дерева. Его папка решает, где создавать новое.
  selected: { path: string; kind: EntryKind } | null;
  expanded: string[];
  // Элемент, который создают прямо сейчас: поле имени в дереве. Номер
  // отличает новое поле от прежнего в той же папке: ответ на прежнее
  // не должен закрыть новое. Шаблон, если есть, путь заметки, из которой
  // берётся текст нового файла.
  draft: { id: number; parent: string; kind: EntryKind; template?: string } | null;
  // Вкладки с открытыми заметками по пути файла и активная из них.
  // Выделение папки в дереве их не трогает.
  tabs: string[];
  active: string | null;
  // Вкладки, открытые в режиме чтения, по пути файла.
  reading: string[];
  // Просьба поставить курсор в текст заметки: только что созданной или
  // открытой поиском. Номер растёт с каждой просьбой, и редактор, уже
  // открытый во вкладке, узнаёт о новой.
  focus: { path: string; request: number } | null;
  // Текст, который редактор заметки вставит на место курсора: шаблон.
  insert: { path: string; text: string } | null;
  // Недавно открытые заметки, свежие первыми: их показывает пустой поиск.
  recent: string[];
};

export const EMPTY_TREE: TreeState = {
  selected: null,
  expanded: [],
  draft: null,
  tabs: [],
  active: null,
  reading: [],
  focus: null,
  insert: null,
  recent: [],
};

export const treeStore = createStore<TreeState>(EMPTY_TREE);
