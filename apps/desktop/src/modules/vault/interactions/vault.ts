import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  onVaultChanged,
  vaultChoose,
  vaultCreate,
  vaultStatus,
  vaultTree,
} from "../infrastructure/vault.api";
import type { VaultStatus } from "../model/vault";
import { forgetNotes } from "./note";
import { finishCreate, resetTree } from "./tree";

// Ключи из имён команд vault_status и vault_tree: общий префикс ["vault"]
// перечитывает всё хранилище разом.
export const VAULT_KEY = ["vault"] as const;

// Ошибка локального диска за секунду сама не пройдёт: повтор только оттянул
// бы её показ. Повторить можно кнопкой.
export const NO_RETRY = { retry: false } as const;

export function useVaultStatus() {
  return useQuery({ queryKey: [...VAULT_KEY, "status"], queryFn: vaultStatus, ...NO_RETRY });
}

export function useVaultTree() {
  const status = useVaultStatus();

  return useQuery({
    queryKey: [...VAULT_KEY, "tree"],
    queryFn: vaultTree,
    enabled: status.data?.kind === "ready",
    ...NO_RETRY,
  });
}

// Пути в дереве и несохранённые правки относятся к прежней папке. В другой
// папке под тем же путём лежит другой файл, и правка ушла бы не туда.
export function useChooseVault() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: vaultChoose,
    onSuccess: (status) => {
      const before = queryClient.getQueryData<VaultStatus>([...VAULT_KEY, "status"]);
      const same = before !== undefined && "path" in before && "path" in status && before.path === status.path;

      if (!same) {
        resetTree();
        forgetNotes();
      }

      return queryClient.invalidateQueries({ queryKey: VAULT_KEY });
    },
  });
}

// Поле имени уходит, когда дерево уже перечитано: новая строка встаёт
// на его место без мигания.
export function useCreateEntry(draftId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: vaultCreate,
    onSuccess: async (path, { kind }) => {
      await queryClient.invalidateQueries({ queryKey: VAULT_KEY });
      finishCreate(draftId, path, kind);
    },
  });
}

// Перечитывает хранилище, когда Rust сообщает о правке снаружи, и когда окно
// снова в фокусе: папку могли переименовать, пока окно было в фоне, а слежение
// за переименованием самой папки есть не на всех системах.
export function useVaultSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    function refresh() {
      void queryClient.invalidateQueries({ queryKey: VAULT_KEY });
    }

    const stop = onVaultChanged(refresh);
    window.addEventListener("focus", refresh);

    return () => {
      stop();
      window.removeEventListener("focus", refresh);
    };
  }, [queryClient]);
}
