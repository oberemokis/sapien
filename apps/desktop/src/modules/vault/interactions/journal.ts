import { useQuery, useQueryClient } from "@tanstack/react-query";
import { vaultForgetUnsaved, vaultUnsaved } from "../infrastructure/vault.api";
import type { Unsaved, VaultStatus } from "../model/vault";
import { restoreNotes } from "./note";
import { openNote } from "./tree";
import { useVaultStatus } from "./vault";

function readyPath(status: VaultStatus | undefined) {
  if (status?.kind !== "ready") {
    return null;
  }

  return status.path;
}

// Правки, которые остались в журнале с прошлого запуска: приложение упало
// или запись не прошла. Журнал читается один раз на хранилище и вне
// префикса ["vault"]: дальше его пополняют записи этого запуска, а их
// человек видит в самой заметке.
export function useLeftUnsaved() {
  const queryClient = useQueryClient();
  const vault = readyPath(useVaultStatus().data);
  const queryKey = ["journal", vault] as const;
  const left = useQuery({
    queryKey,
    queryFn: vaultUnsaved,
    enabled: vault !== null,
    staleTime: Infinity,
    retry: false,
  });
  const entries = left.data ?? [];

  function answered() {
    queryClient.setQueryData<Unsaved[]>(queryKey, []);
  }

  return {
    entries,
    // Правки встают в свои заметки, заметки открываются вкладками.
    restore() {
      restoreNotes(queryClient, entries);

      for (const { path } of entries) {
        openNote(path, { newTab: true });
      }

      answered();
    },
    discard() {
      for (const { path } of entries) {
        void vaultForgetUnsaved(path).catch(() => undefined);
      }

      answered();
    },
  };
}
