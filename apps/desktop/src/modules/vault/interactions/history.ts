import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { vaultDeleted, vaultRestore, vaultVersion, vaultVersions } from "../infrastructure/vault.api";
import { historyStore } from "../store/history.store";
import { saveNote } from "./note";
import { openNote } from "./tree";
import { NO_RETRY, VAULT_KEY } from "./vault";

export function useHistoryPath() {
  return useSelector(historyStore, (state) => state.path);
}

export function openHistory(path: string) {
  historyStore.setState(() => ({ path }));
}

export function closeHistory() {
  historyStore.setState(() => ({ path: null }));
}

// Под префиксом хранилища: запись заметки и правка снаружи перечитывают
// и её историю.
export function useVersions(path: string) {
  return useQuery({ queryKey: [...VAULT_KEY, "versions", path], queryFn: () => vaultVersions(path), ...NO_RETRY });
}

// Текст версии не меняется, его хватает прочитать один раз.
export function useVersionText(path: string, id: number | null) {
  return useQuery({
    queryKey: ["version", path, id],
    queryFn: () => vaultVersion(path, id ?? 0),
    enabled: id !== null,
    staleTime: Infinity,
    ...NO_RETRY,
  });
}

export function useDeletedNotes(enabled: boolean) {
  return useQuery({ queryKey: [...VAULT_KEY, "deleted"], queryFn: vaultDeleted, enabled, ...NO_RETRY });
}

// Несохранённая правка сначала пишется: восстановление снимет её версией,
// а не потеряет. Восстановленная заметка открывается, удалённая тоже.
export function useRestoreVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, id }: { path: string; id: number }) => {
      await saveNote(queryClient, path);
      await vaultRestore(path, id);
    },
    onSuccess: async (_, { path }) => {
      await queryClient.invalidateQueries({ queryKey: VAULT_KEY });
      closeHistory();
      openNote(path, { focus: true });
    },
  });
}
