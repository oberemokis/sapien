import { useSelector } from "@tanstack/react-store";
import { foldersDownTo, parentOf, type EntryKind } from "../model/vault";
import { treeStore } from "../store/tree.store";

export function useTreeState() {
  return useSelector(treeStore);
}

export function selectEntry(path: string, kind: EntryKind) {
  treeStore.setState((state) => ({ ...state, selected: { path, kind } }));
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

export function startCreate(kind: EntryKind, parent = targetFolder()) {
  lastDraftId += 1;
  const draft = { id: lastDraftId, parent, kind };

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
// а для новой папки внутрь неё. Поле закрывается, только если это всё ещё
// оно: пока шёл ответ, могли открыть новое.
export function finishCreate(draftId: number, path: string, kind: EntryKind) {
  treeStore.setState((state) => {
    const selected = { path, kind };

    if (state.draft?.id !== draftId) {
      return { ...state, selected };
    }

    return { ...state, draft: null, selected };
  });
}
