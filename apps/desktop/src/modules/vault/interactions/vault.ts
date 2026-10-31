import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  onVaultChanged,
  onVaultOpen,
  vaultChoose,
  vaultCreate,
  vaultOpened,
  vaultStatus,
  vaultTrash,
  vaultTree,
  vaultWrite,
} from "../infrastructure/vault.api";
import type { EntryKind, VaultStatus } from "../model/vault";
import { dropNotesWithin, forgetNotes } from "./note";
import { readTemplate } from "./templates";
import { closeNotesWithin, finishCreate, openNote, resetTree } from "./tree";

type CreateInput = { parent: string; name: string; kind: EntryKind; template?: string };

// Шаблон читается до создания: пропал он, и пустой файл не остаётся.
async function createEntry({ template, ...input }: CreateInput) {
  if (template === undefined) {
    return vaultCreate(input);
  }

  const text = await readTemplate(template, input.name);
  const path = await vaultCreate(input);

  // Файл только что создан пустым, сверять его не с чем.
  await vaultWrite(path, text, null);

  return path;
}

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
// на его место без мигания. Без поля в дереве, например из поиска, номер
// поля 0: такого поля не бывает, и чужое не закроется.
export function useCreateEntry(draftId = 0) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createEntry,
    onSuccess: async (path, { kind }) => {
      await queryClient.invalidateQueries({ queryKey: VAULT_KEY });
      finishCreate(draftId, path, kind);
    },
  });
}

// Удалённое уходит в системную корзину, оттуда его можно вернуть. Вкладки
// внутри него закрываются, а правки забываются: человек сам решил, что они
// не нужны.
export function useTrashEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: vaultTrash,
    onSuccess: (_, entry) => {
      dropNotesWithin(entry);
      closeNotesWithin(entry);

      return queryClient.invalidateQueries({ queryKey: VAULT_KEY });
    },
  });
}

// Перечитывает хранилище, когда Rust сообщает о правке снаружи, и когда окно
// снова в фокусе: папку могли переименовать, пока окно было в фоне, а слежение
// за переименованием самой папки есть не на всех системах. Открывает
// заметки, на которые вела ссылка sapien://.
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

  // Ссылка sapien://, которой приложение запустили, приходит раньше этой
  // подписки, поэтому заметки из ссылок забираются и сразу, и по событию.
  // Ссылка пришла снаружи и не знает, что открыто сейчас: заметка встаёт
  // новой вкладкой, а не на место той, с которой работают.
  useEffect(() => {
    function openLinked() {
      void vaultOpened()
        .then((paths) => {
          for (const path of paths) {
            openNote(path, { focus: true, newTab: true });
          }
        })
        .catch(() => undefined);
    }

    openLinked();

    return onVaultOpen(openLinked);
  }, []);
}
