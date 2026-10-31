import { createStore } from "@tanstack/react-store";
import type { EntryKind } from "../model/vault";

export type TreeState = {
  // Выделенный элемент дерева. Его папка решает, где создавать новое,
  // а выделенную заметку откроет редактор (#8).
  selected: { path: string; kind: EntryKind } | null;
  expanded: string[];
  // Элемент, который создают прямо сейчас: поле имени в дереве. Номер
  // отличает новое поле от прежнего в той же папке: ответ на прежнее
  // не должен закрыть новое.
  draft: { id: number; parent: string; kind: EntryKind } | null;
};

export const treeStore = createStore<TreeState>({ selected: null, expanded: [], draft: null });
