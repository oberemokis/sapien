import { useSelector } from "@tanstack/react-store";
import { selectionStore } from "../store/selection.store";
import { treeStore } from "../store/tree.store";

export function selectText(path: string, text: string) {
  selectionStore.setState(() => ({ path, text }));
}

// Что человек видит сейчас: путь активной заметки и выделенное в ней.
// Это берёт страница для соседей, например для чата с агентом.
export function useActiveNote() {
  const path = useSelector(treeStore, (tree) => tree.active);
  const selection = useSelector(selectionStore);
  let selected = "";

  if (path !== null && selection?.path === path) {
    selected = selection.text;
  }

  return { path, selection: selected };
}
