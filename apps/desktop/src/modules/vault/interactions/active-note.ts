import { useSelector } from "@tanstack/react-store";
import { isClosedToAgent } from "../model/vault";
import { selectionStore } from "../store/selection.store";
import { treeStore } from "../store/tree.store";
import { useVaultTree } from "./vault";

export function selectText(path: string, text: string) {
  selectionStore.setState(() => ({ path, text }));
}

// Что человек видит сейчас: путь активной заметки, выделенное в ней и
// закрыта ли она для агента. Это берёт страница для соседей, например
// для чата с агентом.
export function useActiveNote() {
  const path = useSelector(treeStore, (tree) => tree.active);
  const selection = useSelector(selectionStore);
  const tree = useVaultTree();
  let selected = "";

  if (path !== null && selection?.path === path) {
    selected = selection.text;
  }

  return { path, selection: selected, closed: path !== null && isClosedToAgent(tree.data ?? [], path) };
}
