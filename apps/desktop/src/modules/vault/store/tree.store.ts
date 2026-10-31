import { createStore } from "@tanstack/react-store";
import type { EntryKind } from "../model/vault";

export type TreeState = {
  // Выделенный элемент дерева. Его папка решает, где создавать новое.
  selected: { path: string; kind: EntryKind } | null;
  expanded: string[];
  // Элемент, который создают прямо сейчас: поле имени в дереве. Номер
  // отличает новое поле от прежнего в той же папке: ответ на прежнее
  // не должен закрыть новое.
  draft: { id: number; parent: string; kind: EntryKind } | null;
  // Заметка в редакторе. Выделение папки её не закрывает. Только что
  // созданную открывают с курсором в тексте.
  open: { path: string; focus: boolean } | null;
  // Недавно открытые заметки, свежие первыми: их показывает пустой поиск.
  recent: string[];
};

export const EMPTY_TREE: TreeState = { selected: null, expanded: [], draft: null, open: null, recent: [] };

export const treeStore = createStore<TreeState>(EMPTY_TREE);
